import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openSync, closeSync, watch } from 'node:fs';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyCandidate } from './apply.ts';
import { composeBrief } from './brief.ts';
import { closeDiscussionWorkspace, type CmuxAdapter } from './cmux.ts';
import { compareSnapshots, writeSnapshot, type ContextSnapshot } from './context.ts';
import { parseEngineOutput } from './engines.ts';
import { advance, cancel, expire, finish, isTerminal, latestCandidate, pendingTurns, queueInput, recordFailure, recordResponse, sha256, type UserInput } from './protocol.ts';
import { attemptFiles, paths, readRecord, readState, type Assignment, type DiscussionRecord, type RuntimeState, type TurnOutcome, type WorkerRegistration } from './runtime.ts';
import { appendEvent, isSameProcess, readJson, terminateOwned, withLock, writeJsonAtomic, type ProcessProbe } from './store.ts';
import { launchScript, scriptPath, shellQuote } from './worker.ts';

const MAX_WORKER_LAUNCHES = 2;

export interface RunnerDeps {
  probe: ProcessProbe;
  cmux: CmuxAdapter | null;
  /** Starts a headless worker script detached from the runner, writing its output to `logFile`. */
  launchHeadless(script: string, logFile: string): Promise<void>;
  rebuildSnapshot(record: DiscussionRecord): Promise<ContextSnapshot>;
  now(): Date;
  tickMs: number;
  workerStartMs: number;
}

export class Superseded extends Error {}

export function spawnDetachedScript(script: string, logFile: string): Promise<void> {
  const fd = openSync(logFile, 'a', 0o600);
  try {
    const child = spawn('/bin/sh', [script], { detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
  } finally {
    closeSync(fd);
  }
  return Promise.resolve();
}

function waitForChange(dir: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let watcher: ReturnType<typeof watch> | null = null;
    const done = () => {
      clearTimeout(timer);
      watcher?.close();
      resolve();
    };
    const timer = setTimeout(done, ms);
    try {
      watcher = watch(dir, { recursive: true }, (_event, file) => {
        if (file && /state\.json|\.lock|events\.jsonl|stdout\.log|stderr\.log|\.tmp$/.test(file)) return;
        done();
      });
    } catch {
      watcher = null;
    }
  });
}

class Runner {
  readonly dir: string;
  readonly generation: number;
  readonly deps: RunnerDeps;
  record!: DiscussionRecord;
  state!: RuntimeState;

  constructor(dir: string, generation: number, deps: RunnerDeps) {
    this.dir = dir;
    this.generation = generation;
    this.deps = deps;
  }

  event(event: Record<string, unknown>) {
    return appendEvent(this.dir, { generation: this.generation, ...event });
  }

  /** Persists the state only while this runner's generation still owns the discussion. */
  async save(): Promise<void> {
    await withLock(this.dir, 'state', async () => {
      const current = await readState(this.dir);
      if (current?.generation !== this.generation) throw new Superseded('A newer runner generation owns this discussion');
      this.state.updatedAt = new Date().toISOString();
      await writeJsonAtomic(paths.state(this.dir), this.state);
    }, this.deps.probe);
  }

  async claimLease(): Promise<void> {
    const record = await readRecord(this.dir);
    if (record === null) throw new Error(`No discussion at ${this.dir}`);
    this.record = record;
    const identity = await this.deps.probe.identify(process.pid);
    await withLock(this.dir, 'state', async () => {
      const state = await readState(this.dir);
      if (state === null) throw new Error('Discussion state is missing');
      if (state.generation !== this.generation) throw new Superseded('A newer runner generation owns this discussion');
      if (state.runner && state.runner.pid !== process.pid && await isSameProcess(state.runner, this.deps.probe)) throw new Superseded('Another runner is active');
      state.runner = identity;
      this.state = state;
      await writeJsonAtomic(paths.state(this.dir), state);
    }, this.deps.probe);
  }

  /** Read through a method so control-flow narrowing does not assume the status is unchanged by awaited calls. */
  recovering(): boolean {
    return this.state.status === 'needs_recovery';
  }

  async run(): Promise<void> {
    await this.claimLease();
    await this.event({ type: 'runner_started', pid: process.pid });
    if (this.state.deadline === null) this.state.deadline = new Date(this.deps.now().getTime() + this.record.config.limits.totalTimeoutSeconds * 1000).toISOString();
    await this.reconcile();
    if (this.state.status !== 'running') {
      await this.save();
      return;
    }
    for (;;) {
      if (await readJson(paths.stop(this.dir)) !== null) {
        cancel(this.state.protocol, 'Stopped by request');
        await this.finalize();
        return;
      }
      await this.collect();
      if (this.recovering()) {
        await this.terminateAll();
        await this.save();
        return;
      }
      await this.ingestInputs();
      if (!isTerminal(this.state.protocol) && this.deps.now().getTime() >= Date.parse(this.state.deadline!)) {
        expire(this.state.protocol);
        await this.terminateAll();
      }
      if (!isTerminal(this.state.protocol) && pendingTurns(this.state.protocol).length === 0) {
        await this.boundary();
        if (!isTerminal(this.state.protocol) && this.state.protocol.phase !== 'waiting_input') {
          await this.save();
          continue;
        }
      }
      if (isTerminal(this.state.protocol)) {
        await this.finalize();
        return;
      }
      if (this.state.protocol.phase === 'waiting_input') {
        this.state.status = 'needs_input';
        await this.event({ type: 'needs_input', questions: this.state.protocol.questions });
        await this.save();
        return;
      }
      await this.assign();
      await this.ensureWorkers();
      if (this.recovering()) {
        await this.terminateAll();
        await this.save();
        return;
      }
      await this.save();
      await waitForChange(this.dir, this.deps.tickMs);
    }
  }

  async reconcile(): Promise<void> {
    for (const [turnId, turn] of Object.entries(this.state.turns)) {
      if (turn.status === 'uncertain') {
        if (this.state.resubmitUncertain) {
          turn.status = 'retry';
          await this.event({ type: 'uncertain_resubmitted', turnId });
        }
        continue;
      }
      if (turn.status !== 'assigned' || turn.generation === this.generation) continue;
      const attempt = paths.attempt(this.dir, turnId, turn.attempt);
      if (await readJson(attemptFiles.outcome(attempt)) !== null) continue;
      const registration = await readJson<WorkerRegistration>(paths.worker(this.dir, turn.participant, turn.generation));
      if (registration && await terminateOwned(registration.identity, 'SIGTERM', this.deps.probe)) await this.event({ type: 'stale_worker_stopped', participant: turn.participant, workerGeneration: turn.generation });
      const running = await readJson<{ identity: WorkerRegistration['identity'] | null }>(attemptFiles.running(attempt));
      if (running?.identity && await terminateOwned(running.identity, 'SIGTERM', this.deps.probe)) await this.event({ type: 'orphan_engine_stopped', turnId });
      await this.settleUnfinished(turnId, attempt);
    }
    this.state.resubmitUncertain = false;
    const uncertain = Object.entries(this.state.turns).filter(([, turn]) => turn.status === 'uncertain').map(([id]) => id);
    if (uncertain.length > 0) {
      this.state.status = 'needs_recovery';
      this.state.error = `Execution of ${uncertain.join(', ')} is uncertain; inspect the turn output, then resume with --resubmit-uncertain or stop`;
    } else {
      this.state.status = 'running';
      this.state.error = null;
    }
  }

  /** Decides what happened to a turn whose worker is gone without an outcome. */
  async settleUnfinished(turnId: string, attempt: string): Promise<void> {
    const turn = this.state.turns[turnId]!;
    if (await readJson(attemptFiles.launch(attempt)) === null) {
      turn.status = 'retry';
      await this.event({ type: 'turn_not_started', turnId, attempt: turn.attempt });
      return;
    }
    const stdout = await readFile(attemptFiles.stdout(attempt), 'utf8').catch(() => '');
    const last = await readFile(attemptFiles.last(attempt), 'utf8').catch(() => null);
    const parsed = parseEngineOutput(turn.engine, stdout, last);
    if (parsed.error === null && parsed.output !== null) {
      const outcome: TurnOutcome = { kind: 'response', response: parsed.output, sessionId: parsed.sessionId ?? turn.sessionId, model: parsed.model, exitCode: null, finishedAt: new Date().toISOString() };
      await writeJsonAtomic(attemptFiles.outcome(attempt), outcome);
      await this.event({ type: 'turn_recovered_from_output', turnId, attempt: turn.attempt });
      return;
    }
    turn.status = 'uncertain';
    await this.event({ type: 'turn_uncertain', turnId, attempt: turn.attempt });
  }

  async collect(): Promise<void> {
    for (const [turnId, turn] of Object.entries(this.state.turns)) {
      if (turn.status !== 'assigned') continue;
      const attempt = paths.attempt(this.dir, turnId, turn.attempt);
      const outcome = await readJson<TurnOutcome>(attemptFiles.outcome(attempt));
      if (outcome !== null) {
        turn.status = 'finished';
        const session = this.state.sessions[turn.participant] ?? { sessionId: null, established: false, reportedModel: null };
        session.sessionId = outcome.sessionId ?? session.sessionId;
        if (outcome.kind === 'response' || outcome.sessionId !== null) session.established = session.sessionId !== null;
        session.reportedModel = outcome.model ?? session.reportedModel;
        this.state.sessions[turn.participant] = session;
        if (outcome.kind === 'response') {
          const verdict = recordResponse(this.state.protocol, turnId, outcome.response);
          await this.event({ type: 'turn_response', turnId, attempt: turn.attempt, ...verdict });
          if (!verdict.accepted && (verdict.reason === 'mismatch' || verdict.reason === 'invalid')) recordFailure(this.state.protocol, turnId, `malformed response (${verdict.detail})`);
        } else {
          recordFailure(this.state.protocol, turnId, outcome.failure ?? 'unknown failure');
          await this.event({ type: 'turn_failed', turnId, attempt: turn.attempt, failure: outcome.failure });
        }
        continue;
      }
      const worker = this.state.workers[turn.participant];
      const registration = await readJson<WorkerRegistration>(paths.worker(this.dir, turn.participant, this.generation));
      if (registration && registration.token === worker?.token && await isSameProcess(registration.identity, this.deps.probe)) continue;
      if (!registration && worker && worker.generation === this.generation && this.deps.now().getTime() - Date.parse(worker.launchedAt) < this.deps.workerStartMs) continue;
      if (await readJson(attemptFiles.outcome(attempt)) !== null) continue;
      await this.settleUnfinished(turnId, attempt);
      if (this.state.turns[turnId]!.status === 'uncertain') {
        this.state.status = 'needs_recovery';
        this.state.error = `Worker for ${turn.participant} stopped during ${turnId}; its execution is uncertain`;
      }
    }
  }

  async ingestInputs(): Promise<void> {
    const dir = paths.inputs(this.dir);
    const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.json')).sort();
    for (const name of names) {
      const input = await readJson<UserInput>(path.join(dir, name));
      if (input === null || this.state.ingestedInputs.includes(input.id)) continue;
      queueInput(this.state.protocol, input);
      this.state.ingestedInputs.push(input.id);
      await this.event({ type: 'input_queued', inputId: input.id });
    }
  }

  async boundary(): Promise<void> {
    let semanticHash = this.state.protocol.snapshot.semanticHash;
    let snapshotId = this.state.protocol.snapshot.id;
    try {
      const fresh = await this.deps.rebuildSnapshot(this.record);
      const drift = compareSnapshots(this.state.snapshot.manifest, fresh.manifest);
      if (drift.kind !== 'none') {
        this.state.drift.push({ at: new Date().toISOString(), kind: drift.kind, changed: drift.changed });
        await this.event({ type: 'context_drift', ...drift });
      }
      if (drift.kind === 'substantive') {
        await writeSnapshot(this.dir, fresh);
        semanticHash = fresh.manifest.semanticHash;
        snapshotId = fresh.id;
        this.state.snapshot = { id: fresh.id, manifest: fresh.manifest };
      }
    } catch (error) {
      finish(this.state.protocol, { kind: 'unresolved', reason: `Shared context could not be reloaded: ${(error as Error).message}` });
      return;
    }
    for (const target of this.record.targets) {
      const current = await readFile(target.path).then((bytes) => sha256(bytes), () => null);
      if (current !== target.beforeSha256 && !this.state.drift.some((item) => item.kind === 'target' && item.changed.includes(target.path))) {
        this.state.drift.push({ at: new Date().toISOString(), kind: 'target', changed: [target.path] });
        await this.event({ type: 'target_drift', path: target.path });
      }
    }
    const before = this.state.protocol.phase;
    if (advance(this.state.protocol, { semanticHash, snapshotId, deadlinePassed: false })) {
      await this.event({ type: 'phase', from: before, to: this.state.protocol.phase, round: this.state.protocol.round });
    }
  }

  async assign(): Promise<void> {
    const { limits, participants } = this.record.config;
    let inFlight = Object.values(this.state.turns).filter((turn) => turn.status === 'assigned').length;
    for (const turn of pendingTurns(this.state.protocol)) {
      const runtime = this.state.turns[turn.id];
      if (runtime && runtime.status !== 'retry') continue;
      if (inFlight >= limits.maxConcurrent) break;
      const participant = participants.find((item) => item.id === turn.participant)!;
      const session = this.state.sessions[participant.id] ?? { sessionId: null, established: false, reportedModel: null };
      if (participant.engine === 'claude' && !session.established) session.sessionId = randomUUID();
      this.state.sessions[participant.id] = session;
      const attemptNumber = (runtime?.attempt ?? 0) + 1;
      this.state.turns[turn.id] = {
        attempt: attemptNumber,
        generation: this.generation,
        participant: participant.id,
        engine: participant.engine,
        sessionId: session.sessionId,
        resume: session.established,
        status: 'assigned',
        assignedAt: new Date().toISOString(),
      };
      await this.save();
      const attempt = paths.attempt(this.dir, turn.id, attemptNumber);
      await mkdir(attempt, { recursive: true, mode: 0o700 });
      const work = path.join(paths.participant(this.dir, participant.id), 'work');
      await mkdir(work, { recursive: true, mode: 0o700 });
      const contextDir = path.join(this.dir, 'context', turn.snapshotId);
      const bundle = await readFile(path.join(contextDir, 'bundle.md'), 'utf8');
      const readableRoots = [...this.state.snapshot.manifest.readableRoots, contextDir];
      await writeFile(attemptFiles.brief(attempt), composeBrief({
        state: this.state.protocol,
        turn,
        brief: this.record.brief,
        init: this.record.init,
        participant,
        writer: this.record.config.writer,
        bundle,
        bundlePath: path.join(contextDir, 'bundle.md'),
        readableRoots,
      }), { mode: 0o600 });
      const assignment: Assignment = {
        discussionId: this.record.id,
        turnId: turn.id,
        kind: turn.kind,
        attempt: attemptNumber,
        generation: this.generation,
        participant: participant.id,
        engine: participant.engine,
        model: participant.model,
        executable: this.record.executables[participant.engine]!.realPath,
        sessionId: session.sessionId,
        resume: session.established,
        cwd: work,
        readableRoots,
        turnTimeoutSeconds: limits.turnTimeoutSeconds,
        claudeConfigDir: this.record.claudeConfigDir,
      };
      await writeJsonAtomic(attemptFiles.assignment(attempt), assignment);
      await this.event({ type: 'turn_assigned', turnId: turn.id, attempt: attemptNumber, participant: participant.id, sessionId: session.sessionId, resume: session.established });
      inFlight += 1;
    }
  }

  async ensureWorkers(): Promise<void> {
    const needed = [...new Set(Object.values(this.state.turns).filter((turn) => turn.status === 'assigned').map((turn) => turn.participant))];
    for (const participant of needed) {
      const worker = this.state.workers[participant];
      if (worker && worker.generation === this.generation) {
        const registration = await readJson<WorkerRegistration>(paths.worker(this.dir, participant, this.generation));
        if (registration && registration.token === worker.token && await isSameProcess(registration.identity, this.deps.probe)) {
          worker.surface ??= registration.cmux.surface;
          continue;
        }
        if (!registration && this.deps.now().getTime() - Date.parse(worker.launchedAt) < this.deps.workerStartMs) continue;
        if (worker.launches >= MAX_WORKER_LAUNCHES) {
          this.state.status = 'needs_recovery';
          this.state.error = `Worker for ${participant} did not stay running after ${worker.launches} launches`;
          return;
        }
      }
      await this.launchWorker(participant, worker && worker.generation === this.generation ? worker.launches : 0);
      if (this.state.status === 'needs_recovery') return;
    }
  }

  async launchWorker(participant: string, previousLaunches: number): Promise<void> {
    const token = randomUUID();
    const dir = paths.participant(this.dir, participant);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const script = scriptPath(this.dir, participant, this.generation);
    await writeFile(script, launchScript({
      node: this.record.launcher.node,
      cli: this.record.launcher.cli,
      dir: this.dir,
      participant,
      generation: this.generation,
      token,
      env: { CLAUDE_CONFIG_DIR: this.record.claudeConfigDir },
    }), { mode: 0o700 });
    await chmod(script, 0o700);
    this.state.workers[participant] = { generation: this.generation, token, launchedAt: this.deps.now().toISOString(), surface: null, launches: previousLaunches + 1 };
    await this.save();
    const command = `sh ${shellQuote(script)}`;
    try {
      if (this.state.presentation.kind === 'cmux') {
        if (this.deps.cmux === null) throw new Error('cmux adapter is unavailable');
        if (this.state.presentation.workspace === null) {
          const opened = await this.deps.cmux.openWorkspace({
            name: `${this.record.init?.id ?? 'discussion'} · ${this.record.id}`,
            description: this.record.brief.split('\n')[0]!.slice(0, 120),
            cwd: dir,
            command,
          });
          this.state.presentation.workspace = opened.workspace;
          this.state.workers[participant]!.surface = opened.surface;
        } else {
          this.state.workers[participant]!.surface = (await this.deps.cmux.addPane({ workspace: this.state.presentation.workspace, cwd: dir, command })).surface;
        }
      } else {
        await this.deps.launchHeadless(script, path.join(dir, `worker-g${this.generation}.log`));
      }
    } catch (error) {
      this.state.status = 'needs_recovery';
      this.state.error = `Could not start the ${this.state.presentation.kind} worker for ${participant}: ${(error as Error).message}`;
      await this.event({ type: 'worker_launch_failed', participant, error: (error as Error).message });
      return;
    }
    await this.event({ type: 'worker_launched', participant, presentation: this.state.presentation.kind, surface: this.state.workers[participant]!.surface });
  }

  /** Stops this discussion's workers and their engines, checking each recorded process identity first. */
  async terminateAll(): Promise<void> {
    const names = await readdir(path.join(this.dir, 'workers')).catch(() => [] as string[]);
    for (const name of names) {
      const registration = await readJson<WorkerRegistration>(path.join(this.dir, 'workers', name));
      if (registration && await terminateOwned(registration.identity, 'SIGTERM', this.deps.probe)) await this.event({ type: 'worker_stopped', participant: registration.participant, workerGeneration: registration.generation });
    }
    for (const [turnId, turn] of Object.entries(this.state.turns)) {
      if (turn.status !== 'assigned') continue;
      const running = await readJson<{ identity: WorkerRegistration['identity'] | null }>(attemptFiles.running(paths.attempt(this.dir, turnId, turn.attempt)));
      if (running?.identity && await terminateOwned(running.identity, 'SIGTERM', this.deps.probe)) await this.event({ type: 'engine_stopped', turnId });
    }
  }

  async finalize(): Promise<void> {
    await this.terminateAll();
    const protocol = this.state.protocol;
    const candidate = latestCandidate(protocol);
    if (protocol.outcome?.kind === 'agreed' && this.record.targets.length > 0 && candidate) {
      try {
        this.state.application = await applyCandidate(paths.application(this.dir), this.record.targets, candidate);
      } catch (error) {
        this.state.error = `Application failed: ${(error as Error).message}`;
      }
      await this.event({ type: 'application', status: this.state.application?.status ?? 'error' });
    }
    this.state.status = protocol.outcome?.kind === 'cancelled' ? 'cancelled' : 'completed';
    await writeJsonAtomic(paths.result(this.dir), buildResult(this.record, this.state));
    await this.event({ type: 'finished', outcome: protocol.outcome });
    await this.save();
    await closeDiscussionWorkspace(this.deps.cmux, this.state.presentation)
      .then((closed) => closed ? this.event({ type: 'workspace_closed', workspace: this.state.presentation.workspace }) : undefined)
      .catch((error: Error) => this.event({ type: 'workspace_close_failed', workspace: this.state.presentation.workspace, error: error.message }));
  }
}

export function buildResult(record: DiscussionRecord, state: RuntimeState) {
  const protocol = state.protocol;
  const candidate = latestCandidate(protocol);
  const finalDecisions = candidate === null ? [] : protocol.decisions.filter((decision) => decision.revision === candidate.revision);
  return {
    schemaVersion: 1,
    id: record.id,
    init: record.init,
    linkedFrom: record.linkedFrom,
    outcome: protocol.outcome,
    agreed: protocol.outcome?.kind === 'agreed',
    applied: state.application?.status === 'applied',
    application: state.application === null
      ? { status: record.targets.length === 0 ? 'not_requested' : 'not_applied', targets: record.targets.map((target) => target.path) }
      : state.application,
    rounds: { used: protocol.round, max: protocol.maxRounds },
    proposal: candidate === null ? null : { revision: candidate.revision, hash: candidate.hash, documents: candidate.documents.map((doc) => ({ target: doc.target, sha256: sha256(doc.content), content: doc.content })), assumptions: candidate.assumptions, dispositions: candidate.dispositions, summary: candidate.summary, snapshotId: candidate.snapshotId },
    participants: record.config.participants.map((participant) => ({
      id: participant.id,
      role: participant.role,
      engine: participant.engine,
      model: participant.model,
      reportedModel: state.sessions[participant.id]?.reportedModel ?? null,
      sessionId: state.sessions[participant.id]?.sessionId ?? null,
      writer: participant.id === record.config.writer,
      decision: finalDecisions.find((decision) => decision.participant === participant.id) ?? null,
    })),
    unresolvedIssues: protocol.outcome?.kind === 'agreed' ? [] : protocol.openIssues,
    questions: protocol.questions,
    evidence: Object.fromEntries(Object.entries(protocol.assessments).map(([id, assessment]) => [id, { summary: assessment.summary, findings: assessment.findings }])),
    userInput: protocol.incorporatedInput,
    context: { snapshotId: state.snapshot.id, semanticHash: state.snapshot.manifest.semanticHash, artifacts: state.snapshot.manifest.artifacts, omissions: state.snapshot.manifest.omissions },
    drift: state.drift,
    finishedAt: new Date().toISOString(),
  };
}

export async function runRunner(dir: string, generation: number, deps: RunnerDeps): Promise<void> {
  const runner = new Runner(dir, generation, deps);
  try {
    await runner.run();
    await withLock(dir, 'state', async () => {
      const state = await readState(dir);
      if (state?.generation !== generation || state.runner?.pid !== process.pid) return;
      state.runner = null;
      await writeJsonAtomic(paths.state(dir), { ...state, updatedAt: new Date().toISOString() });
    }, deps.probe);
  } catch (error) {
    if (error instanceof Superseded) {
      await appendEvent(dir, { generation, type: 'runner_superseded', message: error.message });
      return;
    }
    await appendEvent(dir, { generation, type: 'runner_error', message: (error as Error).message });
    throw error;
  }
}
