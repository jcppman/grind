import { type BranchSource, type CheckoutKind, type InstructionLink } from './checkouts.ts';
import type { CommandContext } from './commands.ts';
export interface WorktreeOptions {
    repository?: string;
}
export interface WorktreeResult {
    initiative: string;
    repository: string;
    branch: string;
    path: string;
    kind: CheckoutKind;
    created: boolean;
    /** How a newly created worktree obtained its branch. */
    branchOrigin: BranchSource['origin'] | null;
    recorded: boolean;
    instructionLinks: InstructionLink[];
    warnings: string[];
}
/** Path where the initiative's work lives, creating a worktree at the standard location if needed. */
export declare function worktreeCommand(context: CommandContext, identifier: string, options?: WorktreeOptions): Promise<WorktreeResult>;
export interface RepositoryInitiative {
    id: string;
    branch: string;
    current_task: string | null;
    next_action: string | null;
    path: string | null;
    kind: CheckoutKind | null;
}
export interface RepositoryStatus {
    repository: string;
    canonical: string;
    checkout: {
        path: string;
        branch: string | null;
        kind: CheckoutKind;
    };
    /** The open initiative owning the checkout's branch, when exactly one does. */
    owner: RepositoryInitiative | null;
    owners: string[];
    /** Other open initiatives tracking a branch in this repository. */
    initiatives: RepositoryInitiative[];
}
/** The repository at `cwd`: who owns its current branch and where its other inits live. */
export declare function repositoryStatus(context: CommandContext): Promise<RepositoryStatus>;
export interface SwitchOptions {
    force?: boolean;
    /** Changes newer than this make a worktree count as in use. */
    recentActivityMs?: number;
}
export interface SavedStash {
    label: string;
    commit: string;
    branch: string;
    /** Checkout the changes were stashed from. */
    origin: string;
    /** Directory where the stash belongs once its branch is checked out there. */
    restoreIn: string;
}
export interface SwitchResult {
    initiative: string;
    repository: string;
    canonical: string;
    branch: string;
    switched: boolean;
    previous: {
        branch: string | null;
        initiative: string | null;
        path: string | null;
    } | null;
    /** Where the target branch was taken from; that worktree is left in place with a detached HEAD. */
    takenFrom: {
        path: string;
        kind: CheckoutKind;
        released: 'detached';
    } | null;
    branchOrigin: BranchSource['origin'] | null;
    recorded: boolean;
    warnings: string[];
}
/**
 * Brings the target initiative's branch into the canonical checkout of the current repository
 * and moves the work it held to that initiative's standard worktree.
 */
export declare function switchCommand(context: CommandContext, identifier: string, options?: SwitchOptions): Promise<SwitchResult>;
