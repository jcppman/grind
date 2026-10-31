export interface CloseInput {
    outcome: 'delivered' | 'abandoned';
    result: string;
    date: string;
    updatedAt: string;
}
export declare function assertVerification(grind: Record<string, unknown>, outcome: CloseInput['outcome']): void;
export declare function closeLedger(raw: string, input: CloseInput): string;
