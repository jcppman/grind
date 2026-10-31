import { type CmuxAdapter } from './cmux.ts';
import { type ContextSnapshot } from './context.ts';
import { type UserInput } from './protocol.ts';
import { type DiscussionRecord, type RuntimeState } from './runtime.ts';
import { type ProcessProbe } from './store.ts';
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
export declare class Superseded extends Error {
}
export declare function spawnDetachedScript(script: string, logFile: string): Promise<void>;
export declare function buildResult(record: DiscussionRecord, state: RuntimeState): {
    schemaVersion: number;
    id: string;
    init: import("./context.ts").InitBinding | null;
    linkedFrom: string | null;
    outcome: import("./protocol.ts").Outcome | null;
    agreed: boolean;
    applied: boolean;
    application: import("./apply.ts").ApplicationJournal | {
        status: string;
        targets: string[];
    };
    rounds: {
        used: number;
        max: number;
    };
    proposal: {
        revision: number;
        hash: string;
        documents: {
            target: string;
            sha256: string;
            content: string;
        }[];
        assumptions: string[];
        dispositions: import("./protocol.ts").Disposition[];
        summary: string;
        snapshotId: string;
    } | null;
    participants: {
        id: string;
        role: string;
        engine: "claude" | "codex";
        model: string;
        reportedModel: string | null;
        sessionId: string | null;
        writer: boolean;
        decision: import("./protocol.ts").Decision | null;
    }[];
    unresolvedIssues: (import("./protocol.ts").Issue & {
        participant: string;
        revision: number;
    })[];
    questions: (import("./protocol.ts").Issue & {
        participant: string;
    })[];
    evidence: {
        [k: string]: {
            summary: string;
            findings: import("./protocol.ts").Issue[];
        };
    };
    userInput: UserInput[];
    context: {
        snapshotId: string;
        semanticHash: string;
        artifacts: import("./context.ts").ContextArtifact[];
        omissions: string[];
    };
    drift: {
        at: string;
        kind: 'metadata' | 'substantive' | 'target';
        changed: string[];
    }[];
    finishedAt: string;
};
export declare function runRunner(dir: string, generation: number, deps: RunnerDeps): Promise<void>;
