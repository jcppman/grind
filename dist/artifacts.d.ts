import { type Diagnostic } from './errors.ts';
import { type Frontmatter } from './frontmatter.ts';
import { type LedgerValidation } from './ledger.ts';
import type { Workspace } from './workspace.ts';
export declare const INTENT_TYPE = "Intent";
export declare const REQUIRED_ARTIFACTS: readonly ['index.md', 'intent.md', 'ledger.md'];
export type ArtifactRole = 'index' | 'intent' | 'ledger' | 'document';
export interface ArtifactDocument {
    path: string;
    /** Path relative to the initiative folder, using forward slashes. */
    relativePath: string;
    role: ArtifactRole;
    /** Frontmatter `type`, or null when absent or empty. */
    type: string | null;
    frontmatter: Frontmatter;
}
export interface InitiativeRecord {
    dir: string;
    documents: ArtifactDocument[];
    index: ArtifactDocument | null;
    intent: ArtifactDocument | null;
    ledger: ArtifactDocument | null;
    ledgerState: LedgerValidation | null;
    diagnostics: Diagnostic[];
}
export interface ReadInitiativeOptions {
    /** Enables checks that need workspace geometry, such as worktrees inside the state directory. */
    workspace?: Workspace;
}
/** Reads every Markdown artifact of an initiative without modifying anything. */
export declare function readInitiative(dir: string, options?: ReadInitiativeOptions): Promise<InitiativeRecord>;
