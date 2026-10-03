import type { ListResult, StatusResult } from './commands.ts';
import type { ListedNote } from './notes.ts';
import type { RepositoryStatus, SwitchResult, WorktreeResult } from './worktree.ts';
export interface FormatOptions {
    width?: number;
    color?: boolean;
}
export declare function formatList(result: ListResult, options?: FormatOptions): string;
export declare function formatStatus(result: StatusResult, options?: FormatOptions): string;
/** What `worktree` did, apart from the path it prints. */
export declare function formatWorktree(result: WorktreeResult): string;
export declare function formatSwitch(result: SwitchResult): string;
export declare function formatRepositoryInitiatives(result: RepositoryStatus, options?: FormatOptions): string;
export declare function formatNotes(result: {
    initiative: string;
    notes: ListedNote[];
}): string;
