import { type Diagnostic } from './errors.ts';
import { type Frontmatter } from './frontmatter.ts';
export declare const LEDGER_TYPE = "Initiative Ledger";
export interface RepositoryEntry {
    /** Workspace-relative path of the repository. */
    path: string;
    branch: string;
    pull_request: string | null;
}
export interface ClosureRecord {
    date: string;
    outcome: 'delivered' | 'abandoned';
}
export interface LedgerState {
    status: 'open' | 'closed';
    updated_at: string;
    phase: string | null;
    current_task: string | null;
    next_action: string | null;
    result: string | null;
    closed: ClosureRecord | null;
    repositories: RepositoryEntry[];
}
export interface LedgerValidation {
    /** Structured state, or null when required Grind fields are malformed. */
    state: LedgerState | null;
    /** True when the record predates frontmatter and needs explicit migration. */
    legacy: boolean;
    diagnostics: Diagnostic[];
}
export declare function isTimestampWithOffset(value: string): boolean;
/** Validates ledger frontmatter against the shared artifact contract. */
export declare function validateLedger(frontmatter: Frontmatter, path: string): LedgerValidation;
