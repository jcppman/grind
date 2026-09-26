import { type Diagnostic } from './errors.ts';
export declare const SIDECAR_FILENAME = ".grind.md";
export interface SidecarNote {
    /** The `@path#start-end` reference as written. */
    reference: string;
    path: string;
    start: number;
    end: number;
    /** First line of the range when the note was written, or null. */
    anchor: string | null;
    body: string;
}
export interface Sidecar {
    path: string;
    raw: string;
    body: string;
    /** Initiative path relative to `initiatives/`, or null when the pointer is absent. */
    initiative: string | null;
    notes: SidecarNote[];
    diagnostics: Diagnostic[];
}
/** Reads the checkout's sidecar, or returns null when there is none. */
export declare function readSidecar(checkoutRoot: string): Promise<Sidecar | null>;
export declare function parseSidecar(raw: string, sidecarPath: string): Sidecar;
/** Rewrites only the pointer mapping while preserving the Markdown body. */
export declare function renderSidecar(raw: string, initiative: string | null, body?: string, restoredBatches?: readonly string[] | null): string;
export declare function restoredSidecarBatches(raw: string): string[];
