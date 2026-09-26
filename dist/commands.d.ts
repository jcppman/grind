import { type Diagnostic } from './errors.ts';
import { type InitiativeInspection } from './inspect.ts';
import { type StartPlan } from './lifecycle.ts';
import type { LedgerState } from './ledger.ts';
import { type Resolution } from './resolve.ts';
import type { Workspace } from './workspace.ts';
import { type PendingOperationSummary } from './operations.ts';
import { type ArchiveEligibility } from './lifecycle-commands.ts';
export interface CommandContext {
    workspace: Workspace;
    cwd: string;
}
export interface ListEntry {
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
export interface StatusResult {
    resolution: Pick<Resolution, 'source' | 'stalePointer'> & {
        checkout: string | null;
    };
    inspection: InitiativeInspection;
    pendingOperations: PendingOperationSummary[];
    archiveEligibility: ArchiveEligibility;
}
export declare function statusCommand(context: CommandContext, identifier?: string): Promise<StatusResult>;
export interface StartResult extends StatusResult {
    switched: boolean;
    switchedRepositories: string[];
    noteTransfers: Array<{
        repository: string;
        parked: number;
        restored: number;
    }>;
    dependencyChanges: string[];
    pendingNotes: number;
    plan: StartPlan;
}
/** Enters an open initiative whose checkouts already sit on their recorded branches. */
export declare function startCommand(context: CommandContext, identifier?: string): Promise<StartResult>;
