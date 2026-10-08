import type { Workspace } from './workspace.ts';
export interface OperationRecord {
    version: 1;
    id: string;
    kind: 'close' | 'archive';
    target: string;
    createdAt: string;
    updatedAt: string;
    step: string;
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
export declare function newLifecycleOperation(kind: OperationRecord['kind'], target: string, details: Record<string, string>): OperationRecord;
export declare function updateOperation(operation: OperationRecord, step: string): OperationRecord;
export declare function writeOperation(workspace: Workspace, operation: OperationRecord): Promise<string>;
export declare function deleteOperation(workspace: Workspace, operationId: string): Promise<void>;
export declare function atomicWriteFile(file: string, content: string): Promise<void>;
export interface LockOwner {
    operationId: string;
    pid: number;
    host: string;
    createdAt: string;
}
export declare function withLifecycleLocks<T>(workspace: Workspace, repositoryRoots: readonly string[], operationId: string, action: () => Promise<T>): Promise<T>;
