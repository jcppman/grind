import { inspectInitiative } from './inspect.ts';
import type { Workspace } from './workspace.ts';
export interface RemovalCheck {
    removable: boolean;
    reasons: string[];
}
export interface RemovalOptions {
    /** Working directories of live processes, as returned by `processWorkingDirectories`; read once per batch. */
    cwds?: string[] | null;
    /** Waives the unpushed-commit check; the local branch keeps the commits when the worktree is removed. */
    allowUnpushed?: boolean;
}
/** Working directories of all live processes, or null when they cannot be determined. */
export declare function processWorkingDirectories(): Promise<string[] | null>;
/**
 * Whether the linked worktree at `dir` may be deleted without losing work: it lies under the
 * workspace's worktree root, is clean (ignored files do not count), has no commits missing
 * from every remote and no operation in progress, and no process works inside it.
 */
export declare function worktreeRemovalCheck(workspace: Workspace, dir: string, options?: RemovalOptions): Promise<RemovalCheck>;
export interface RemovedWorktree {
    path: string;
    branch: string | null;
}
export interface SkippedWorktree extends RemovedWorktree {
    reasons: string[];
}
/** Removes `dir` with `git worktree remove` (never forced) when `worktreeRemovalCheck` passes. */
export declare function removeWorktreeIfSafe(workspace: Workspace, dir: string, options?: RemovalOptions): Promise<{
    removed: boolean;
    reasons: string[];
}>;
export interface InitiativeWorktreeRemoval {
    removed: RemovedWorktree[];
    skipped: SkippedWorktree[];
}
/** Removes the safe linked worktrees of the branches that the initiative `id` records. */
export declare function removeInitiativeWorktrees(workspace: Workspace, id: string, initiative: Parameters<typeof inspectInitiative>[1]): Promise<InitiativeWorktreeRemoval>;
export interface PruneCandidate extends RemovedWorktree {
    sizeKb: number;
    reason: string;
}
export interface PruneResult {
    dryRun: boolean;
    idleDays: number;
    candidates: PruneCandidate[];
    removed: PruneCandidate[];
    failed: SkippedWorktree[];
    skipped: SkippedWorktree[];
    totalKb: number;
    reclaimedKb: number;
}
export interface PruneOptions {
    dryRun: boolean;
    idleDays?: number;
    now?: number;
}
/**
 * Finds, and unless `dryRun` removes, worktrees under the worktree root that no longer
 * hold work: removal-safe, not on a branch of an open init, and either merged (or its
 * upstream deleted) or idle for `idleDays`.
 */
export declare function pruneWorktreesCommand(workspace: Workspace, options: PruneOptions): Promise<PruneResult>;
