import { type RoadmapDocument } from './roadmaps.ts';
import { type Diagnostic } from './errors.ts';
import { type InitiativeInspection } from './inspect.ts';
import type { LedgerState } from './ledger.ts';
import { type Resolution } from './resolve.ts';
import type { Workspace } from './workspace.ts';
import { type PendingOperationSummary } from './operations.ts';
import { type ArchiveEligibility } from './lifecycle-commands.ts';
import { type RepositoryStatus } from './worktree.ts';
export interface CommandContext {
    workspace: Workspace;
    cwd: string;
}
export interface ListEntry {
    roadmap: Pick<RoadmapDocument, 'id' | 'path'> | null;
    id: string;
    dir: string;
    status: LedgerState['status'] | null;
    updated_at: string | null;
    phase: string | null;
    current_task: string | null;
    next_action: string | null;
    result: string | null;
    diagnostics: Diagnostic[];
}
export interface ListResult {
    initiatives: ListEntry[];
    diagnostics: Diagnostic[];
}
export interface ListOptions {
    scope?: string;
    status?: LedgerState['status'];
}
/** Unarchived initiatives with their recorded resume information; malformed ones stay listed. */
export declare function listCommand(context: CommandContext, options?: ListOptions): Promise<ListResult>;
export interface InitiativeStatus {
    kind: 'initiative';
    resolution: Pick<Resolution, 'source'>;
    inspection: InitiativeInspection;
    pendingOperations: PendingOperationSummary[];
    archiveEligibility: ArchiveEligibility;
}
export type StatusResult = InitiativeStatus | ({
    kind: 'repository';
} & RepositoryStatus);
/**
 * An initiative's recorded and observed state, or, without an identifier inside a repository,
 * the repository's owning initiative and where its other initiatives are checked out.
 */
export declare function statusCommand(context: CommandContext, identifier?: string): Promise<StatusResult>;
export declare function initiativeStatus(context: CommandContext, identifier?: string): Promise<InitiativeStatus>;
