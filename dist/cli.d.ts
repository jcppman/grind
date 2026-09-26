#!/usr/bin/env node
export interface ParsedArgs {
    command: string | null;
    positional: string[];
    json: boolean;
    help: boolean;
    open: boolean;
    closed: boolean;
    workspace?: string;
    scope?: string;
    message?: string;
    outcome?: string;
    result?: string;
    notes?: string;
    date?: string;
}
export declare function parseArgs(argv: readonly string[]): ParsedArgs;
export declare function run(argv: readonly string[]): Promise<number>;
