export type TurnKind = 'assess' | 'draft' | 'ratify';
export type IssueKind = 'objection' | 'evidence_request' | 'user_question';
export type Phase = 'assess' | 'draft' | 'ratify' | 'waiting_input' | 'agreed' | 'unresolved' | 'failed' | 'cancelled';
export declare const TERMINAL_PHASES: readonly Phase[];
export interface Issue {
    id: string;
    kind: IssueKind | 'finding';
    text: string;
    evidence: string[];
}
export interface CandidateDocument {
    target: string;
    content: string;
}
export interface Disposition {
    issueId: string;
    disposition: 'accepted' | 'rejected' | 'deferred';
    rationale: string;
}
export interface Candidate {
    revision: number;
    hash: string;
    documents: CandidateDocument[];
    assumptions: string[];
    dispositions: Disposition[];
    summary: string;
    snapshotId: string;
}
export interface Envelope {
    discussionId: string;
    participant: string;
    turnId: string;
    phase: TurnKind;
    revision: number | null;
    snapshotId: string;
}
export interface AssessResponse extends Envelope {
    phase: 'assess';
    summary: string;
    findings: Issue[];
}
export interface DraftResponse extends Envelope {
    phase: 'draft';
    summary: string;
    documents: CandidateDocument[];
    assumptions: string[];
    dispositions: Disposition[];
}
export interface RatifyResponse extends Envelope {
    phase: 'ratify';
    decision: 'accept' | 'object';
    candidateHash: string;
    objections: Issue[];
}
export type TurnResponse = AssessResponse | DraftResponse | RatifyResponse;
export interface Turn {
    id: string;
    participant: string;
    kind: TurnKind;
    revision: number | null;
    candidateHash: string | null;
    snapshotId: string;
    status: 'pending' | 'done' | 'failed' | 'superseded';
    failure?: string;
}
export interface UserInput {
    id: string;
    text: string;
    receivedAt: string;
}
export interface Decision {
    participant: string;
    revision: number;
    candidateHash: string;
    decision: 'accept' | 'object';
    objections: Issue[];
    turnId: string;
}
export interface Outcome {
    kind: 'agreed' | 'unresolved' | 'failed' | 'cancelled';
    reason: string;
    participant?: string;
}
export interface ProtocolState {
    discussionId: string;
    participants: string[];
    writer: string;
    targets: string[];
    maxRounds: number;
    phase: Phase;
    /** Ratification cycles started; independent assessment and the first draft precede cycle 1. */
    round: number;
    snapshot: {
        id: string;
        semanticHash: string;
    };
    driftRestarts: number;
    nextTurn: number;
    turns: Record<string, Turn>;
    assessments: Record<string, AssessResponse>;
    candidates: Candidate[];
    decisions: Decision[];
    openIssues: Array<Issue & {
        participant: string;
        revision: number;
    }>;
    pendingInput: UserInput[];
    incorporatedInput: UserInput[];
    questions: Array<Issue & {
        participant: string;
    }>;
    outcome: Outcome | null;
}
export declare const PROPOSAL_TARGET = "proposal";
export declare function candidateHash(documents: readonly CandidateDocument[], assumptions: readonly string[]): string;
export declare function sha256(text: string | Buffer): string;
export declare function createProtocol(options: {
    discussionId: string;
    participants: readonly string[];
    writer: string;
    targets: readonly string[];
    maxRounds: number;
    snapshot: {
        id: string;
        semanticHash: string;
    };
}): ProtocolState;
export declare function isTerminal(state: ProtocolState): boolean;
export declare function latestCandidate(state: ProtocolState): Candidate | null;
export declare function pendingTurns(state: ProtocolState): Turn[];
/** Ends the discussion with `outcome`, superseding every outstanding turn. */
export declare function finish(state: ProtocolState, outcome: Outcome): void;
export type ResponseVerdict = {
    accepted: true;
} | {
    accepted: false;
    reason: 'duplicate' | 'stale' | 'unknown_turn' | 'mismatch' | 'invalid';
    detail: string;
};
/**
 * Validates a structured response against the turn it claims to answer and records it.
 * Responses for unknown, superseded or already answered turns never change the state.
 */
export declare function recordResponse(state: ProtocolState, turnId: string, value: unknown): ResponseVerdict;
/** A participant that fails, times out or answers malformed output blocks agreement for the whole discussion. */
export declare function recordFailure(state: ProtocolState, turnId: string, reason: string): void;
export declare function queueInput(state: ProtocolState, input: UserInput): void;
export declare function cancel(state: ProtocolState, reason?: string): void;
/** Ends the discussion when its total time limit passes, even with turns outstanding. */
export declare function expire(state: ProtocolState): void;
export interface Boundary {
    /** Semantic hash of the shared context now; differs from the snapshot after substantive drift. */
    semanticHash: string;
    /** Snapshot identity to adopt if the drift is accepted for re-ratification. */
    snapshotId: string;
    deadlinePassed: boolean;
}
/**
 * Advances the protocol once every outstanding turn of the current phase has
 * finished. Returns false while turns remain outstanding or the state is terminal.
 */
export declare function advance(state: ProtocolState, boundary: Boundary): boolean;
