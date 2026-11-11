import { type Diagnostic } from './errors.ts';
export declare const ARCHIVE_FOLDER = "_archive";
export declare const INTENT_FILENAME = "intent.md";
/** Whether an initiative id sits beneath the read-only archive prefix. */
export declare function isArchivedId(id: string): boolean;
export interface InitiativeEntry {
    /** Path relative to `initiatives/`, using forward slashes. */
    id: string;
    dir: string;
    archived: boolean;
}
export interface InitiativeListing {
    entries: InitiativeEntry[];
    diagnostics: Diagnostic[];
}
/**
 * Lists folders whose intent declares `grind.root: true`, excluding nested documents.
 * Symbolic links are reported, not followed.
 */
export declare function listInitiatives(initiativesDir: string): Promise<InitiativeListing>;
/** Whether this folder explicitly declares an initiative boundary. */
export declare function isInitiativeRoot(dir: string): Promise<boolean>;
