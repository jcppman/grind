import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { GrindError } from './errors.js';
import { associationFor, currentInit } from './review-current.js';
import { addComment, liveSessions, readDraft } from './review-store.js';
const execFileAsync = promisify(execFile);
function lineOf(text, offset) {
    let line = 1;
    for (let i = 0; i < offset; i += 1)
        if (text.charCodeAt(i) === 10)
            line += 1;
    return line;
}
function occurrences(haystack, needle) {
    const found = [];
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1))
        found.push(at);
    return found;
}
/**
 * Where a selected passage lies in the file on disk. A reported line range is
 * kept only when those lines hold the quote; otherwise the quote must occur
 * exactly once. Rendered text that differs from the source stays unmatched
 * rather than getting invented line numbers.
 */
export function locateQuote(content, quote, reported) {
    const contentHash = createHash('sha256').update(content).digest('hex');
    const normalized = content.replace(/\r\n/g, '\n');
    const needle = quote.replace(/\r\n/g, '\n').trim();
    if (needle === '')
        return { lines: null, location: 'unknown', contentHash };
    if (reported !== undefined) {
        const lines = normalized.split('\n').slice(reported.start - 1, reported.end).join('\n');
        if (lines.includes(needle))
            return { lines: { ...reported }, location: 'exact', contentHash };
    }
    const found = occurrences(normalized, needle);
    if (found.length === 1) {
        const start = lineOf(normalized, found[0]);
        return { lines: { start, end: start + (needle.match(/\n/g)?.length ?? 0) }, location: 'exact', contentHash };
    }
    return { lines: null, location: found.length > 1 ? 'ambiguous' : 'unmatched', contentHash };
}
/** The review source for a cmux selection; Markdown locations are checked against the file on disk. */
export async function sourceFromSelection(selection, targetSession) {
    if (selection.kind === 'terminal') {
        const isTargetTerminal = targetSession !== null && targetSession.cmux.surfaceId !== null && targetSession.cmux.surfaceId === selection.surface_id;
        return { kind: 'terminal', surfaceId: selection.surface_id, workspaceId: selection.workspace_id, sessionId: isTargetTerminal ? targetSession.sessionId : null };
    }
    const path = selection.file_path ?? null;
    const content = path === null ? null : await readFile(path, 'utf8').catch(() => null);
    const location = content === null ? { lines: null, location: 'unknown', contentHash: null } : locateQuote(content, selection.text, selection.line_range);
    return { kind: 'markdown', path, surfaceId: selection.surface_id, workspaceId: selection.workspace_id, ...location };
}
const defaultRunner = async (args, env) => (await execFileAsync('cmux', [...args], { env, encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
async function cmuxJson(runner, args, env) {
    let stdout;
    try {
        stdout = await runner([...args, '--json'], env);
    }
    catch (error) {
        const failure = error;
        throw new GrindError('REVIEW_CAPTURE_FAILED', `cmux ${args[0]} failed: ${(failure.stderr ?? failure.message).trim()}`);
    }
    try {
        return JSON.parse(stdout);
    }
    catch {
        throw new GrindError('REVIEW_CAPTURE_FAILED', `cmux ${args[0]} did not answer JSON`);
    }
}
/** The live session in this cmux workspace that receives captured selections. */
export function chooseDestination(sessions, workspaceId, sessionId) {
    if (sessionId !== undefined) {
        const chosen = sessions.find((session) => session.sessionId === sessionId);
        if (chosen === undefined)
            throw new GrindError('REVIEW_DESTINATION', `Session ${sessionId} is not a live Grind review session`, { sessionId });
        return chosen;
    }
    const local = sessions.filter((session) => session.cmux.workspaceId === workspaceId);
    if (local.length === 1)
        return local[0];
    if (local.length === 0)
        throw new GrindError('REVIEW_DESTINATION', 'No Claude Code session with the Grind mod runs in this cmux workspace', { workspaceId });
    throw new GrindError('REVIEW_DESTINATION', 'Several Claude Code sessions in this cmux workspace can receive the selection; pass --session', {
        workspaceId,
        candidates: local.map((session) => ({ sessionId: session.sessionId, cwd: session.cwd, surfaceId: session.cmux.surfaceId })),
    });
}
/**
 * Adds the selection of a cmux surface to a session's draft. Runs no prompt and
 * sends nothing to the agent; the session's mod sees the draft change.
 */
export async function captureFromCmux(store, options = {}) {
    const env = options.env ?? process.env;
    const runner = options.runner ?? defaultRunner;
    const workspaceId = env['CMUX_WORKSPACE_ID'];
    if (!workspaceId)
        throw new GrindError('REVIEW_CAPTURE_FAILED', 'capture-cmux runs inside a cmux workspace (CMUX_WORKSPACE_ID is unset)');
    const destination = chooseDestination(await liveSessions(store), workspaceId, options.sessionId);
    const selection = options.surface !== undefined
        ? await readSelection(runner, env, options.surface)
        : await findSelection(runner, env, workspaceId, destination);
    const source = await sourceFromSelection(selection, destination);
    const existing = await readDraft(store, destination.sessionId);
    const association = existing?.association ?? associationFor(await currentInit(destination.cwd, destination.binding ? { binding: destination.binding } : {}));
    const added = await addComment(store, destination.sessionId, { source, quote: selection.text, ...(options.body === undefined ? {} : { body: options.body }), association });
    return { sessionId: destination.sessionId, ...added };
}
async function readSelection(runner, env, surface) {
    const selection = await cmuxJson(runner, ['read-selection', '--surface', surface], env);
    if (!selection.has_selection || selection.text.trim() === '')
        throw new GrindError('REVIEW_CAPTURE_FAILED', 'Nothing is selected in that surface', { surface });
    return selection;
}
/** Surfaces of a cmux workspace that can hold a reviewable selection, visible tabs first. */
export function selectableSurfaces(tree, workspaceId) {
    const surfaces = (tree.windows ?? [])
        .flatMap((window) => window.workspaces ?? [])
        .filter((workspace) => workspace.id === workspaceId)
        .flatMap((workspace) => workspace.panes ?? [])
        .flatMap((pane) => pane.surfaces ?? [])
        .filter((surface) => typeof surface.id === 'string' && (surface.type === 'markdown' || surface.type === 'filepreview'));
    return surfaces.sort((a, b) => Number(Boolean(b.selected_in_pane)) - Number(Boolean(a.selected_in_pane)));
}
/**
 * The one selection to capture: a Markdown or file preview selection in the
 * workspace, else the destination session's own terminal selection. Several
 * candidates are refused rather than guessed between.
 */
async function findSelection(runner, env, workspaceId, destination) {
    const tree = await cmuxJson(runner, ['--id-format', 'both', 'tree', '--workspace', workspaceId], env);
    const found = [];
    for (const surface of selectableSurfaces(tree, workspaceId)) {
        const selection = await cmuxJson(runner, ['read-selection', '--surface', surface.id], env).catch(() => null);
        if (selection?.has_selection && selection.text.trim() !== '')
            found.push(selection);
    }
    if (found.length === 1)
        return found[0];
    if (found.length > 1) {
        throw new GrindError('REVIEW_CAPTURE_FAILED', 'Several documents in this workspace hold a selection; clear the others or pass --surface', {
            surfaces: found.map((selection) => ({ surfaceId: selection.surface_id, path: selection.file_path ?? null })),
        });
    }
    if (destination.cmux.surfaceId !== null)
        return readSelection(runner, env, destination.cmux.surfaceId);
    throw new GrindError('REVIEW_CAPTURE_FAILED', 'Nothing is selected in this workspace');
}
//# sourceMappingURL=review-capture.js.map