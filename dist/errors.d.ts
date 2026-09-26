export type ErrorCode = 'STATE_LOCKED' | 'REPOSITORY_LOCKED' | 'OPERATION_PENDING' | 'OPERATION_INVALID' | 'NOTE_INVALID' | 'PENDING_NOTES' | 'ARCHIVE_BLOCKED' | 'INITIATIVE_EXISTS' | 'WRITE_FAILED' | 'INDEX_NOT_CLEAN' | 'COMMIT_FAILED' | 'USAGE' | 'UNSUPPORTED_OPERATION' | 'WORKSPACE_NOT_FOUND' | 'WORKSPACE_CONFIG_INVALID' | 'STATE_REPOSITORY_INVALID' | 'INITIATIVE_NOT_FOUND' | 'INITIATIVE_UNRESOLVED' | 'INITIATIVE_AMBIGUOUS' | 'PATH_ESCAPE' | 'ARTIFACT_INVALID' | 'START_BLOCKED' | 'TRANSITION_UNSUPPORTED' | 'GIT_ERROR';
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
