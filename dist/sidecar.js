import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { diagnostic } from './errors.js';
import { getString, parseFrontmatter } from './frontmatter.js';
export const SIDECAR_FILENAME = '.grind.md';
const NOTE_HEADING = /^## (@(.+?)#(\d+)(?:-(\d+))?)\s*$/;
/** Reads the checkout's sidecar, or returns null when there is none. */
export async function readSidecar(checkoutRoot) {
    const sidecarPath = path.join(checkoutRoot, SIDECAR_FILENAME);
    let raw;
    try {
        raw = await readFile(sidecarPath, 'utf8');
    }
    catch {
        return null;
    }
    return parseSidecar(raw, sidecarPath);
}
export function parseSidecar(raw, sidecarPath) {
    const diagnostics = [];
    const frontmatter = parseFrontmatter(raw);
    let initiative = null;
    if (frontmatter.error !== undefined) {
        diagnostics.push(diagnostic('error', 'SIDECAR_INVALID', frontmatter.error, sidecarPath));
    }
    else if (frontmatter.data !== null) {
        initiative = getString(frontmatter.data, 'initiative');
        if ('initiative' in frontmatter.data && initiative === null) {
            diagnostics.push(diagnostic('error', 'SIDECAR_INVALID', '`initiative` must be a nonempty string', sidecarPath));
        }
    }
    return { path: sidecarPath, raw, body: frontmatter.body, initiative, notes: parseNotes(frontmatter.body), diagnostics };
}
/** Rewrites only the pointer mapping while preserving the Markdown body. */
export function renderSidecar(raw, initiative, body, restoredBatches) {
    const frontmatter = parseFrontmatter(raw);
    if (frontmatter.error !== undefined || frontmatter.data === null && frontmatter.hasFrontmatter) {
        throw new Error(frontmatter.error ?? 'Invalid sidecar frontmatter');
    }
    const data = { ...(frontmatter.data ?? {}) };
    if (initiative === null)
        delete data['initiative'];
    else
        data['initiative'] = initiative;
    if (restoredBatches !== undefined) {
        if (restoredBatches === null || restoredBatches.length === 0)
            delete data['grind_note_batches'];
        else
            data['grind_note_batches'] = [...restoredBatches];
    }
    const nextBody = body ?? frontmatter.body;
    if (Object.keys(data).length === 0)
        return nextBody;
    return `---\n${stringify(data)}---\n${nextBody}`;
}
export function restoredSidecarBatches(raw) {
    const frontmatter = parseFrontmatter(raw);
    if (frontmatter.error !== undefined)
        throw new Error(frontmatter.error);
    const value = frontmatter.data?.['grind_note_batches'];
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw new Error('`grind_note_batches` must be a list of strings');
    }
    return value;
}
function parseNotes(body) {
    const notes = [];
    let current = null;
    const flush = () => {
        if (!current)
            return;
        const [, reference, notePath, start, end] = current.heading;
        const lines = [...current.lines];
        while (lines.length > 0 && lines[0]?.trim() === '')
            lines.shift();
        let anchor = null;
        if (lines[0]?.startsWith('>')) {
            anchor = lines.shift().replace(/^>\s?/, '');
        }
        notes.push({
            reference: reference,
            path: notePath,
            start: Number(start),
            end: Number(end ?? start),
            anchor,
            body: lines.join('\n').trim(),
        });
    };
    for (const line of body.split(/\r?\n/)) {
        const heading = NOTE_HEADING.exec(line);
        if (heading) {
            flush();
            current = { heading, lines: [] };
        }
        else if (current) {
            current.lines.push(line);
        }
    }
    flush();
    return notes;
}
//# sourceMappingURL=sidecar.js.map