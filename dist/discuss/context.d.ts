import type { Workspace } from '../workspace.ts';
/** Volatile ledger metadata ignored when deciding whether shared context changed substantively. */
export declare const VOLATILE_LEDGER_FIELDS: readonly ['grind.updated_at'];
export interface InitBinding {
    id: string;
    workspace: string;
    source: 'explicit' | 'folder' | 'branch';
}
export interface ContextArtifact {
    label: string;
    path: string;
    sha256: string;
    semanticSha256: string;
    /** Targets are hashed separately: their drift is a write conflict, not a context change. */
    target: boolean;
}
export interface ContextManifest {
    init: InitBinding | null;
    workspace: string | null;
    artifacts: ContextArtifact[];
    omissions: string[];
    readableRoots: string[];
    rawHash: string;
    semanticHash: string;
}
export interface ContextSnapshot {
    id: string;
    manifest: ContextManifest;
    bundle: string;
}
/**
 * Chooses the owning init: an explicit identifier, else the folder or checkout
 * the request came from. No init is a valid answer; ambiguity is an error.
 */
export declare function resolveOwningInit(options: {
    workspace: Workspace | null;
    cwd: string;
    init?: string;
    noInit?: boolean;
}): Promise<InitBinding | null>;
/** Removes volatile metadata so that only substantive ledger changes alter the semantic hash. */
export declare function semanticContent(label: string, raw: string): string;
/**
 * Reads the init's intent, ledger, required constraints, linked specifications
 * and plans, repository instructions, notes and the explicit targets into one
 * snapshot that every participant receives unchanged.
 */
export declare function buildSnapshot(options: {
    workspace: Workspace | null;
    cwd: string;
    init: InitBinding | null;
    targets: readonly string[];
}): Promise<ContextSnapshot>;
export declare function writeSnapshot(dir: string, snapshot: ContextSnapshot): Promise<string>;
export interface DriftReport {
    kind: 'none' | 'metadata' | 'substantive';
    changed: string[];
}
export declare function compareSnapshots(previous: ContextManifest, current: ContextManifest): DriftReport;
