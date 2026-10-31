import type { Engine, EngineSettings } from './config.ts';
import type { TurnKind } from './protocol.ts';
/** Claude participants can read and search but have no tool that writes, runs commands or fetches. */
export declare const CLAUDE_READ_ONLY_TOOLS = "Read,Grep,Glob";
export interface ResolvedExecutable {
    engine: Engine;
    /** How the path was chosen; personal settings are the only way to name a specific file. */
    source: 'personal' | 'path';
    path: string;
    realPath: string;
    version: string;
}
/** cmux puts agent wrappers on PATH inside its terminals; participants must never resolve to one by accident. */
export declare function isCmuxShim(file: string): boolean;
export declare function resolveExecutable(engine: Engine, settings: EngineSettings | undefined, env?: NodeJS.ProcessEnv): Promise<ResolvedExecutable>;
export interface EngineInvocation {
    engine: Engine;
    model: string;
    sessionId: string | null;
    resume: boolean;
    cwd: string;
    readableRoots: readonly string[];
    schema: object;
    schemaFile: string;
    lastMessageFile: string;
}
/** Command-line arguments for one bounded, read-only turn; the prompt is written to stdin. */
export declare function engineArgs(invocation: EngineInvocation): string[];
export interface EngineEvents {
    sessionId: string | null;
    model: string | null;
    /** The structured final answer, or null when the engine produced none. */
    output: unknown;
    error: string | null;
}
/** Interprets the JSON-lines stream an engine wrote to stdout, plus Codex's last-message file. */
export declare function parseEngineOutput(engine: Engine, stdout: string, lastMessage: string | null): EngineEvents;
/** Output schema for a turn; strict enough for Codex, which requires every property to be listed as required. */
export declare function responseSchema(kind: TurnKind): object;
