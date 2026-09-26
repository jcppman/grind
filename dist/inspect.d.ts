import { type InitiativeRecord } from './artifacts.ts';
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
    /** Absolute path where the recorded checkout should be. */
    path: string;
    exists: boolean;
    /** True when the path is a Git checkout. */
    repository: boolean;
    branch: string | null;
    detached: boolean;
    changedFiles: string[];
    sidecar: {
        initiative: string | null;
        verified: boolean;
        pendingNotes: number;
    } | null;
}
export interface RepositoryInspection {
    recorded: RepositoryEntry;
    observed: ObservedCheckout;
    /** True when the checkout exists and is on the recorded branch. */
    onRecordedBranch: boolean;
}
export interface InitiativeInspection {
    id: string;
    dir: string;
    archived: boolean;
    state: LedgerState | null;
    legacy: boolean;
    artifacts: ArtifactSummary[];
    repositories: RepositoryInspection[];
    diagnostics: Diagnostic[];
}
/** Recorded and observed state of one initiative, gathered without changing anything. */
export declare function inspectInitiative(workspace: Workspace, entry: InitiativeEntry, suppliedRecord?: InitiativeRecord): Promise<InitiativeInspection>;
/** Whether the inspection shows a state that a non-switching start may enter. */
export declare function startBlockers(inspection: InitiativeInspection): string[];
