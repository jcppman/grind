import { type InitiativeInspection } from './inspect.ts';
import type { Workspace } from './workspace.ts';
export interface PlannedCheckout {
    repository: string;
    checkout: string;
    sourceBranch: string | null;
    targetBranch: string;
    action: 'stay' | 'switch' | 'verify-worktree';
    targetSource: 'current' | 'local' | 'remote' | 'remote-default' | 'unknown';
}
export interface StartPlan {
    target: string;
    checkouts: PlannedCheckout[];
    blockers: string[];
}
/** Builds a complete, read-only checkout plan. Execution revalidates it after locks are acquired. */
export declare function planStart(workspace: Workspace, inspection: InitiativeInspection): Promise<StartPlan>;
/** Acquires state and repository locks, then rebuilds the plan before any lifecycle mutation. */
export declare function withLockedStartPlan<T>(workspace: Workspace, inspection: InitiativeInspection, operationId: string, action: (plan: StartPlan) => Promise<T>): Promise<T>;
