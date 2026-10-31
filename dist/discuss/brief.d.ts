import type { InitBinding } from './context.ts';
import { type ProtocolState, type Turn } from './protocol.ts';
export interface BriefInput {
    state: ProtocolState;
    turn: Turn;
    brief: string;
    init: InitBinding | null;
    participant: {
        id: string;
        role: string;
        instructions: string;
        engine: string;
    };
    writer: string;
    bundle: string;
    bundlePath: string;
    readableRoots: readonly string[];
}
/** The full prompt for one turn: protocol bootstrap and shared snapshot are re-supplied every time. */
export declare function composeBrief(input: BriefInput): string;
