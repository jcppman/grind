export type ErrorCode = 'STATE_LOCKED' | 'REPOSITORY_LOCKED' | 'OPERATION_PENDING' | 'OPERATION_INVALID' | 'NOTE_INVALID' | 'REVIEW_INVALID' | 'REVIEW_STALE' | 'REVIEW_EMPTY' | 'REVIEW_DELIVERY_BUSY' | 'REVIEW_DESTINATION' | 'REVIEW_CAPTURE_FAILED' | 'VERIFICATION_REQUIRED' | 'PENDING_NOTES' | 'ARCHIVE_BLOCKED' | 'INITIATIVE_EXISTS' | 'WRITE_FAILED' | 'INDEX_NOT_CLEAN' | 'COMMIT_FAILED' | 'USAGE' | 'UNSUPPORTED_OPERATION' | 'WORKSPACE_NOT_FOUND' | 'WORKSPACE_CONFIG_INVALID' | 'STATE_REPOSITORY_INVALID' | 'INITIATIVE_NOT_FOUND' | 'INITIATIVE_UNRESOLVED' | 'INITIATIVE_AMBIGUOUS' | 'PATH_ESCAPE' | 'ARTIFACT_INVALID' | 'CHECKOUT_HELD' | 'SWITCH_BLOCKED' | 'SWITCH_INCOMPLETE' | 'TRANSITION_UNSUPPORTED' | 'GIT_ERROR' | 'UNSUPPORTED_PLATFORM' | 'DISCUSSION_CONFIG_INVALID' | 'DISCUSSION_NOT_FOUND' | 'DISCUSSION_INVALID' | 'DISCUSSION_STATE' | 'DISCUSSION_LOCKED' | 'PROCESS_INSPECTION_FAILED' | 'DISCUSSION_TARGET_INVALID' | 'ENGINE_UNAVAILABLE' | 'PRESENTATION_UNAVAILABLE' | 'PARTICIPANT_FORBIDDEN';
export declare class GrindError extends Error {
    readonly code: ErrorCode;
    readonly details: unknown;
    constructor(code: ErrorCode, message: string, details?: unknown);
    toJSON(): {
        code: ErrorCode;
        message: string;
        details?: unknown;
    };
}
export type Severity = 'error' | 'warning';
/** A problem found while reading records. Readers report these instead of throwing. */
export interface Diagnostic {
    severity: Severity;
    code: string;
    message: string;
    path?: string;
}
export declare function diagnostic(severity: Severity, code: string, message: string, path?: string): Diagnostic;
export declare function hasErrors(diagnostics: readonly Diagnostic[]): boolean;
