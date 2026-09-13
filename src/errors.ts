export type ErrorCode =
  | 'USAGE'
  | 'UNSUPPORTED_OPERATION'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_CONFIG_INVALID'
  | 'STATE_REPOSITORY_INVALID'
  | 'INITIATIVE_NOT_FOUND'
  | 'INITIATIVE_UNRESOLVED'
  | 'INITIATIVE_AMBIGUOUS'
  | 'PATH_ESCAPE'
  | 'ARTIFACT_INVALID'
  | 'GIT_ERROR';

export class GrindError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'GrindError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details?: unknown } {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export type Severity = 'error' | 'warning';

/** A problem found while reading records. Readers report these instead of throwing. */
export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
}

export function diagnostic(
  severity: Severity,
  code: string,
  message: string,
  path?: string,
): Diagnostic {
  return path === undefined ? { severity, code, message } : { severity, code, message, path };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
