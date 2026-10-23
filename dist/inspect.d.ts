import { type InitiativeRecord } from './artifacts.ts';
import { type CheckoutKind } from './checkouts.ts';
import type { InitiativeEntry } from './discovery.ts';
import { type Diagnostic } from './errors.ts';
import type { LedgerState, RepositoryEntry } from './ledger.ts';
import type { Workspace } from './workspace.ts';
export interface ArtifactSummary {
    path: string;
    role: string;
    type: string | null;
}
export interface ObservedCheckout {
    /** Absolute path of the recorded repository's canonical checkout. */
    canonical: string;
    /** True when the canonical path is a Git checkout. */
    repository: boolean;
    /** Where the recorded branch is checked out, or null when it is not checked out. */
    path: string | null;
    kind: CheckoutKind | null;
    /** Where `grind worktree` places this initiative's worktree. */
    standardPath: string;
    changedFiles: string[];
}
export interface RepositoryInspection {
    recorded: RepositoryEntry;
    observed: ObservedCheckout;
}
export interface InitiativeInspection {
    id: string;
    dir: string;
    archived: boolean;
    state: LedgerState | null;
    legacy: boolean;
    artifacts: ArtifactSummary[];
    roadmap: {
        id: string;
        path: string;
    } | null;
    repositories: RepositoryInspection[];
    diagnostics: Diagnostic[];
}
/** Recorded and observed state of one initiative, gathered without changing anything. */
export declare function inspectInitiative(workspace: Workspace, entry: InitiativeEntry, suppliedRecord?: InitiativeRecord): Promise<InitiativeInspection>;
