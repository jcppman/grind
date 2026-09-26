export interface CloseInput {
    outcome: 'delivered' | 'abandoned';
    result: string;
    date: string;
    updatedAt: string;
}
export declare function closeLedger(raw: string, input: CloseInput): string;
export declare function reopenLedger(raw: string, updatedAt: string): string;
