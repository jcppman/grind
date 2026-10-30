import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrindError } from '../errors.ts';
import { findWorkspaceConfig, loadWorkspace, type Workspace } from '../workspace.ts';
import { resolveTargets } from './apply.ts';
import { systemCmux, type CmuxAdapter } from './cmux.ts';
import { loadLayeredConfig, resolveEffective, type Engine, type Overrides, type Presentation } from './config.ts';
import { buildSnapshot, resolveOwningInit, writeSnapshot } from './context.ts';
import { resolveExecutable, type ResolvedExecutable } from './engines.ts';
import { cancel, createProtocol, sha256, type UserInput } from './protocol.ts';
import { buildResult, runRunner, spawnDetachedScript, type RunnerDeps } from './runner.ts';
import { isFinal, paths, readRecord, readState, writeState, type DiscussionRecord, type RuntimeState } from './runtime.ts';
import { appendEvent, discussionDir, ensurePrivateDir, isSameProcess, listDiscussionIds, newDiscussionId, readEvents, readJson, systemProbe, terminateOwned, withLock, writeJsonAtomic, writeJsonExclusive, type ProcessProbe } from './store.ts';
import { PARTICIPANT_ENV } from './worker.ts';

export interface ServiceEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  probe: ProcessProbe;
  cmux: CmuxAdapter;
  /** Starts the detached runner for a generation. */
  launchRunner(dir: string, generation: number): Promise<void>;
}

export function cliEntry(): string {
  const self = fileURLToPath(import.meta.url);
  return path.join(path.dirname(path.dirname(self)), `cli${path.extname(self)}`);
}

export function systemServiceEnv(cwd: string, env: NodeJS.ProcessEnv = process.env): ServiceEnv {
  return {
    cwd,
    env,
    platform: process.platform,
    probe: systemProbe,
    cmux: systemCmux(env['GRIND_CMUX'] ?? 'cmux', env),
    launchRunner: async (dir, generation) => {
      const fd = openSync(paths.runnerLog(dir), 'a', 0o600);
      try {
        spawn(process.execPath, [cliEntry(), 'discuss', 'run', '--dir', dir, '--generation', String(generation)], { detached: true, stdio: ['ignore', fd, fd], cwd: dir, env }).unref();
      } finally {
        closeSync(fd);
      }
    },
  };
}

export function systemRunnerDeps(): RunnerDeps {
  return {
    probe: systemProbe,
    cmux: systemCmux(process.env['GRIND_CMUX'] ?? 'cmux'),
    launchHeadless: spawnDetachedScript,
    rebuildSnapshot: async (record) => {
      const workspace = record.workspace === null ? null : await loadWorkspace({ cwd: record.workspace, workspace: record.workspace });
      return buildSnapshot({ workspace, cwd: record.workspace ?? process.cwd(), init: record.init, targets: record.targets.map((target) => target.path) });
    },
    now: () => new Date(),
    tickMs: 2_000,
    workerStartMs: 30_000,
  };
}

/** Discussion execution is macOS-only in this version; refuse before any launch or state change. */
export function assertSupportedPlatform(platform: NodeJS.Platform): void {
  if (platform !== 'darwin') {
    throw new GrindError('UNSUPPORTED_PLATFORM', `grind discuss start and resume support macOS only; this host is ${platform}`, { platform });
  }
}

async function optionalWorkspace(cwd: string, explicit?: string): Promise<Workspace | null> {
  if (explicit !== undefined) return loadWorkspace({ cwd, workspace: explicit });
  if ((await findWorkspaceConfig(cwd)) === null) return null;
  return loadWorkspace({ cwd });
}

export interface StartOptions {
  briefFile?: string;
  brief?: string;
  preset?: string;
  init?: string;
  noInit?: boolean;
  targets: string[];
  presentation?: Presentation;
  maxRounds?: number;
  workspace?: string;
  linkedFrom?: string;
}

export async function loadConfig(service: ServiceEnv, workspaceDir?: string) {
  const workspace = await optionalWorkspace(service.cwd, workspaceDir);
  const layered = await loadLayeredConfig({ workspaceConfigPath: workspace?.configPath ?? null, env: service.env });
  return { workspace, layered };
}

export async function startDiscussion(service: ServiceEnv, options: StartOptions) {
  assertSupportedPlatform(service.platform);
  const brief = options.brief ?? (options.briefFile === undefined ? null : await readFile(path.resolve(service.cwd, options.briefFile), 'utf8'));
  if (brief === null || brief.trim() === '') throw new GrindError('USAGE', 'discuss start requires a nonempty --brief-file');
  const { workspace, layered } = await loadConfig(service, options.workspace);
  const overrides: Overrides = {
    ...(options.preset === undefined ? {} : { preset: options.preset }),
    ...(options.presentation === undefined ? {} : { presentation: options.presentation }),
    ...(options.maxRounds === undefined ? {} : { maxRounds: options.maxRounds }),
  };
  const config = resolveEffective(layered, overrides);
  const init = await resolveOwningInit({ workspace, cwd: service.cwd, ...(options.init === undefined ? {} : { init: options.init }), ...(options.noInit ? { noInit: true } : {}) });
  const targets = await resolveTargets(service.cwd, options.targets);
  const executables: Partial<Record<Engine, ResolvedExecutable>> = {};
  for (const engine of new Set(config.participants.map((participant) => participant.engine))) {
    executables[engine] = await resolveExecutable(engine, config.engines[engine], service.env);
  }
  const snapshot = await buildSnapshot({ workspace, cwd: service.cwd, init, targets: targets.map((target) => target.path) });
  let presentationKind: Presentation | null = config.presentation;
  let presentationError: string | null = null;
  if (config.presentation === 'cmux') {
    const available = await service.cmux.available();
    if (!available.ok) {
      presentationKind = null;
      presentationError = available.reason;
    }
  }
  const id = newDiscussionId();
  const dir = discussionDir(id, service.env);
  await ensurePrivateDir(path.dirname(dir));
  await ensurePrivateDir(dir);
  const record: DiscussionRecord = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    platform: service.platform,
    brief,
    briefSha256: sha256(brief),
    workspace: workspace?.root ?? null,
    init,
    config,
    executables,
    claudeConfigDir: service.env['CLAUDE_CONFIG_DIR'] ?? null,
    targets,
    linkedFrom: options.linkedFrom ?? null,
    launcher: { node: process.execPath, cli: cliEntry() },
  };
  await writeJsonAtomic(paths.record(dir), record);
  await writeSnapshot(dir, snapshot);
  const state: RuntimeState = {
    status: presentationKind === null ? 'needs_presentation_choice' : 'running',
    generation: presentationKind === null ? 0 : 1,
    runner: null,
    presentation: { kind: presentationKind, workspace: null, error: presentationError },
    deadline: null,
    protocol: createProtocol({
      discussionId: id,
      participants: config.participants.map((participant) => participant.id),
      writer: config.writer,
      targets: targets.map((target) => target.path),
      maxRounds: config.limits.maxRounds,
      snapshot: { id: snapshot.id, semanticHash: snapshot.manifest.semanticHash },
    }),
    snapshot: { id: snapshot.id, manifest: snapshot.manifest },
    turns: {},
    sessions: {},
    workers: {},
    ingestedInputs: [],
    drift: [],
    application: null,
    resubmitUncertain: false,
    error: presentationError === null ? null : `cmux is unavailable (${presentationError}); choose headless explicitly or retry inside cmux`,
    updatedAt: new Date().toISOString(),
  };
  await writeState(dir, state);
  await appendEvent(dir, { type: 'created', init: init?.id ?? null, preset: config.preset, presentation: presentationKind, linkedFrom: record.linkedFrom });
  if (presentationKind !== null) await service.launchRunner(dir, state.generation);
  return summary(record, state, dir);
}

function summary(record: DiscussionRecord, state: RuntimeState, dir: string, runnerAlive?: boolean | null) {
  const interrupted = state.status === 'running' && runnerAlive === false;
  return {
    id: record.id,
    dir,
    status: interrupted ? 'interrupted' : state.status,
    init: record.init,
    preset: record.config.preset,
    presentation: state.presentation,
    phase: state.protocol.phase,
    round: state.protocol.round,
    maxRounds: state.protocol.maxRounds,
    outcome: state.protocol.outcome,
    participants: record.config.participants.map((participant) => ({ id: participant.id, role: participant.role, engine: participant.engine, model: participant.model, writer: participant.id === record.config.writer })),
    targets: record.targets.map((target) => target.path),
    questions: state.protocol.questions,
    error: state.error,
    deadline: state.deadline,
    resultAvailable: isFinal(state.status),
    nextCommand: state.status === 'needs_presentation_choice'
      ? `grind discuss resume ${record.id} --presentation headless --json`
      : state.status === 'needs_input'
        ? `grind discuss input ${record.id} --brief-file <answer.md> --json`
        : state.status === 'needs_recovery' || interrupted
          ? `grind discuss resume ${record.id} --json`
          : isFinal(state.status) ? `grind discuss result ${record.id} --json` : `grind discuss status ${record.id} --json`,
  };
}

async function load(service: ServiceEnv, id: string) {
  const dir = discussionDir(id, service.env);
  const record = await readRecord(dir);
  const state = await readState(dir);
  if (record === null || state === null) throw new GrindError('DISCUSSION_NOT_FOUND', `No discussion ${id}`, { id });
  return { dir, record, state };
}

export async function discussionStatus(service: ServiceEnv, id: string) {
  const { dir, record, state } = await load(service, id);
  let alive: boolean | null;
  let inspectionError: string | null = null;
  try {
    alive = state.runner !== null && await isSameProcess(state.runner, service.probe);
  } catch (error) {
    if (!(error instanceof GrindError) || error.code !== 'PROCESS_INSPECTION_FAILED') throw error;
    alive = null;
    inspectionError = error.message;
  }
  const events = await readEvents(dir);
  return {
    ...summary(record, state, dir, alive),
    runnerAlive: alive,
    inspectionError,
    turns: Object.entries(state.protocol.turns).map(([turnId, turn]) => ({ id: turnId, participant: turn.participant, kind: turn.kind, revision: turn.revision, status: turn.status, runtime: state.turns[turnId]?.status ?? null, attempt: state.turns[turnId]?.attempt ?? null })),
    recentEvents: events.slice(-10),
  };
}

export async function discussionResult(service: ServiceEnv, id: string) {
  const { dir, record, state } = await load(service, id);
  const stored = await readJson<Record<string, unknown>>(paths.result(dir));
  if (stored !== null) return stored;
  return { ...buildResult(record, state), final: false, status: state.status };
}

export async function listDiscussions(service: ServiceEnv) {
  const ids = await listDiscussionIds(service.env);
  const items = [];
  for (const id of ids) {
    const dir = discussionDir(id, service.env);
    const record = await readRecord(dir);
    const state = await readState(dir);
    if (record && state) items.push({ id, status: state.status, init: record.init?.id ?? null, preset: record.config.preset, createdAt: record.createdAt, outcome: state.protocol.outcome?.kind ?? null });
  }
  return { discussions: items };
}

/** Moves a discussion to a new runner generation once no live runner owns it. */
async function nextGeneration(service: ServiceEnv, dir: string, update: (state: RuntimeState) => void): Promise<RuntimeState> {
  return withLock(dir, 'state', async () => {
    const state = (await readState(dir))!;
    if (state.runner && await isSameProcess(state.runner, service.probe)) throw new GrindError('DISCUSSION_STATE', 'The discussion runner is still active');
    update(state);
    state.generation += 1;
    state.runner = null;
    state.status = 'running';
    state.error = null;
    await writeJsonAtomic(paths.state(dir), { ...state, updatedAt: new Date().toISOString() });
    return state;
  }, service.probe);
}

export async function resumeDiscussion(service: ServiceEnv, id: string, options: { presentation?: Presentation; resubmitUncertain?: boolean }) {
  assertSupportedPlatform(service.platform);
  const { dir, record, state } = await load(service, id);
  if (isFinal(state.status)) throw new GrindError('DISCUSSION_STATE', `Discussion ${id} is ${state.status}; start a linked discussion instead`);
  if (state.status === 'needs_input') throw new GrindError('DISCUSSION_STATE', `Discussion ${id} is waiting for user input; use discuss input`);
  if (state.status === 'needs_presentation_choice') {
    if (options.presentation === undefined) throw new GrindError('USAGE', 'Choose a presentation explicitly with --presentation headless|cmux');
    if (options.presentation === 'cmux') {
      const available = await service.cmux.available();
      if (!available.ok) throw new GrindError('PRESENTATION_UNAVAILABLE', `cmux is unavailable: ${available.reason}`);
    }
  } else if (options.presentation !== undefined && options.presentation !== state.presentation.kind) {
    throw new GrindError('USAGE', 'Presentation is fixed once workers have been launched');
  }
  if (state.status === 'running' && state.runner && await isSameProcess(state.runner, service.probe)) {
    return { ...summary(record, state, dir, true), resumed: false };
  }
  const uncertain = Object.values(state.turns).some((turn) => turn.status === 'uncertain');
  if (uncertain && !options.resubmitUncertain) {
    throw new GrindError('DISCUSSION_STATE', 'Some turns have an uncertain execution. Inspect them with discuss status, then resume with --resubmit-uncertain or stop the discussion', { uncertain: Object.entries(state.turns).filter(([, turn]) => turn.status === 'uncertain').map(([turnId]) => turnId) });
  }
  const next = await nextGeneration(service, dir, (current) => {
    if (current.status === 'needs_presentation_choice') current.presentation = { kind: options.presentation!, workspace: null, error: null };
    current.resubmitUncertain = Boolean(options.resubmitUncertain);
  });
  await appendEvent(dir, { type: 'resumed', generation: next.generation, presentation: next.presentation.kind, resubmitUncertain: Boolean(options.resubmitUncertain) });
  await service.launchRunner(dir, next.generation);
  return { ...summary(record, next, dir), resumed: true };
}

export async function addInput(service: ServiceEnv, id: string, text: string) {
  if (text.trim() === '') throw new GrindError('USAGE', 'discuss input requires a nonempty --brief-file');
  const { dir, record, state } = await load(service, id);
  if (isFinal(state.status)) {
    const linked = await startDiscussion(service, {
      brief: `${record.brief}\n\n## Follow-up input after discussion ${record.id}\n\n${text}`,
      preset: record.config.preset,
      targets: record.targets.map((target) => target.path),
      ...(record.init === null ? { noInit: true } : { init: record.init.id }),
      ...(record.workspace === null ? {} : { workspace: record.workspace }),
      ...(state.presentation.kind === null ? {} : { presentation: state.presentation.kind }),
      linkedFrom: record.id,
    });
    return { linked: true, previous: record.id, discussion: linked };
  }
  const input: UserInput = { id: `i-${Date.now()}-${randomUUID().slice(0, 8)}`, text, receivedAt: new Date().toISOString() };
  await writeJsonExclusive(path.join(paths.inputs(dir), `${input.id}.json`), input);
  await appendEvent(dir, { type: 'input_received', inputId: input.id });
  if (state.status === 'needs_input') {
    assertSupportedPlatform(service.platform);
    const next = await nextGeneration(service, dir, () => undefined);
    await service.launchRunner(dir, next.generation);
    return { linked: false, inputId: input.id, discussion: summary(record, next, dir) };
  }
  return { linked: false, inputId: input.id, discussion: summary(record, state, dir) };
}

export async function stopDiscussion(service: ServiceEnv, id: string) {
  const { dir, record, state } = await load(service, id);
  if (isFinal(state.status)) return { ...summary(record, state, dir), stopped: false };
  await writeJsonExclusive(paths.stop(dir), { requestedAt: new Date().toISOString() });
  await appendEvent(dir, { type: 'stop_requested' });
  if (state.runner && await isSameProcess(state.runner, service.probe)) {
    return { ...summary(record, state, dir, true), stopped: 'requested' };
  }
  const final = await withLock(dir, 'state', async () => {
    const current = (await readState(dir))!;
    for (const [turnId, turn] of Object.entries(current.turns)) {
      if (turn.status !== 'assigned') continue;
      const registration = await readJson<{ identity: { pid: number; started: string } }>(paths.worker(dir, turn.participant, turn.generation));
      await terminateOwned(registration?.identity, 'SIGTERM', service.probe);
      const running = await readJson<{ identity: { pid: number; started: string } | null }>(path.join(paths.attempt(dir, turnId, turn.attempt), 'running.json'));
      await terminateOwned(running?.identity, 'SIGTERM', service.probe);
    }
    cancel(current.protocol, 'Stopped by request');
    current.status = 'cancelled';
    current.generation += 1;
    await writeJsonAtomic(paths.state(dir), { ...current, updatedAt: new Date().toISOString() });
    await writeJsonAtomic(paths.result(dir), buildResult(record, current));
    return current;
  }, service.probe);
  await appendEvent(dir, { type: 'finished', outcome: final.protocol.outcome });
  return { ...summary(record, final, dir), stopped: true };
}

export async function listPresets(service: ServiceEnv, workspaceDir?: string) {
  const { workspace, layered } = await loadConfig(service, workspaceDir);
  return {
    workspace: workspace?.root ?? null,
    sources: layered.sources,
    defaults: layered.merged.defaults,
    presets: Object.entries(layered.merged.presets).map(([name, preset]) => ({ name, source: layered.origins.presets[name], writer: preset.writer, participants: preset.participants })),
    roles: Object.fromEntries(Object.entries(layered.merged.roles).map(([name, role]) => [name, { ...role, source: layered.origins.roles[name] }])),
  };
}

export async function validateConfig(service: ServiceEnv, workspaceDir?: string) {
  const { workspace, layered } = await loadConfig(service, workspaceDir);
  const presets: Array<{ name: string; valid: boolean; error?: string }> = [];
  for (const name of Object.keys(layered.merged.presets)) {
    try {
      resolveEffective(layered, { preset: name });
      presets.push({ name, valid: true });
    } catch (error) {
      presets.push({ name, valid: false, error: (error as Error).message });
    }
  }
  return { workspace: workspace?.root ?? null, sources: layered.sources, valid: presets.every((preset) => preset.valid), presets };
}

/** Entry point of the detached runner process. */
export async function runnerMain(dir: string, generation: number, deps: RunnerDeps = systemRunnerDeps()): Promise<void> {
  await runRunner(await realpath(dir), generation, deps);
}

export function participantGuard(env: NodeJS.ProcessEnv): string | null {
  return env[PARTICIPANT_ENV] ?? null;
}
