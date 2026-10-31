import type { CmuxAdapter } from './cmux.ts';
import { type ProcessProbe } from './store.ts';
/** Engine children see this marker; mutating Grind commands refuse to run under it. */
export declare const PARTICIPANT_ENV = "GRIND_DISCUSSION_PARTICIPANT";
export interface WorkerOptions {
    dir: string;
    participant: string;
    generation: number;
    token: string;
    probe?: ProcessProbe;
    cmux?: CmuxAdapter | null;
    log?: (line: string) => void;
}
/**
 * Serves this participant's turns for one runner generation. Each turn's
 * intent is persisted before the engine starts, so a crash between launch and
 * completion is visible to the runner as an uncertain execution.
 */
export declare function runWorker(options: WorkerOptions): Promise<number>;
export declare function workerArgs(dir: string, participant: string, generation: number, token: string): string[];
export declare function shellQuote(value: string): string;
export declare function launchScript(options: {
    node: string;
    cli: string;
    dir: string;
    participant: string;
    generation: number;
    token: string;
    env: Record<string, string | null>;
}): string;
export declare function scriptPath(dir: string, participant: string, generation: number): string;
