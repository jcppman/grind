import { type DeliveryRecord, type ReviewStore } from './review-store.ts';
/** Claude Code's transcript file for a session, or null when none is found. */
export declare function findTranscript(sessionId: string, env?: NodeJS.ProcessEnv): Promise<string | null>;
/**
 * The stored user row that delivered the batch: this session's, carrying the
 * batch marker, submitted by the plugin or typed by the person from the
 * prompt box the plugin filled.
 */
export declare function findDeliveredRow(transcript: string, sessionId: string, batchId: string, plugin: string): Promise<string | null>;
export interface ReconcileResult {
    delivery: DeliveryRecord;
    transcript: string | null;
    found: string | null;
}
/**
 * Settles an interrupted or uncertain attempt from the transcript: received
 * when the stored row is there, otherwise unknown. Absence never proves the
 * batch was not delivered, so nothing is resent here.
 */
export declare function reconcileBatch(store: ReviewStore, batchId: string, options?: {
    transcript?: string;
    plugin?: string;
    env?: NodeJS.ProcessEnv;
}): Promise<ReconcileResult>;
