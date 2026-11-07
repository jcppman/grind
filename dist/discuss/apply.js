import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from '../errors.js';
import { sha256 } from './protocol.js';
import { readJson, writeJsonAtomic } from './store.js';
/**
 * Canonicalizes each requested target. A target must be an existing regular
 * file reached without a final symbolic link, and each may appear only once.
 */
export async function resolveTargets(cwd, requested) {
    const targets = [];
    for (const item of requested) {
        const absolute = path.resolve(cwd, item);
        const info = await lstat(absolute).catch(() => null);
        if (info === null)
            throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} does not exist`, { target: item });
        if (info.isSymbolicLink())
            throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} is a symbolic link; name the real file`, { target: item });
        if (!info.isFile())
            throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} is not a regular file`, { target: item });
        const canonical = path.join(await realpath(path.dirname(absolute)), path.basename(absolute));
        if (targets.some((target) => target.path === canonical))
            throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} is listed more than once`, { target: item });
        targets.push({ path: canonical, requested: item, beforeSha256: sha256(await readFile(canonical)) });
    }
    return targets;
}
/** Hash of `file` only while it is still a regular file at its canonical path; otherwise null, which never matches a recorded hash. */
async function currentHash(file) {
    const parent = await realpath(path.dirname(file)).catch(() => null);
    if (parent !== path.dirname(file))
        return null;
    const info = await lstat(file).catch(() => null);
    if (info === null || !info.isFile())
        return null;
    return sha256(await readFile(file));
}
async function replaceFile(file, content) {
    const mode = (await stat(file)).mode & 0o777;
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.grind-${randomUUID()}.tmp`);
    await writeFile(temp, content, { mode, flag: 'wx' });
    try {
        await rename(temp, file);
    }
    catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}
/**
 * Applies the accepted candidate to its authorized targets, one atomic file
 * replacement at a time. Any file that matches neither its recorded original
 * nor the accepted bytes stops the application as a write conflict.
 */
export async function applyCandidate(journalFile, targets, candidate, hooks = {}) {
    let journal = await readJson(journalFile);
    if (journal !== null && journal.candidateHash !== candidate.hash) {
        throw new GrindError('DISCUSSION_STATE', 'An application journal exists for a different candidate', { journal: journalFile });
    }
    if (journal?.status === 'applied')
        return journal;
    if (journal === null) {
        const files = targets.map((target) => {
            const doc = candidate.documents.find((item) => item.target === target.path);
            if (!doc)
                throw new GrindError('DISCUSSION_STATE', `Accepted candidate has no document for ${target.path}`);
            return { path: target.path, before: target.beforeSha256, after: sha256(doc.content), state: 'pending' };
        });
        journal = { status: 'applying', revision: candidate.revision, candidateHash: candidate.hash, files, conflicts: [], updatedAt: new Date().toISOString() };
        await writeJsonAtomic(journalFile, journal);
    }
    const save = async () => {
        journal.updatedAt = new Date().toISOString();
        await writeJsonAtomic(journalFile, journal);
    };
    const conflicts = [];
    for (const file of journal.files) {
        const actual = await currentHash(file.path);
        if (actual === file.after)
            file.state = 'applied';
        else if (actual !== file.before)
            conflicts.push({ path: file.path, expected: file.state === 'applied' ? file.after : file.before, actual });
    }
    if (conflicts.length > 0) {
        journal.status = 'write_conflict';
        journal.conflicts = conflicts;
        await save();
        return journal;
    }
    for (const file of journal.files) {
        if (file.state === 'applied')
            continue;
        const content = candidate.documents.find((item) => item.target === file.path).content;
        if ((await currentHash(file.path)) !== file.before) {
            journal.status = 'write_conflict';
            journal.conflicts = [{ path: file.path, expected: file.before, actual: await currentHash(file.path) }];
            await save();
            return journal;
        }
        await replaceFile(file.path, content);
        if ((await currentHash(file.path)) !== file.after)
            throw new GrindError('WRITE_FAILED', `Verification failed after writing ${file.path}`);
        file.state = 'applied';
        await save();
        await hooks.afterFile?.(file.path);
    }
    for (const file of journal.files) {
        if ((await currentHash(file.path)) !== file.after) {
            journal.status = 'write_conflict';
            journal.conflicts = [{ path: file.path, expected: file.after, actual: await currentHash(file.path) }];
            await save();
            return journal;
        }
    }
    journal.status = 'applied';
    journal.conflicts = [];
    await save();
    return journal;
}
//# sourceMappingURL=apply.js.map