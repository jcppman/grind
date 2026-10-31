import { type ReviewComment, type ReviewDraft, type ReviewSource, type ReviewStore, type SessionRegistration } from './review-store.ts';
/** One `cmux read-selection --json` answer, as cmux 0.65 shapes it. */
export interface CmuxSelection {
    has_selection: boolean;
    kind: string;
    text: string;
    workspace_id: string | null;
    surface_id: string | null;
    file_path?: string;
    line_range?: {
        start: number;
        end: number;
    };
}
export type MarkdownLocation = Pick<Extract<ReviewSource, {
    kind: 'markdown';
}>, 'lines' | 'location' | 'contentHash'>;
/**
 * Where a selected passage lies in the file on disk. A reported line range is
 * kept only when those lines hold the quote; otherwise the quote must occur
 * exactly once. Rendered text that differs from the source stays unmatched
 * rather than getting invented line numbers.
 */
export declare function locateQuote(content: string, quote: string, reported?: {
    start: number;
    end: number;
}): MarkdownLocation;
/** The review source for a cmux selection; Markdown locations are checked against the file on disk. */
export declare function sourceFromSelection(selection: CmuxSelection, targetSession: SessionRegistration | null): Promise<ReviewSource>;
export type CmuxRunner = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<string>;
/** The live session in this cmux workspace that receives captured selections. */
export declare function chooseDestination(sessions: readonly SessionRegistration[], workspaceId: string, sessionId?: string): SessionRegistration;
export interface CaptureOptions {
    sessionId?: string;
    body?: string;
    /** The surface to read; by default the selection is looked for across the caller's workspace. */
    surface?: string;
    env?: NodeJS.ProcessEnv;
    runner?: CmuxRunner;
}
export interface CaptureResult {
    sessionId: string;
    draft: ReviewDraft;
    comment: ReviewComment;
}
/**
 * Adds the selection of a cmux surface to a session's draft. Runs no prompt and
 * sends nothing to the agent; the session's mod sees the draft change.
 */
export declare function captureFromCmux(store: ReviewStore, options?: CaptureOptions): Promise<CaptureResult>;
interface TreeSurface {
    id?: string;
    type?: string;
    selected_in_pane?: boolean | null;
}
interface CmuxTree {
    windows?: Array<{
        workspaces?: Array<{
            id?: string;
            panes?: Array<{
                surfaces?: TreeSurface[];
            }>;
        }>;
    }>;
}
/** Surfaces of a cmux workspace that can hold a reviewable selection, visible tabs first. */
export declare function selectableSurfaces(tree: CmuxTree, workspaceId: string): TreeSurface[];
export {};
