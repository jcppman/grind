import { type ContextResult } from './context.ts';
export declare const HOOK_CONTEXT_BYTES = 6000;
export declare function presentHookContext(result: ContextResult, pluginRoot: string, budget?: number): string;
export declare function sessionContext(input: unknown, pluginRoot: string): Promise<string | null>;
