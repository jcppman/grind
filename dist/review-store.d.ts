export declare const REVIEW_SCHEMA_VERSION = 1;
export declare const MAX_QUOTE_LENGTH = 20000;
export declare const MAX_BODY_LENGTH = 20000;
/**
 * Where a quote came from. The quote is the authority; location fields are
 * recorded only when the capture knew them.
 */
export type ReviewSource = {
    kind: 'claude-reply';
    sessionId: string;
    messageId: string | null;
} | {
    kind: 'terminal';
    surfaceId: string | null;
    workspaceId: string | null;
    sessionId: string | null;
} | {
    kind: 'markdown';
    path: string | null;
    surfaceId: string | null;
    workspaceId: string | null;
    lines: {
        start: number;
        end: number;
    } | null;
    /** `exact` when the quote occurs once in the file on disk, else why no line range is recorded. */
    location: 'exact' | 'ambiguous' | 'unmatched' | 'unknown';
    /** SHA-256 of the file content the line range refers to. */
    contentHash: string | null;
};
export interface ReviewComment {
    id: string;
    source: ReviewSource;
    quote: string;
    body: string;
    capturedAt: string;
    updatedAt: string;
    /** Set while deleted; a deleted comment can be restored until the draft is submitted. */
    deletedAt: string | null;
}
export interface ReviewAssociation {
    workspace: string | null;
    initiative: string | null;
    /** `explicit` when the user chose it, `inferred` when the resolver chose it when the draft started. */
    source: 'explicit' | 'inferred' | 'none';
}
export interface ReviewDraft {
    schemaVersion: 1;
    id: string;
    sessionId: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    association: ReviewAssociation;
    comments: ReviewComment[];
    nextComment: number;
    /** The submission this draft replaced, so a repeated submit of that revision returns it. */
    previous: {
        draftId: string;
        revision: number;
        batchId: string;
    } | null;
}
export interface ReviewSubmission {
    schemaVersion: 1;
    id: string;
    sessionId: string;
    draftId: string;
    revision: number;
    submittedAt: string;
    association: ReviewAssociation;
    comments: ReviewComment[];
}
export type DeliveryState = 'pending' | 'sending' | 'received' | 'dropped' | 'failed' | 'unknown';
export interface DeliveryAttempt {
    id: string;
    startedAt: string;
    updatedAt: string;
    status: Exclude<DeliveryState, 'pending'>;
    rowUuid: string | null;
    reason: string | null;
}
export interface DeliveryRecord {
    schemaVersion: 1;
    batchId: string;
    sessionId: string;
    state: DeliveryState;
    rowUuid: string | null;
    attempts: DeliveryAttempt[];
    resolution: {
        state: 'open' | 'resolved';
        at: string | null;
        note: string | null;
    };
}
export interface SessionRegistration {
    schemaVersion: 1;
    sessionId: string;
    cwd: string;
    workspace: string | null;
    cmux: {
        workspaceId: string | null;
        surfaceId: string | null;
    };
    /** The registering watcher process; a registration whose process is gone is stale. */
    pid: number;
    host: string;
    registeredAt: string;
    endedAt: string | null;
    /** A binding without `setBy` was set by the person. */
    binding: {
        initiative: string;
        workspace: string;
        setBy?: BindingSetter;
    } | null;
}
export type BindingSetter = 'agent' | 'user';
export interface ReviewStore {
    root: string;
}
/** The local review store: outside every Git-tracked state repository, private to this user and machine. */
export declare function reviewStore(env?: NodeJS.ProcessEnv): ReviewStore;
export declare function assertSessionId(sessionId: string): void;
export declare const changePath: (store: ReviewStore) => string;
/** Runs `action` holding the store's lock, waiting briefly for another writer and clearing a lock whose owner died. */
export declare function withReviewLock<T>(store: ReviewStore, action: () => Promise<T>): Promise<T>;
export declare function readDraft(store: ReviewStore, sessionId: string): Promise<ReviewDraft | null>;
/** What a mutation was based on: the draft and revision the caller last read. */
export interface DraftExpectation {
    draftId?: string;
    revision?: number;
}
export interface AddCommentInput {
    source: ReviewSource;
    quote: string;
    body?: string;
    /** The association a new draft takes; an existing draft keeps its own. */
    association: ReviewAssociation;
    expected?: DraftExpectation;
}
/** Adds a comment to the session's draft, starting a draft when there is none. */
export declare function addComment(store: ReviewStore, sessionId: string, input: AddCommentInput): Promise<{
    draft: ReviewDraft;
    comment: ReviewComment;
}>;
export type CommentChange = {
    kind: 'edit';
    body: string;
} | {
    kind: 'delete';
} | {
    kind: 'restore';
};
export declare function changeComment(store: ReviewStore, sessionId: string, commentId: string, change: CommentChange, expected?: DraftExpectation): Promise<ReviewDraft>;
/** Changes the init a draft belongs to; only an explicit request does this. */
export declare function associateDraft(store: ReviewStore, sessionId: string, association: ReviewAssociation, expected?: DraftExpectation): Promise<ReviewDraft>;
export interface SubmitResult {
    submission: ReviewSubmission;
    delivery: DeliveryRecord;
    draft: ReviewDraft;
    /** True when this revision was already submitted and the existing batch is returned. */
    repeated: boolean;
}
/**
 * Freezes exactly the reviewed revision into an immutable batch and starts an
 * empty draft with the same association.
 */
export declare function submitDraft(store: ReviewStore, sessionId: string, draftId: string, revision: number): Promise<SubmitResult>;
export declare function readSubmission(store: ReviewStore, batchId: string): Promise<ReviewSubmission>;
export declare function readDelivery(store: ReviewStore, batchId: string): Promise<DeliveryRecord>;
/**
 * Starts a delivery attempt. Refuses while one is in flight or after the batch
 * was received, so repeated clicks never enqueue the batch twice; after an
 * unknown outcome only an explicit confirmation sends it again.
 */
export declare function startAttempt(store: ReviewStore, batchId: string, options?: {
    afterUnknown?: boolean;
}): Promise<{
    delivery: DeliveryRecord;
    attempt: DeliveryAttempt;
}>;
export interface AttemptOutcome {
    status: 'received' | 'dropped' | 'failed' | 'unknown';
    rowUuid?: string;
    reason?: string;
}
/** Records how an attempt (or `latest`) ended. A received batch stays received whatever a later report says. */
export declare function finishAttempt(store: ReviewStore, batchId: string, attemptId: string, outcome: AttemptOutcome): Promise<DeliveryRecord>;
export declare function resolveBatch(store: ReviewStore, batchId: string, note: string | null): Promise<DeliveryRecord>;
export interface BatchSummary {
    submission: ReviewSubmission;
    delivery: DeliveryRecord;
}
/** Submitted batches, newest first, optionally narrowed to a session or an init. */
export declare function listBatches(store: ReviewStore, filter?: {
    sessionId?: string;
    workspace?: string;
    initiative?: string;
}): Promise<BatchSummary[]>;
/** Submitted batches of an init that are not yet marked resolved. */
export declare function openInitiativeBatches(store: ReviewStore, workspace: string, initiative: string): Promise<BatchSummary[]>;
export declare function registerSession(store: ReviewStore, registration: Omit<SessionRegistration, 'schemaVersion' | 'registeredAt' | 'endedAt' | 'binding'>): Promise<SessionRegistration>;
/** Marks the session ended, but only while `pid` still owns the registration. */
export declare function endSession(store: ReviewStore, sessionId: string, pid: number): Promise<void>;
export declare function bindSession(store: ReviewStore, sessionId: string, binding: SessionRegistration['binding']): Promise<SessionRegistration>;
export declare function readSession(store: ReviewStore, sessionId: string): Promise<SessionRegistration | null>;
/** Registered sessions whose watcher still runs on this machine. */
export declare function liveSessions(store: ReviewStore): Promise<SessionRegistration[]>;
export interface ReviewReference {
    batch: string;
    submittedAt: string;
    comments: number;
    delivery: DeliveryState;
    /** Prints the frozen batch; the quotes stay in the local store. */
    read: string;
}
/** Unresolved submitted batches of an init, as references without quoted text. */
export declare function initiativeReviewReferences(workspace: string, initiative: string, store?: ReviewStore): Promise<ReviewReference[]>;
