import type { ReviewSource, ReviewSubmission } from './review-store.ts';
/** Batches up to this many characters are sent whole; larger ones are sent as a reference the agent reads. */
export declare const INLINE_PAYLOAD_LIMIT = 24000;
export declare function batchMarker(batchId: string): string;
export declare function describeSource(source: ReviewSource): string;
/** The complete frozen batch as the agent reads it. */
export declare function formatBatch(submission: ReviewSubmission): string;
export interface PromptPayload {
    text: string;
    inline: boolean;
    /** Length of the complete batch text. */
    length: number;
}
/**
 * The prompt that delivers a batch: the batch itself when it fits, else the
 * marker and the command that prints it.
 */
export declare function promptPayload(submission: ReviewSubmission, readCommand: string): PromptPayload;
