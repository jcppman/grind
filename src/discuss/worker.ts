import { spawn } from 'node:child_process';
import { createWriteStream, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { engineArgs, parseEngineOutput, responseSchema } from './engines.ts';
import type { CmuxAdapter } from './cmux.ts';
import { attemptFiles, paths, readRecord, readState, type Assignment, type TurnOutcome, type WorkerRegistration } from './runtime.ts';
import { readJson, systemProbe, writeJsonAtomic, writeJsonExclusive, type ProcessProbe } from './store.ts';

/** Engine children see this marker; mutating Grind commands refuse to run under it. */
export const PARTICIPANT_ENV = 'GRIND_DISCUSSION_PARTICIPANT';
const KILL_GRACE_MS = 5_000;

export interface WorkerOptions {
  dir: string;
  participant: string;
  generation: number;
  token: string;
  probe?: ProcessProbe;
  cmux?: CmuxAdapter | null;
  log?: (line: string) => void;
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
      watcher = watch(dir, { recursive: true }, done);
    } catch {
      watcher = null;
    }
  });
}

function summarize(line: string): string | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = String(event['type'] ?? '');
  if (type === 'assistant') {
    const content = (event['message'] as { content?: Array<Record<string, unknown>> } | undefined)?.content ?? [];
    return content.map((item) => item['type'] === 'text' ? `  ${String(item['text']).slice(0, 400)}` : item['type'] === 'tool_use' ? `  [tool] ${String(item['name'])} ${JSON.stringify(item['input']).slice(0, 160)}` : '').filter(Boolean).join('\n') || null;
  }
  if (type === 'item.completed') {
    const item = event['item'] as Record<string, unknown> | undefined;
    if (item?.['type'] === 'agent_message') return `  ${String(item['text']).slice(0, 400)}`;
    if (item?.['type'] === 'command_execution') return `  [command] ${String(item['command']).slice(0, 160)}`;
    return null;
  }
  if (type === 'result' || type === 'turn.completed' || type === 'turn.failed') return `  [${type}]`;
  return null;
}

/**
 * Serves this participant's turns for one runner generation. Each turn's
 * intent is persisted before the engine starts, so a crash between launch and
 * completion is visible to the runner as an uncertain execution.
 */
export async function runWorker(options: WorkerOptions): Promise<number> {
  const probe = options.probe ?? systemProbe;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const identity = await probe.identify(process.pid);
  if (identity === null) throw new Error('Cannot determine this worker process identity');
  const record = await readRecord(options.dir);
  if (record === null) throw new Error(`No discussion at ${options.dir}`);
  const registration: WorkerRegistration = {
    participant: options.participant,
    generation: options.generation,
    token: options.token,
    identity,
    cmux: { workspace: process.env['CMUX_WORKSPACE_ID'] ?? null, surface: process.env['CMUX_SURFACE_ID'] ?? null },
  };
  await writeJsonAtomic(paths.worker(options.dir, options.participant, options.generation), registration);
  const participant = record.config.participants.find((item) => item.id === options.participant);
  const title = `${record.init?.id ?? 'no init'} · ${record.id} · ${options.participant} (${participant?.role ?? '?'}, ${participant?.engine ?? '?'})`;
  if (options.cmux && registration.cmux.surface) await options.cmux.renameOwnTab(title).catch(() => undefined);
  log(`Grind discussion worker: ${title}`);
  let child: ReturnType<typeof spawn> | null = null;
  let stopping = false;
  const onSignal = () => {
    stopping = true;
    if (child?.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, onSignal);
  try {
    while (!stopping) {
      const state = await readState(options.dir);
      if (state === null || state.generation !== options.generation || state.status !== 'running') return 0;
      const next = Object.entries(state.turns).find(([, turn]) => turn.participant === options.participant && turn.generation === options.generation && turn.status === 'assigned');
      if (next) {
        const [turnId, turn] = next;
        const attempt = paths.attempt(options.dir, turnId, turn.attempt);
        const assignment = await readJson<Assignment>(attemptFiles.assignment(attempt));
        if (assignment && assignment.generation === options.generation && (await readJson(attemptFiles.outcome(attempt))) === null
          && await writeJsonExclusive(attemptFiles.claim(attempt), { token: options.token, identity, at: new Date().toISOString() })) {
          log(`\n▶ ${turnId} (attempt ${turn.attempt})`);
          const outcome = await runTurn(assignment, attempt, probe, (spawned) => { child = spawned; }, log, () => stopping);
          child = null;
          if (outcome !== null) {
            await writeJsonAtomic(attemptFiles.outcome(attempt), outcome);
            log(outcome.kind === 'response' ? `✔ ${turnId} answered` : `✖ ${turnId} failed: ${outcome.failure}`);
          }
          continue;
        }
      }
      await waitForChange(options.dir, 1_000);
    }
    return 0;
  } finally {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.off(signal, onSignal);
  }
}

async function runTurn(assignment: Assignment, attempt: string, probe: ProcessProbe, onSpawn: (child: ReturnType<typeof spawn>) => void, log: (line: string) => void, stopping: () => boolean): Promise<TurnOutcome | null> {
  const brief = await readFile(attemptFiles.brief(attempt), 'utf8');
  const schema = responseSchema(assignment.kind);
  await writeJsonAtomic(attemptFiles.schema(attempt), schema);
  const args = engineArgs({
    engine: assignment.engine,
    model: assignment.model,
    sessionId: assignment.sessionId,
    resume: assignment.resume,
    cwd: assignment.cwd,
    readableRoots: assignment.readableRoots,
    schema,
    schemaFile: attemptFiles.schema(attempt),
    lastMessageFile: attemptFiles.last(attempt),
  });
  const env: NodeJS.ProcessEnv = { ...process.env, [PARTICIPANT_ENV]: `${assignment.discussionId}:${assignment.participant}` };
  if (assignment.engine === 'claude') {
    if (assignment.claudeConfigDir === null) delete env['CLAUDE_CONFIG_DIR'];
    else env['CLAUDE_CONFIG_DIR'] = assignment.claudeConfigDir;
  }
  await writeJsonAtomic(attemptFiles.launch(attempt), { sessionId: assignment.sessionId, resume: assignment.resume, at: new Date().toISOString() });
  const stdoutLog = createWriteStream(attemptFiles.stdout(attempt), { mode: 0o600 });
  const stderrLog = createWriteStream(attemptFiles.stderr(attempt), { mode: 0o600 });
  let stdout = '';
  let timedOut = false;
  const exit = await new Promise<{ code: number | null; error: string | null }>((resolve) => {
    const engine = spawn(assignment.executable, args, { cwd: assignment.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    onSpawn(engine);
    void (async () => {
      const identity = engine.pid === undefined ? null : await probe.identify(engine.pid);
      await writeJsonAtomic(attemptFiles.running(attempt), { identity, at: new Date().toISOString() }).catch(() => undefined);
    })();
    const kill = (signal: NodeJS.Signals) => {
      if (engine.pid === undefined) return;
      try { process.kill(-engine.pid, signal); } catch { /* exited */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS).unref();
    }, assignment.turnTimeoutSeconds * 1000);
    let buffer = '';
    engine.stdout.on('data', (chunk: Buffer) => {
      stdoutLog.write(chunk);
      stdout += chunk.toString('utf8');
      buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const summary = summarize(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (summary) log(summary);
      }
    });
    engine.stderr.on('data', (chunk: Buffer) => stderrLog.write(chunk));
    engine.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, error: error.message });
    });
    engine.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, error: null });
    });
    engine.stdin.on('error', () => undefined);
    engine.stdin.end(brief);
  });
  await Promise.all([new Promise((resolve) => stdoutLog.end(resolve)), new Promise((resolve) => stderrLog.end(resolve))]);
  // An interrupted worker leaves no outcome; the runner reconciles from the recorded launch and output.
  if (stopping() && !timedOut) return null;
  const last = await readFile(attemptFiles.last(attempt), 'utf8').catch(() => null);
  const parsed = parseEngineOutput(assignment.engine, stdout, last);
  const base = { sessionId: parsed.sessionId ?? assignment.sessionId, model: parsed.model, exitCode: exit.code, finishedAt: new Date().toISOString() };
  if (timedOut) return { kind: 'failure', failure: `turn exceeded ${assignment.turnTimeoutSeconds}s`, ...base };
  if (exit.error !== null) return { kind: 'failure', failure: `engine did not start: ${exit.error}`, ...base };
  if (parsed.error !== null || exit.code !== 0) {
    const stderr = await readFile(attemptFiles.stderr(attempt), 'utf8').catch(() => '');
    return { kind: 'failure', failure: `${parsed.error ?? `engine exited with ${exit.code}`}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`, ...base };
  }
  return { kind: 'response', response: parsed.output, ...base };
}

export function workerArgs(dir: string, participant: string, generation: number, token: string): string[] {
  return ['discuss', 'worker', '--dir', dir, '--participant', participant, '--generation', String(generation), '--token', token];
}

export function launchScript(options: { node: string; cli: string; dir: string; participant: string; generation: number; token: string; env: Record<string, string | null> }): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const lines = ['#!/bin/sh'];
  for (const [key, value] of Object.entries(options.env)) lines.push(value === null ? `unset ${key}` : `export ${key}=${quote(value)}`);
  lines.push(`exec ${[options.node, options.cli, ...workerArgs(options.dir, options.participant, options.generation, options.token)].map(quote).join(' ')}`);
  return `${lines.join('\n')}\n`;
}

export function scriptPath(dir: string, participant: string, generation: number): string {
  return path.join(paths.participant(dir, participant), `launch-g${generation}.sh`);
}
