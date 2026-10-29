import path from 'node:path';
import type { AuthorizedTarget, ApplicationJournal } from './apply.ts';
import type { EffectiveConfig, Engine } from './config.ts';
import type { ContextManifest, InitBinding } from './context.ts';
import type { ResolvedExecutable } from './engines.ts';
import type { ProtocolState, TurnKind } from './protocol.ts';
import { readJson, writeJsonAtomic, type ProcessIdentity } from './store.ts';

export type DiscussionStatus =
  | 'needs_presentation_choice'
  | 'running'
  | 'needs_input'
  | 'needs_recovery'
  | 'completed'
  | 'cancelled';

export interface DiscussionRecord {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  platform: NodeJS.Platform;
  brief: string;
  briefSha256: string;
  workspace: string | null;
  init: InitBinding | null;
  config: EffectiveConfig;
  executables: Partial<Record<Engine, ResolvedExecutable>>;
  /** Provider configuration directory in effect when the discussion started; credentials are never recorded. */
  claudeConfigDir: string | null;
  targets: AuthorizedTarget[];
  linkedFrom: string | null;
  launcher: { node: string; cli: string };
}

export interface TurnRuntime {
  attempt: number;
  generation: number;
  participant: string;
  engine: Engine;
  sessionId: string | null;
  resume: boolean;
  /** `retry` means nothing ran and the turn may be assigned again; `uncertain` needs explicit recovery. */
  status: 'assigned' | 'finished' | 'uncertain' | 'retry';
  assignedAt: string;
}

export interface WorkerRuntime {
  generation: number;
  token: string;
  launchedAt: string;
  surface: string | null;
  launches: number;
}

export interface RuntimeState {
  status: DiscussionStatus;
  generation: number;
  runner: ProcessIdentity | null;
  presentation: { kind: 'cmux' | 'headless' | null; workspace: string | null; error: string | null };
  deadline: string | null;
  protocol: ProtocolState;
  snapshot: { id: string; manifest: ContextManifest };
  turns: Record<string, TurnRuntime>;
  sessions: Record<string, { sessionId: string | null; established: boolean; reportedModel: string | null }>;
  workers: Record<string, WorkerRuntime>;
  ingestedInputs: string[];
  drift: Array<{ at: string; kind: 'metadata' | 'substantive' | 'target'; changed: string[] }>;
  application: ApplicationJournal | null;
  resubmitUncertain: boolean;
  error: string | null;
  updatedAt: string;
}

export interface WorkerRegistration {
  participant: string;
  generation: number;
  token: string;
  identity: ProcessIdentity;
  cmux: { workspace: string | null; surface: string | null };
}

export interface TurnOutcome {
  kind: 'response' | 'failure';
  response?: unknown;
  failure?: string;
  sessionId: string | null;
  model: string | null;
  exitCode: number | null;
  finishedAt: string;
}

export const paths = {
  record: (dir: string) => path.join(dir, 'discussion.json'),
  state: (dir: string) => path.join(dir, 'state.json'),
  result: (dir: string) => path.join(dir, 'result.json'),
  stop: (dir: string) => path.join(dir, 'stop.json'),
  inputs: (dir: string) => path.join(dir, 'inputs'),
  application: (dir: string) => path.join(dir, 'application.json'),
  runnerLog: (dir: string) => path.join(dir, 'runner.log'),
  attempt: (dir: string, turnId: string, attempt: number) => path.join(dir, 'turns', turnId, `a${attempt}`),
  participant: (dir: string, participant: string) => path.join(dir, 'participants', participant),
  worker: (dir: string, participant: string, generation: number) => path.join(dir, 'workers', `${participant}-g${generation}.json`),
};

export const attemptFiles = {
  assignment: (attempt: string) => path.join(attempt, 'assignment.json'),
  brief: (attempt: string) => path.join(attempt, 'brief.md'),
  schema: (attempt: string) => path.join(attempt, 'schema.json'),
  claim: (attempt: string) => path.join(attempt, 'claim.json'),
  launch: (attempt: string) => path.join(attempt, 'launch.json'),
  running: (attempt: string) => path.join(attempt, 'running.json'),
  stdout: (attempt: string) => path.join(attempt, 'stdout.log'),
  stderr: (attempt: string) => path.join(attempt, 'stderr.log'),
  last: (attempt: string) => path.join(attempt, 'last.txt'),
  outcome: (attempt: string) => path.join(attempt, 'outcome.json'),
};

export interface Assignment {
  discussionId: string;
  turnId: string;
  kind: TurnKind;
  attempt: number;
  generation: number;
  participant: string;
  engine: Engine;
  model: string;
  executable: string;
  sessionId: string | null;
  resume: boolean;
  cwd: string;
  readableRoots: string[];
  turnTimeoutSeconds: number;
  claudeConfigDir: string | null;
}

export async function readRecord(dir: string): Promise<DiscussionRecord | null> {
  return readJson<DiscussionRecord>(paths.record(dir));
}

export async function readState(dir: string): Promise<RuntimeState | null> {
  return readJson<RuntimeState>(paths.state(dir));
}

export async function writeState(dir: string, state: RuntimeState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(paths.state(dir), state);
}

export function isFinal(status: DiscussionStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}
