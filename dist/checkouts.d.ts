import { type Workspace } from './workspace.ts';
export declare const WORKTREES_FOLDER = ".worktrees";
export interface WorktreeEntry {
    path: string;
    branch: string | null;
    head: string | null;
    bare: boolean;
    prunable: boolean;
}
export type CheckoutKind = 'canonical' | 'grind' | 'app' | 'other';
export interface BranchLocation {
    /** Where the branch is checked out, or null when it is not checked out anywhere. */
    path: string | null;
    kind: CheckoutKind | null;
}
export interface RepositoryCheckout {
    /** Real path of the checkout containing the inspected directory. */
    root: string;
    /** Real path of the repository's main worktree. */
    canonical: string;
    /** Workspace-relative path of the canonical checkout. */
    repositoryPath: string;
    branch: string | null;
}
/**
 * Worktrees of the repository at `dir`; the first entry is the main worktree. Registrations
 * whose directory is gone are left out.
 */
export declare function listWorktrees(dir: string): Promise<WorktreeEntry[]>;
/** The repository containing `dir`, identified by its canonical checkout inside the workspace. */
export declare function repositoryCheckout(workspace: Workspace, dir: string): Promise<RepositoryCheckout | null>;
/** Removes registrations of worktrees whose directory is gone, so their branches can be checked out again. */
export declare function pruneWorktrees(dir: string): Promise<void>;
export declare function worktreesRoot(workspace: Workspace): string;
/** Last segment of an initiative ID, used to name its worktrees and default branches. */
export declare function initiativeName(id: string): string;
export declare function standardWorktreePath(workspace: Workspace, repositoryPath: string, initiativeId: string): string;
export declare function checkoutKind(workspace: Workspace, canonical: string, checkout: string): CheckoutKind;
/** Where `branch` of the repository at `canonical` is checked out. */
export declare function locateBranch(workspace: Workspace, canonical: string, branch: string): Promise<BranchLocation>;
/** Name of the merge, rebase, or similar operation in progress in `checkout`, or null. */
export declare function inProgressOperation(checkout: string): Promise<string | null>;
/** The remote whose default branch new branches start from. */
export declare function defaultRemote(dir: string): Promise<string | null>;
export interface BranchSource {
    /** `local-default` applies only to repositories without remotes. */
    origin: 'local' | 'remote' | 'remote-default' | 'local-default';
    /** Start point of a branch that does not exist locally yet. */
    base: string | null;
    track: boolean;
}
/**
 * How to obtain `branch`: the local branch, a remote branch of the same name, or a new
 * branch from the remote's default branch, or from local main or master when there is no
 * remote. Callers fetch first when they want fresh refs.
 */
export declare function branchSource(dir: string, branch: string): Promise<BranchSource>;
export declare function worktreeAddArgs(target: string, branch: string, source: BranchSource): string[];
export declare function checkoutArgs(branch: string, source: BranchSource): string[];
/** Fetches the default remote; returns a warning instead of failing when offline. */
export declare function fetchDefaultRemote(dir: string): Promise<string | null>;
export interface InstructionLink {
    link: string;
    target: string;
    status: 'exists' | 'created' | 'replaced' | 'blocked';
}
/**
 * Mirrors instruction files of the folders between the workspace root and the canonical
 * checkout under the worktree root, so worktrees receive the same directory-scoped instructions.
 */
export declare function ensureInstructionLinks(workspace: Workspace, canonical: string): Promise<InstructionLink[]>;
