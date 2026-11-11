import { type DiscussionRecord, type RuntimeState } from './runtime.ts';
import { type ProcessProbe } from './store.ts';
export interface CallerSubmission {
    receipt: {
        discussionId: string;
        turnId: string;
        participant: string;
        responseHash: string;
        receivedAt: string;
        identity: string | null;
        handoffFrom: string | null;
    };
    response: unknown;
}
export declare function callerIdentity(env: NodeJS.ProcessEnv): string | null;
export declare function callerDeadline(record: DiscussionRecord, state: RuntimeState, turnId: string): number;
export declare function callerAssignment(dir: string, record: DiscussionRecord, state: RuntimeState): Promise<{
    discussionId: string;
    participant: string;
    turnId: string;
    phase: import("./protocol.ts").TurnKind;
    revision: number | null;
    candidateHash: string | null;
    snapshotId: string;
    identity: string | null;
    assignment: string;
    responseSchema: object;
    contextPaths: {
        bundle: string;
        manifest: string;
        work: string;
    };
} | null>;
export declare function submitCaller(service: {
    env: NodeJS.ProcessEnv;
    probe: ProcessProbe;
}, id: string, response: unknown, options?: {
    handoff?: boolean;
}): Promise<{
    discussionId: string;
    turnId: string;
    participant: string;
    responseHash: string;
    receivedAt: string;
    identity: string | null;
    handoffFrom: string | null;
}>;
