#!/usr/bin/env node
export interface AgentNoteInput {
    file: string;
    start: number;
    end: number;
    comment: string;
}
export declare function addAgentNote(input: AgentNoteInput): Promise<{
    sidecar: string;
    reference: string;
}>;
export declare function runAgentNote(argv: readonly string[]): Promise<number>;
