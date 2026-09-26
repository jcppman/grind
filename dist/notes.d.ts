import { type OperationRecord } from './operations.ts';
import type { Workspace } from './workspace.ts';
export interface SplitNotes {
    withoutNotes: string;
    payload: string;
}
/** Separates exact note bytes from a sidecar without interpreting individual notes. */
export declare function splitSidecarNotes(raw: string, sidecarPath?: string): SplitNotes;
export declare function appendSidecarNotes(raw: string, initiative: string | null, payload: string): string;
/** Adds one exact note batch to a ledger. Repeating the same operation is a no-op. */
export declare function parkNotesInLedger(raw: string, repository: string, operationId: string, payload: string): string;
/** Removes and returns one exact parked batch. Repeating removal returns no payload. */
export declare function restoreNotesFromLedger(raw: string, operationId: string): {
    ledger: string;
    payload: string;
};
export interface ParkedNoteBatch {
    operationId: string;
    payload: string;
}
export declare function listParkedNoteBatches(raw: string, repository: string): ParkedNoteBatch[];
/**
 * Durably parks one checkout's notes. The journal is advanced before and after
 * each destination/source write so a repeated call resumes without duplication.
 */
export declare function parkCheckoutNotes(workspace: Workspace, operation: OperationRecord, checkoutIndex: number, sourceLedgerPath: string): Promise<OperationRecord>;
/** Restores all parked batches for one target checkout with journal-backed deduplication. */
export declare function restoreCheckoutNotes(workspace: Workspace, operation: OperationRecord, checkoutIndex: number, targetLedgerPath: string, targetInitiative: string): Promise<OperationRecord>;
