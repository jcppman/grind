import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnostic, GrindError } from './errors.js';
import { isRecord, parseFrontmatter } from './frontmatter.js';
import { pathExists, toPosix } from './paths.js';
export const ARCHIVE_FOLDER = '_archive';
export const INTENT_FILENAME = 'intent.md';
/** Whether an initiative id sits beneath the read-only archive prefix. */
export function isArchivedId(id) {
    return id === ARCHIVE_FOLDER || id.startsWith(`${ARCHIVE_FOLDER}/`);
}
/**
 * Lists folders whose intent declares `grind.root: true`, excluding nested documents.
 * Symbolic links are reported, not followed.
 */
export async function listInitiatives(initiativesDir) {
    const listing = { entries: [], diagnostics: [] };
    if (!(await pathExists(initiativesDir)))
        return listing;
    await walk(initiativesDir, initiativesDir, listing);
    listing.entries.sort((a, b) => a.id.localeCompare(b.id));
    return listing;
}
async function walk(root, dir, listing) {
    let rootMarker = false;
    try {
        rootMarker = await isInitiativeRoot(dir);
    }
    catch (error) {
        listing.diagnostics.push(diagnostic('error', 'ROOT_INVALID', error.message, path.join(dir, INTENT_FILENAME)));
    }
    if (rootMarker) {
        const id = toPosix(path.relative(root, dir));
        listing.entries.push({ id, dir, archived: isArchivedId(id) });
        return;
    }
    for (const name of await readdir(dir)) {
        const child = path.join(dir, name);
        const info = await lstat(child);
        if (info.isSymbolicLink()) {
            listing.diagnostics.push(diagnostic('error', 'SYMLINK_NOT_ALLOWED', 'Symbolic links are not allowed beneath initiatives/', child));
        }
        else if (info.isDirectory()) {
            await walk(root, child, listing);
        }
    }
}
/** Whether this folder explicitly declares an initiative boundary. */
export async function isInitiativeRoot(dir) {
    const file = path.join(dir, INTENT_FILENAME);
    const info = await lstat(file).catch((error) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
            return null;
        throw error;
    });
    if (info === null)
        return false;
    if (!info.isFile())
        throw new GrindError('ARTIFACT_INVALID', `Initiative intent must be a regular file: ${file}`);
    const frontmatter = parseFrontmatter(await readFile(file, 'utf8'));
    if (frontmatter.error)
        throw new GrindError('ARTIFACT_INVALID', `${file}: ${frontmatter.error}`);
    const grind = frontmatter.data?.['grind'];
    if (grind !== undefined && !isRecord(grind))
        throw new GrindError('ARTIFACT_INVALID', `${file}: grind must be a mapping`);
    const root = isRecord(grind) ? grind['root'] : undefined;
    if (root !== undefined && typeof root !== 'boolean')
        throw new GrindError('ARTIFACT_INVALID', `${file}: grind.root must be a boolean`);
    return root === true;
}
//# sourceMappingURL=discovery.js.map