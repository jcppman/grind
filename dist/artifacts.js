import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readRoadmaps, resolveRoadmap } from './roadmaps.js';
import { navigation } from './context-markdown.js';
import { diagnostic } from './errors.js';
import { getString, isRecord, parseFrontmatter } from './frontmatter.js';
import { LEDGER_TYPE, validateLedger } from './ledger.js';
import { pathExists, toPosix } from './paths.js';
export const INTENT_TYPE = 'Intent';
export const REQUIRED_ARTIFACTS = ['index.md', 'intent.md', 'ledger.md'];
/** Reads every Markdown artifact of an initiative without modifying anything. */
export async function readInitiative(dir, options = {}) {
    const diagnostics = [];
    const files = await collectMarkdown(dir, diagnostics);
    const documents = [];
    for (const file of files) {
        documents.push(await readDocument(dir, file, diagnostics));
    }
    for (const required of REQUIRED_ARTIFACTS) {
        if (!files.includes(path.join(dir, required))) {
            diagnostics.push(diagnostic('error', 'MISSING_ARTIFACT', `Required artifact ${required} is missing`, path.join(dir, required)));
        }
    }
    const byRelative = (relative) => documents.find((d) => d.relativePath === relative) ?? null;
    const ledger = byRelative('ledger.md');
    const ledgerState = ledger
        ? validateLedger(ledger.frontmatter, ledger.path)
        : null;
    if (ledgerState)
        diagnostics.push(...ledgerState.diagnostics);
    for (const doc of documents) {
        if (doc.role === 'index')
            diagnostics.push(...(await checkIndexLinks(doc)));
    }
    const catalog = options.roadmapCatalog ?? (options.workspace ? await readRoadmaps(options.workspace.stateDir) : null);
    const roadmaps = [];
    let roadmap = null;
    if (catalog) {
        diagnostics.push(...catalog.diagnostics.filter(item => documents.some(doc => doc.path === item.path)));
        for (const doc of documents) {
            const resolved = resolveRoadmap(doc.frontmatter, doc.path, catalog, diagnostics);
            if (doc.role === 'intent')
                roadmap = resolved;
            if (resolved && !roadmaps.some(existing => existing.id === resolved.id))
                roadmaps.push(resolved);
        }
    }
    return {
        dir,
        roadmap,
        roadmaps,
        documents,
        index: byRelative('index.md'),
        intent: byRelative('intent.md'),
        ledger,
        ledgerState,
        diagnostics,
    };
}
async function collectMarkdown(dir, diagnostics) {
    const result = [];
    for (const name of await readdir(dir)) {
        const full = path.join(dir, name);
        const info = await lstat(full);
        if (info.isSymbolicLink()) {
            diagnostics.push(diagnostic('error', 'SYMLINK_NOT_ALLOWED', 'Symbolic links are not allowed beneath initiatives/', full));
        }
        else if (info.isDirectory()) {
            result.push(...(await collectMarkdown(full, diagnostics)));
        }
        else if (info.isFile() && name.endsWith('.md')) {
            result.push(full);
        }
    }
    return result.sort();
}
async function readDocument(dir, file, diagnostics) {
    const relativePath = toPosix(path.relative(dir, file));
    const frontmatter = parseFrontmatter(await readFile(file, 'utf8'));
    const role = roleOf(relativePath);
    const type = frontmatter.data ? getString(frontmatter.data, 'type') : null;
    if (frontmatter.error !== undefined) {
        diagnostics.push(diagnostic('error', 'FRONTMATTER_INVALID', frontmatter.error, file));
    }
    if (role === 'index') {
        if (frontmatter.hasFrontmatter && frontmatter.data && !validIndexMetadata(frontmatter.data)) {
            diagnostics.push(diagnostic('warning', 'INDEX_FRONTMATTER', 'Indexes allow only `okf_version` and `grind.roadmap` frontmatter', file));
        }
    }
    else if (role !== 'ledger' || frontmatter.hasFrontmatter) {
        if (!frontmatter.hasFrontmatter) {
            diagnostics.push(diagnostic('warning', 'LEGACY_RECORD', 'Artifact has no frontmatter; migrate it explicitly', file));
        }
        else if (type === null && frontmatter.error === undefined) {
            diagnostics.push(diagnostic('error', 'MISSING_TYPE', 'Artifact frontmatter requires a nonempty string `type`', file));
        }
    }
    const grind = frontmatter.data?.['grind'];
    const root = isRecord(grind) ? grind['root'] : undefined;
    if (role === 'intent' && root !== true) {
        diagnostics.push(diagnostic('error', 'ROOT_REQUIRED', 'Initiative intent must declare grind.root: true', file));
    }
    else if (role !== 'intent' && root === true) {
        diagnostics.push(diagnostic('error', 'NESTED_ROOT', 'Only the initiative root intent may declare grind.root: true', file));
    }
    if (root !== undefined && typeof root !== 'boolean') {
        diagnostics.push(diagnostic('error', 'ROOT_INVALID', 'grind.root must be a boolean', file));
    }
    const expected = role === 'intent' ? INTENT_TYPE : role === 'ledger' ? LEDGER_TYPE : null;
    if (expected !== null && type !== null && type !== expected) {
        diagnostics.push(diagnostic('warning', 'TYPE_MISMATCH', `Expected type "${expected}" but found "${type}"`, file));
    }
    return { path: file, relativePath, role, type, frontmatter };
}
function roleOf(relativePath) {
    if (relativePath === 'intent.md')
        return 'intent';
    if (relativePath === 'ledger.md')
        return 'ledger';
    if (path.posix.basename(relativePath) === 'index.md')
        return 'index';
    return 'document';
}
function validIndexMetadata(data) {
    return Object.keys(data).every(key => key === 'okf_version' ||
        (key === 'grind' && isRecord(data[key]) && Object.keys(data[key]).every(field => field === 'roadmap')));
}
/** Local links in an index must resolve so navigation never points at a missing document. */
async function checkIndexLinks(doc) {
    const diagnostics = [];
    try {
        for (const link of navigation(doc.frontmatter.body, doc.path)) {
            if (!link.external && !(await pathExists(link.path))) {
                diagnostics.push(diagnostic('error', 'BROKEN_LINK', `Index link "${link.path}" does not resolve`, doc.path));
            }
        }
    }
    catch (error) {
        diagnostics.push(diagnostic('error', 'BROKEN_LINK', error.message, doc.path));
    }
    return diagnostics;
}
//# sourceMappingURL=artifacts.js.map