import type { ListResult, StartResult, StatusResult } from './commands.ts';
export interface FormatOptions {
    width?: number;
    color?: boolean;
}
export declare function formatList(result: ListResult, options?: FormatOptions): string;
export declare function formatStatus(result: StatusResult, options?: FormatOptions): string;
export declare function formatStart(result: StartResult, options?: FormatOptions): string;
