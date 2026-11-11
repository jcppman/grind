export class GrindError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'GrindError';
        this.code = code;
        this.details = details;
    }
    toJSON() {
        return this.details === undefined
            ? { code: this.code, message: this.message }
            : { code: this.code, message: this.message, details: this.details };
    }
}
export function diagnostic(severity, code, message, path) {
    return path === undefined ? { severity, code, message } : { severity, code, message, path };
}
export function hasErrors(diagnostics) {
    return diagnostics.some((d) => d.severity === 'error');
}
//# sourceMappingURL=errors.js.map