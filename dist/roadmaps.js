import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnostic } from './errors.js';
import { isRecord, parseFrontmatter } from './frontmatter.js';
function roadmapId(value) {
    return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}
/** Finds roadmap identities throughout the state directory without following symlinks. */
export async function readRoadmaps(stateDir) {
    const catalog = { documents: new Map(), diagnostics: [] };
    async function walk(dir) {
        for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === '.git')
                continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory())
                await walk(file);
            else if (entry.isFile() && entry.name.endsWith('.md')) {
                const parsed = parseFrontmatter(await readFile(file, 'utf8'));
                if (parsed.data?.['type'] !== 'Roadmap')
                    continue;
                const grind = parsed.data['grind'];
                const id = isRecord(grind) ? grind['id'] : undefined;
                if (!roadmapId(id)) {
                    catalog.diagnostics.push(diagnostic('error', 'ROADMAP_ID_INVALID', 'A Roadmap requires a nonempty string grind.id without surrounding whitespace', file));
                    continue;
                }
                const docs = catalog.documents.get(id) ?? [];
                docs.push({ id, path: file, body: parsed.body, metadata: parsed.data });
                catalog.documents.set(id, docs);
            }
        }
    }
    await walk(stateDir);
    for (const [id, docs] of catalog.documents) {
        if (docs.length > 1)
            catalog.diagnostics.push(diagnostic('error', 'ROADMAP_ID_DUPLICATE', `Roadmap ID "${id}" is declared by multiple files: ${docs.map(doc => doc.path).join(', ')}`, docs[0].path));
    }
    return catalog;
}
export function resolveRoadmap(frontmatter, file, catalog, diagnostics) {
    const grind = frontmatter.data?.['grind'];
    if (!isRecord(grind) || !Object.hasOwn(grind, 'roadmap'))
        return null;
    const id = grind['roadmap'];
    if (!roadmapId(id)) {
        diagnostics.push(diagnostic('error', 'ROADMAP_REFERENCE_INVALID', 'grind.roadmap must be a nonempty roadmap ID without surrounding whitespace', file));
        return null;
    }
    const matches = catalog.documents.get(id) ?? [];
    if (matches.length !== 1) {
        diagnostics.push(diagnostic('error', matches.length === 0 ? 'ROADMAP_NOT_FOUND' : 'ROADMAP_AMBIGUOUS', `Roadmap ID "${id}" resolves to ${matches.length} documents`, file));
        return null;
    }
    return matches[0];
}
//# sourceMappingURL=roadmaps.js.map