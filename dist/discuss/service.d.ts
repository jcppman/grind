import { type Workspace } from '../workspace.ts';
import { type CmuxAdapter } from './cmux.ts';
import { type Presentation } from './config.ts';
import { type RunnerDeps } from './runner.ts';
import { type ProcessProbe } from './store.ts';
export interface ServiceEnv {
    cwd: string;
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
    probe: ProcessProbe;
    cmux: CmuxAdapter;
    /** Starts the detached runner for a generation. */
    launchRunner(dir: string, generation: number): Promise<void>;
}
export declare function cliEntry(): string;
export declare function systemServiceEnv(cwd: string, env?: NodeJS.ProcessEnv): ServiceEnv;
export declare function systemRunnerDeps(): RunnerDeps;
/** Discussion execution is macOS-only in this version; refuse before any launch or state change. */
export declare function assertSupportedPlatform(platform: NodeJS.Platform): void;
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
export declare function loadConfig(service: ServiceEnv, workspaceDir?: string): Promise<{
    workspace: Workspace | null;
    layered: import("./config.ts").LayeredConfig;
}>;
export declare function startDiscussion(service: ServiceEnv, options: StartOptions): Promise<{
    id: string;
    dir: string;
    status: string;
    init: import("./context.ts").InitBinding | null;
    preset: string;
    presentation: {
        kind: 'cmux' | 'headless' | null;
        workspace: string | null;
        error: string | null;
    };
    phase: import("./protocol.ts").Phase;
    round: number;
    maxRounds: number;
    outcome: import("./protocol.ts").Outcome | null;
    participants: {
        id: string;
        role: string;
        engine: "claude" | "codex";
        model: string;
        writer: boolean;
    }[];
    targets: string[];
    questions: (import("./protocol.ts").Issue & {
        participant: string;
    })[];
    error: string | null;
    deadline: string | null;
    resultAvailable: boolean;
    nextCommand: string;
}>;
export declare function discussionStatus(service: ServiceEnv, id: string): Promise<{
    id: string;
    dir: string;
    status: string;
    init: import("./context.ts").InitBinding | null;
    preset: string;
    presentation: {
        kind: 'cmux' | 'headless' | null;
        workspace: string | null;
        error: string | null;
    };
    phase: import("./protocol.ts").Phase;
    round: number;
    maxRounds: number;
    outcome: import("./protocol.ts").Outcome | null;
    participants: {
        id: string;
        role: string;
        engine: "claude" | "codex";
        model: string;
        writer: boolean;
    }[];
    targets: string[];
    questions: (import("./protocol.ts").Issue & {
        participant: string;
    })[];
    error: string | null;
    deadline: string | null;
    resultAvailable: boolean;
    nextCommand: string;
    runnerAlive: boolean | null;
    runnerStarting: boolean;
    inspectionError: string | null;
    turns: {
        id: string;
        participant: string;
        kind: import("./protocol.ts").TurnKind;
        revision: number | null;
        status: "done" | "failed" | "pending" | "superseded";
        runtime: "assigned" | "finished" | "retry" | "uncertain" | null;
        attempt: number | null;
    }[];
    recentEvents: Record<string, unknown>[];
}>;
export declare function discussionResult(service: ServiceEnv, id: string): Promise<Record<string, unknown>>;
export interface WaitOptions {
    timeoutSeconds: number;
    /** Ends the wait early as `caller_cancelled`; the discussion itself is never touched. */
    signal?: AbortSignal;
    pollMs?: number;
}
/**
 * Waits without changing anything until the discussion finishes or needs the caller: user input,
 * a presentation choice, recovery, or a confirmed runner exit. Returns `timeout` or
 * `caller_cancelled` otherwise. Unknown runner liveness keeps waiting and never counts as an exit.
 */
export declare function waitDiscussion(service: ServiceEnv, id: string, options: WaitOptions): Promise<{
    id: string;
    reason: "attention" | "caller_cancelled" | "final" | "timeout";
    waitedSeconds: number;
    discussion: {
        id: string;
        dir: string;
        status: string;
        init: import("./context.ts").InitBinding | null;
        preset: string;
        presentation: {
            kind: 'cmux' | 'headless' | null;
            workspace: string | null;
            error: string | null;
        };
        phase: import("./protocol.ts").Phase;
        round: number;
        maxRounds: number;
        outcome: import("./protocol.ts").Outcome | null;
        participants: {
            id: string;
            role: string;
            engine: "claude" | "codex";
            model: string;
            writer: boolean;
        }[];
        targets: string[];
        questions: (import("./protocol.ts").Issue & {
            participant: string;
        })[];
        error: string | null;
        deadline: string | null;
        resultAvailable: boolean;
        nextCommand: string;
        runnerAlive: boolean | null;
        runnerStarting: boolean;
        inspectionError: string | null;
        turns: {
            id: string;
            participant: string;
            kind: import("./protocol.ts").TurnKind;
            revision: number | null;
            status: "done" | "failed" | "pending" | "superseded";
            runtime: "assigned" | "finished" | "retry" | "uncertain" | null;
            attempt: number | null;
        }[];
        recentEvents: Record<string, unknown>[];
    };
    result: Record<string, unknown> | null;
    nextCommand: string | null;
}>;
export declare function listDiscussions(service: ServiceEnv): Promise<{
    discussions: {
        id: string;
        status: import("./runtime.ts").DiscussionStatus;
        init: string | null;
        preset: string;
        createdAt: string;
        outcome: "agreed" | "cancelled" | "failed" | "unresolved" | null;
    }[];
}>;
export declare function resumeDiscussion(service: ServiceEnv, id: string, options: {
    presentation?: Presentation;
    resubmitUncertain?: boolean;
}): Promise<{
    id: string;
    dir: string;
    status: string;
    init: import("./context.ts").InitBinding | null;
    preset: string;
    presentation: {
        kind: 'cmux' | 'headless' | null;
        workspace: string | null;
        error: string | null;
    };
    phase: import("./protocol.ts").Phase;
    round: number;
    maxRounds: number;
    outcome: import("./protocol.ts").Outcome | null;
    participants: {
        id: string;
        role: string;
        engine: "claude" | "codex";
        model: string;
        writer: boolean;
    }[];
    targets: string[];
    questions: (import("./protocol.ts").Issue & {
        participant: string;
    })[];
    error: string | null;
    deadline: string | null;
    resultAvailable: boolean;
    nextCommand: string;
    resumed: boolean;
}>;
export declare function addInput(service: ServiceEnv, id: string, text: string): Promise<{
    linked: boolean;
    previous: string;
    discussion: {
        id: string;
        dir: string;
        status: string;
        init: import("./context.ts").InitBinding | null;
        preset: string;
        presentation: {
            kind: 'cmux' | 'headless' | null;
            workspace: string | null;
            error: string | null;
        };
        phase: import("./protocol.ts").Phase;
        round: number;
        maxRounds: number;
        outcome: import("./protocol.ts").Outcome | null;
        participants: {
            id: string;
            role: string;
            engine: "claude" | "codex";
            model: string;
            writer: boolean;
        }[];
        targets: string[];
        questions: (import("./protocol.ts").Issue & {
            participant: string;
        })[];
        error: string | null;
        deadline: string | null;
        resultAvailable: boolean;
        nextCommand: string;
    };
    inputId?: never;
} | {
    previous?: never;
    linked: boolean;
    inputId: string;
    discussion: {
        id: string;
        dir: string;
        status: string;
        init: import("./context.ts").InitBinding | null;
        preset: string;
        presentation: {
            kind: 'cmux' | 'headless' | null;
            workspace: string | null;
            error: string | null;
        };
        phase: import("./protocol.ts").Phase;
        round: number;
        maxRounds: number;
        outcome: import("./protocol.ts").Outcome | null;
        participants: {
            id: string;
            role: string;
            engine: "claude" | "codex";
            model: string;
            writer: boolean;
        }[];
        targets: string[];
        questions: (import("./protocol.ts").Issue & {
            participant: string;
        })[];
        error: string | null;
        deadline: string | null;
        resultAvailable: boolean;
        nextCommand: string;
    };
}>;
export declare function stopDiscussion(service: ServiceEnv, id: string): Promise<{
    id: string;
    dir: string;
    status: string;
    init: import("./context.ts").InitBinding | null;
    preset: string;
    presentation: {
        kind: 'cmux' | 'headless' | null;
        workspace: string | null;
        error: string | null;
    };
    phase: import("./protocol.ts").Phase;
    round: number;
    maxRounds: number;
    outcome: import("./protocol.ts").Outcome | null;
    participants: {
        id: string;
        role: string;
        engine: "claude" | "codex";
        model: string;
        writer: boolean;
    }[];
    targets: string[];
    questions: (import("./protocol.ts").Issue & {
        participant: string;
    })[];
    error: string | null;
    deadline: string | null;
    resultAvailable: boolean;
    nextCommand: string;
    stopped: boolean;
} | {
    id: string;
    dir: string;
    status: string;
    init: import("./context.ts").InitBinding | null;
    preset: string;
    presentation: {
        kind: 'cmux' | 'headless' | null;
        workspace: string | null;
        error: string | null;
    };
    phase: import("./protocol.ts").Phase;
    round: number;
    maxRounds: number;
    outcome: import("./protocol.ts").Outcome | null;
    participants: {
        id: string;
        role: string;
        engine: "claude" | "codex";
        model: string;
        writer: boolean;
    }[];
    targets: string[];
    questions: (import("./protocol.ts").Issue & {
        participant: string;
    })[];
    error: string | null;
    deadline: string | null;
    resultAvailable: boolean;
    nextCommand: string;
    stopped: string;
}>;
export declare function listPresets(service: ServiceEnv, workspaceDir?: string): Promise<{
    workspace: string | null;
    sources: import("./config.ts").ConfigSource[];
    defaults: Partial<import("./config.ts").Defaults>;
    presets: {
        name: string;
        source: string | undefined;
        writer: string;
        participants: import("./config.ts").Participant[];
    }[];
    roles: {
        [k: string]: {
            instructions: string;
            source: string | undefined;
        };
    };
}>;
export declare function validateConfig(service: ServiceEnv, workspaceDir?: string): Promise<{
    workspace: string | null;
    sources: import("./config.ts").ConfigSource[];
    valid: boolean;
    presets: {
        name: string;
        valid: boolean;
        error?: string;
    }[];
}>;
/** Entry point of the detached runner process. */
export declare function runnerMain(dir: string, generation: number, deps?: RunnerDeps): Promise<void>;
export declare function participantGuard(env: NodeJS.ProcessEnv): string | null;
