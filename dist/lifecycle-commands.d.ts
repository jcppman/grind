import type { CommandContext } from './commands.ts';
import { type InitiativeInspection } from './inspect.ts';
import { type CloseInput } from './transitions.ts';
import type { Workspace } from './workspace.ts';
export interface CloseOptions {
    outcome: CloseInput['outcome'];
    result: string;
    notes: 'handled' | 'parked';
    date?: string;
}
export interface ArchiveEligibility {
    eligible: boolean;
    closedDays: number | null;
    blockers: string[];
}
export declare function assertReopenable(inspection: InitiativeInspection): Promise<void>;
export declare function closeCommand(context: CommandContext, identifier: string | undefined, options: CloseOptions): Promise<{
    id: string;
    status: 'closed';
    commit: string | null;
    notes: string | undefined;
}>;
export declare function reopenPreparedInitiative(workspace: Workspace, inspection: InitiativeInspection): Promise<string | null>;
export declare function inspectArchiveEligibility(workspace: Workspace, inspection: InitiativeInspection): Promise<ArchiveEligibility>;
export declare function archiveCommand(context: CommandContext, identifier?: string): Promise<{
    id: string;
    archivedId: string;
    dir: string;
    commit: string | null;
}>;
