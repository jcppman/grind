import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { pendingTurns } from './protocol.ts';
import { runRunner, type RunnerDeps } from './runner.ts';
import { attemptFiles, paths, readState, type RuntimeState } from './runtime.ts';
import { discussionResult, resumeDiscussion, startDiscussion, stopDiscussion, systemRunnerDeps, systemServiceEnv, type ServiceEnv } from './service.ts';
import { isSameProcess, systemProbe, writeJsonAtomic } from './store.ts';
import { makeFakes, writePersonalConfig, type Fakes } from './test-fakes.ts';

const darwinOnly = { skip: process.platform !== 'darwin' ? 'discussion execution is macOS-only' : false };
const roles = { architect: { instructions: 'Design.' }, critic: { instructions: 'Critique.' } };
const pair = { participants: [{ id: 'architect', engine: 'claude', model: 'opus', role: 'architect' }, { id: 'critic', engine: 'codex', model: 'gpt-x', role: 'critic' }], writer: 'architect' };

interface Harness {
  fakes: Fakes;
  service: ServiceEnv;
  deps: RunnerDeps;
  dir: string;
  id: string;
}

function headless(fakes: Fakes) {
  return async (script: string, log: string) => {
    const fd = openSync(log, 'a', 0o600);
    try {
      spawn('/bin/sh', [script], { detached: true, stdio: ['ignore', fd, fd], env: fakes.env }).unref();
    } finally {
      closeSync(fd);
    }
  };
}

/** Starts a discussion whose runner generations run inside the test process with injectable dependencies. */
async function harness(t: TestContext, plan: Record<string, Record<string, string>> = {}): Promise<Harness> {
  const fakes = await makeFakes();
  t.after(fakes.cleanup);
  await writePersonalConfig(fakes, { roles, presets: { pair }, defaults: { preset: 'pair', presentation: 'headless', turnTimeoutSeconds: 30, totalTimeoutSeconds: 600 } });
  await fakes.setPlan({ participants: plan });
  const work = path.join(fakes.root, 'work');
  await mkdir(work);
  await writeFile(path.join(work, 'brief.md'), 'Decide.\n');
  await writeFile(path.join(work, 'plan.md'), 'original\n');
  const h = {} as Harness;
  h.fakes = fakes;
  h.deps = { ...systemRunnerDeps(), launchHeadless: headless(fakes), tickMs: 100, workerStartMs: 5_000 };
  h.service = { ...systemServiceEnv(work, fakes.env), launchRunner: async (dir, generation) => runRunner(dir, generation, h.deps) };
  const started = await startDiscussion({ ...h.service, launchRunner: async () => undefined }, { briefFile: 'brief.md', targets: ['plan.md'], noInit: true });
  h.dir = started.dir;
  h.id = started.id;
  t.after(() => stopDiscussion(h.service, h.id).catch(() => undefined));
  return h;
}

/** Runs generation 1 until it has persisted turn intents, then leaves it as if the runner died. */
async function assignWithoutWorkers(h: Harness): Promise<RuntimeState> {
  await runRunner(h.dir, 1, { ...h.deps, launchHeadless: async () => { throw new Error('simulated crash before any worker started'); } });
  const state = (await readState(h.dir))!;
  assert.equal(state.status, 'needs_recovery');
  return state;
}

function validAssessment(state: RuntimeState, turnId: string) {
  const turn = state.protocol.turns[turnId]!;
  return { discussionId: state.protocol.discussionId, participant: turn.participant, turnId, phase: 'assess', revision: null, snapshotId: turn.snapshotId, summary: 'recovered', findings: [] };
}

test('a crash before any engine started reassigns the turns without duplicates', darwinOnly, async (t) => {
  const h = await harness(t);
  const crashed = await assignWithoutWorkers(h);
  assert.deepEqual(Object.values(crashed.turns).map((turn) => [turn.status, turn.attempt]), [['assigned', 1], ['assigned', 1]]);
  await resumeDiscussion(h.service, h.id, {});
  const state = (await readState(h.dir))!;
  assert.equal(state.status, 'completed');
  assert.equal(state.protocol.outcome?.kind, 'agreed');
  const assess = Object.entries(state.turns).filter(([id]) => id.endsWith('-assess'));
  assert.deepEqual(assess.map(([, turn]) => turn.attempt), [2, 2]);
  const calls = await h.fakes.invocations();
  assert.equal(calls.filter((call) => call['phase'] === 'assess').length, 2, 'each assessment ran exactly once');
});

test('a crash after the engine finished recovers its complete output instead of resubmitting', darwinOnly, async (t) => {
  const h = await harness(t);
  const crashed = await assignWithoutWorkers(h);
  const [turnId] = Object.keys(crashed.turns).filter((id) => id.includes('-architect-'));
  const attempt = paths.attempt(h.dir, turnId!, 1);
  await writeJsonAtomic(attemptFiles.launch(attempt), { sessionId: crashed.turns[turnId!]!.sessionId, resume: false });
  const output = validAssessment(crashed, turnId!);
  await writeFile(attemptFiles.stdout(attempt), `${JSON.stringify({ type: 'system', subtype: 'init', session_id: crashed.turns[turnId!]!.sessionId, model: 'm' })}\n${JSON.stringify({ type: 'result', is_error: false, structured_output: output })}\n`);
  await resumeDiscussion(h.service, h.id, {});
  const state = (await readState(h.dir))!;
  assert.equal(state.protocol.outcome?.kind, 'agreed');
  assert.equal(state.turns[turnId!]!.attempt, 1);
  assert.equal(state.protocol.assessments['architect']!.summary, 'recovered');
  assert.equal((await h.fakes.invocations()).filter((call) => call['turnId'] === turnId).length, 0);
});

test('an engine launch without output is uncertain and needs an explicit resubmission', darwinOnly, async (t) => {
  const h = await harness(t);
  const crashed = await assignWithoutWorkers(h);
  const [turnId] = Object.keys(crashed.turns).filter((id) => id.includes('-critic-'));
  await writeJsonAtomic(attemptFiles.launch(paths.attempt(h.dir, turnId!, 1)), { sessionId: null, resume: false });
  await resumeDiscussion(h.service, h.id, {});
  const reconciled = (await readState(h.dir))!;
  assert.equal(reconciled.status, 'needs_recovery');
  assert.equal(reconciled.turns[turnId!]!.status, 'uncertain');
  await assert.rejects(resumeDiscussion(h.service, h.id, {}), /uncertain execution/);
  await resumeDiscussion(h.service, h.id, { resubmitUncertain: true });
  const state = (await readState(h.dir))!;
  assert.equal(state.protocol.outcome?.kind, 'agreed');
  assert.equal(state.turns[turnId!]!.attempt, 2);
});

test('an outcome persisted before the runner crashed is applied once and stale attempts are ignored', darwinOnly, async (t) => {
  const h = await harness(t);
  const crashed = await assignWithoutWorkers(h);
  const [turnId] = Object.keys(crashed.turns).filter((id) => id.includes('-architect-'));
  const attempt = paths.attempt(h.dir, turnId!, 1);
  await writeJsonAtomic(attemptFiles.outcome(attempt), { kind: 'response', response: validAssessment(crashed, turnId!), sessionId: crashed.turns[turnId!]!.sessionId, model: 'm', exitCode: 0, finishedAt: 'x' });
  await writeJsonAtomic(attemptFiles.outcome(paths.attempt(h.dir, turnId!, 7)), { kind: 'response', response: { ...validAssessment(crashed, turnId!), summary: 'stale' }, sessionId: null, model: null, exitCode: 0, finishedAt: 'x' });
  await resumeDiscussion(h.service, h.id, {});
  const state = (await readState(h.dir))!;
  assert.equal(state.protocol.assessments['architect']!.summary, 'recovered');
  assert.equal(state.protocol.outcome?.kind, 'agreed');
});

test('a resumed runner stops a stale worker of an earlier generation before scheduling', darwinOnly, async (t) => {
  const h = await harness(t);
  const crashed = await assignWithoutWorkers(h);
  const stale = spawn('/bin/sleep', ['60'], { detached: true, stdio: 'ignore' });
  stale.unref();
  t.after(() => { try { process.kill(stale.pid!, 'SIGKILL'); } catch { /* gone */ } });
  const identity = (await systemProbe.identify(stale.pid!))!;
  const [turnId] = Object.keys(crashed.turns).filter((id) => id.includes('-critic-'));
  await writeJsonAtomic(paths.worker(h.dir, 'critic', 1), { participant: 'critic', generation: 1, token: 'old', identity, cmux: { workspace: null, surface: null } });
  await writeJsonAtomic(attemptFiles.claim(paths.attempt(h.dir, turnId!, 1)), { token: 'old', identity });
  await resumeDiscussion(h.service, h.id, {});
  assert.equal(await isSameProcess(identity), false, 'the stale worker was terminated');
  assert.equal((await readState(h.dir))!.protocol.outcome?.kind, 'agreed');
});

test('a worker interrupted mid-turn (closed surface) needs recovery and never falls back to another presentation', darwinOnly, async (t) => {
  const h = await harness(t, { critic: { assess: 'hang' } });
  const runner = runRunner(h.dir, 1, h.deps);
  let registration: { identity: { pid: number; started: string } } | null = null;
  for (let i = 0; i < 200 && registration === null; i += 1) {
    const state = await readState(h.dir);
    const critic = Object.entries(state?.turns ?? {}).find(([id]) => id.includes('-critic-'));
    if (critic) {
      const running = await readFile(attemptFiles.running(paths.attempt(h.dir, critic[0], critic[1].attempt)), 'utf8').catch(() => null);
      if (running) registration = JSON.parse(await readFile(paths.worker(h.dir, 'critic', 1), 'utf8'));
    }
    if (registration === null) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(registration, 'critic worker started its engine');
  process.kill(registration.identity.pid, 'SIGHUP');
  await runner;
  const state = (await readState(h.dir))!;
  assert.equal(state.status, 'needs_recovery');
  assert.match(state.error!, /critic.*uncertain/);
  assert.equal(state.presentation.kind, 'headless');
});

test('the total deadline set at first launch survives recovery and ends the discussion unresolved', darwinOnly, async (t) => {
  const h = await harness(t);
  await assignWithoutWorkers(h);
  const deadline = (await readState(h.dir))!.deadline!;
  h.deps = { ...h.deps, now: () => new Date(Date.parse(deadline) + 1_000) };
  await resumeDiscussion(h.service, h.id, {});
  const state = (await readState(h.dir))!;
  assert.equal(state.deadline, deadline, 'recovery never refreshes the total budget');
  assert.equal(state.protocol.outcome?.kind, 'unresolved');
  assert.match(state.protocol.outcome!.reason, /total time limit/);
  assert.equal(pendingTurns(state.protocol).length, 0);
  const result = await discussionResult(h.service, h.id) as Record<string, any>;
  assert.equal(result['applied'], false);
});

test('a substantive context change during the discussion forces re-ratification against a new snapshot', darwinOnly, async (t) => {
  const h = await harness(t);
  let calls = 0;
  const base = h.deps.rebuildSnapshot;
  h.deps = {
    ...h.deps,
    rebuildSnapshot: async (record) => {
      const snapshot = await base(record);
      calls += 1;
      if (calls < 3) return snapshot;
      const changed = { ...snapshot.manifest, rawHash: 'raw-changed', semanticHash: 'semantic-changed' };
      return { id: 'ctx-changed', manifest: changed, bundle: `${snapshot.bundle}\nNew constraint.` };
    },
  };
  await runRunner(h.dir, 1, h.deps);
  const state = (await readState(h.dir))!;
  assert.equal(state.protocol.outcome?.kind, 'agreed');
  assert.equal(state.protocol.snapshot.id, 'ctx-changed');
  assert.ok(state.drift.some((item) => item.kind === 'substantive'));
  assert.ok(state.protocol.candidates.length >= 2, 'the writer revised against the refreshed snapshot');
  const finalRatify = Object.values(state.protocol.turns).filter((turn) => turn.kind === 'ratify' && turn.status === 'done').slice(-2);
  assert.ok(finalRatify.every((turn) => turn.snapshotId === 'ctx-changed'));
});
