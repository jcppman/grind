import type { Workspace } from './workspace.ts';
export interface OperationCheckout {
    repository: string;
    checkout: string;
    sourceBranch: string;
    targetBranch: string;
    sourceInitiative?: string | null;
    notePayload?: string;
    noteState?: 'captured' | 'parked' | 'removed';
    restoreBatches?: Array<{
        operationId: string;
        payload: string;
    }>;
    restoreState?: 'captured' | 'copied' | 'removed' | 'complete';
    targetSource?: 'local' | 'remote' | 'remote-default';
    switchState?: 'planned' | 'notes-parked' | 'checkout-planned' | 'checked-out' | 'notes-restored';
}
export interface OperationRecord {
    version: 1;
    id: string;
    kind: 'start' | 'close' | 'reopen' | 'archive';
    target: string;
    createdAt: string;
    updatedAt: string;
    step: string;
    checkouts: OperationCheckout[];
    details?: Record<string, string>;
}
export interface PendingOperationSummary {
    id: string;
    kind: OperationRecord['kind'];
    target: string;
    step: string;
    path: string;
}
export declare function readPendingOperations(workspace: Workspace): Promise<Array<OperationRecord & {
    path: string;
}>>;
export declare function pendingOperationSummaries(workspace: Workspace): Promise<PendingOperationSummary[]>;
export declare function assertNoPendingOperation(workspace: Workspace, initiative?: string): Promise<void>;
export declare function newStartOperation(target: string, checkouts: OperationCheckout[]): OperationRecord;
export declare function newLifecycleOperation(kind: Exclude<OperationRecord['kind'], 'start'>, target: string, details: Record<string, string>, checkouts?: OperationCheckout[]): OperationRecord;
export declare function updateOperation(operation: OperationRecord, step: string): OperationRecord;
export declare function writeOperation(workspace: Workspace, operation: OperationRecord): Promise<string>;
export declare function updateOperationCheckout(operation: OperationRecord, checkoutIndex: number, update: Partial<OperationCheckout>, step: string): OperationRecord;
export declare function deleteOperation(workspace: Workspace, operationId: string): Promise<void>;
export declare function atomicWriteFile(file: string, content: string): Promise<void>;
export interface LockOwner {
    operationId: string;
    pid: number;
    host: string;
    createdAt: string;
}
export declare function withLifecycleLocks<T>(workspace: Workspace, repositoryRoots: readonly string[], operationId: string, action: () => Promise<T>): Promise<T>;
export declare function withRepositoryLock<T>(repositoryRoot: string, operationId: string, action: () => Promise<T>): Promise<T>;
