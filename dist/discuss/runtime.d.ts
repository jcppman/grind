import type { AuthorizedTarget, ApplicationJournal } from './apply.ts';
import type { EffectiveConfig, Engine } from './config.ts';
import type { ContextManifest, InitBinding } from './context.ts';
import type { ResolvedExecutable } from './engines.ts';
import type { ProtocolState, TurnKind } from './protocol.ts';
import { type ProcessIdentity } from './store.ts';
export type DiscussionStatus = 'needs_presentation_choice' | 'running' | 'needs_input' | 'needs_recovery' | 'completed' | 'cancelled';
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
    launcher: {
        node: string;
        cli: string;
    };
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
    presentation: {
        kind: 'cmux' | 'headless' | null;
        workspace: string | null;
        error: string | null;
    };
    deadline: string | null;
    protocol: ProtocolState;
    snapshot: {
        id: string;
        manifest: ContextManifest;
    };
    turns: Record<string, TurnRuntime>;
    sessions: Record<string, {
        sessionId: string | null;
        established: boolean;
        reportedModel: string | null;
    }>;
    workers: Record<string, WorkerRuntime>;
    ingestedInputs: string[];
    drift: Array<{
        at: string;
        kind: 'metadata' | 'substantive' | 'target';
        changed: string[];
    }>;
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
    cmux: {
        workspace: string | null;
        surface: string | null;
    };
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
export declare const paths: {
    record: (dir: string) => string;
    state: (dir: string) => string;
    result: (dir: string) => string;
    stop: (dir: string) => string;
    inputs: (dir: string) => string;
    application: (dir: string) => string;
    runnerLog: (dir: string) => string;
    attempt: (dir: string, turnId: string, attempt: number) => string;
    participant: (dir: string, participant: string) => string;
    worker: (dir: string, participant: string, generation: number) => string;
};
export declare const attemptFiles: {
    assignment: (attempt: string) => string;
    brief: (attempt: string) => string;
    schema: (attempt: string) => string;
    claim: (attempt: string) => string;
    launch: (attempt: string) => string;
    running: (attempt: string) => string;
    stdout: (attempt: string) => string;
    stderr: (attempt: string) => string;
    last: (attempt: string) => string;
    outcome: (attempt: string) => string;
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
export declare function readRecord(dir: string): Promise<DiscussionRecord | null>;
export declare function readState(dir: string): Promise<RuntimeState | null>;
export declare function writeState(dir: string, state: RuntimeState): Promise<void>;
export declare function isFinal(status: DiscussionStatus): boolean;
