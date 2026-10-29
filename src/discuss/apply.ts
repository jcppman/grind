import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from '../errors.ts';
import { sha256, type Candidate } from './protocol.ts';
import { readJson, writeJsonAtomic } from './store.ts';

export interface AuthorizedTarget {
  /** Canonical absolute path; the only spelling a candidate may use. */
  path: string;
  requested: string;
  beforeSha256: string;
}

/**
 * Canonicalizes each requested target. A target must be an existing regular
 * file reached without a final symbolic link, and each may appear only once.
 */
export async function resolveTargets(cwd: string, requested: readonly string[]): Promise<AuthorizedTarget[]> {
  const targets: AuthorizedTarget[] = [];
  for (const item of requested) {
    const absolute = path.resolve(cwd, item);
    const info = await lstat(absolute).catch(() => null);
    if (info === null) throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} does not exist`, { target: item });
    if (info.isSymbolicLink()) throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} is a symbolic link; name the real file`, { target: item });
    if (!info.isFile()) throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} is not a regular file`, { target: item });
    const canonical = path.join(await realpath(path.dirname(absolute)), path.basename(absolute));
    if (targets.some((target) => target.path === canonical)) throw new GrindError('DISCUSSION_TARGET_INVALID', `Target ${item} is listed more than once`, { target: item });
    targets.push({ path: canonical, requested: item, beforeSha256: sha256(await readFile(canonical)) });
  }
  return targets;
}

export type ApplicationStatus = 'not_requested' | 'applying' | 'applied' | 'write_conflict';

export interface ApplicationJournal {
  status: ApplicationStatus;
  revision: number;
  candidateHash: string;
  files: Array<{ path: string; before: string; after: string; state: 'pending' | 'applied' }>;
  conflicts: Array<{ path: string; expected: string; actual: string | null }>;
  updatedAt: string;
}

async function currentHash(file: string): Promise<string | null> {
  const info = await lstat(file).catch(() => null);
  if (info === null || !info.isFile()) return null;
  return sha256(await readFile(file));
}

async function replaceFile(file: string, content: string): Promise<void> {
  const mode = (await stat(file)).mode & 0o777;
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.grind-${randomUUID()}.tmp`);
  await writeFile(temp, content, { mode, flag: 'wx' });
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export interface ApplyHooks {
  /** Test seam called after each file is replaced and journaled. */
  afterFile?: (file: string) => Promise<void>;
}

/**
 * Applies the accepted candidate to its authorized targets, one atomic file
 * replacement at a time. Any file that matches neither its recorded original
 * nor the accepted bytes stops the application as a write conflict.
 */
export async function applyCandidate(journalFile: string, targets: readonly AuthorizedTarget[], candidate: Candidate, hooks: ApplyHooks = {}): Promise<ApplicationJournal> {
  let journal = await readJson<ApplicationJournal>(journalFile);
  if (journal !== null && journal.candidateHash !== candidate.hash) {
    throw new GrindError('DISCUSSION_STATE', 'An application journal exists for a different candidate', { journal: journalFile });
  }
  if (journal?.status === 'applied') return journal;
  if (journal === null) {
    const files = targets.map((target) => {
      const doc = candidate.documents.find((item) => item.target === target.path);
      if (!doc) throw new GrindError('DISCUSSION_STATE', `Accepted candidate has no document for ${target.path}`);
      return { path: target.path, before: target.beforeSha256, after: sha256(doc.content), state: 'pending' as const };
    });
    journal = { status: 'applying', revision: candidate.revision, candidateHash: candidate.hash, files, conflicts: [], updatedAt: new Date().toISOString() };
    await writeJsonAtomic(journalFile, journal);
  }
  const save = async () => {
    journal!.updatedAt = new Date().toISOString();
    await writeJsonAtomic(journalFile, journal);
  };
  const conflicts: ApplicationJournal['conflicts'] = [];
  for (const file of journal.files) {
    const actual = await currentHash(file.path);
    if (actual === file.after) file.state = 'applied';
    else if (actual !== file.before) conflicts.push({ path: file.path, expected: file.state === 'applied' ? file.after : file.before, actual });
  }
  if (conflicts.length > 0) {
    journal.status = 'write_conflict';
    journal.conflicts = conflicts;
    await save();
    return journal;
  }
  for (const file of journal.files) {
    if (file.state === 'applied') continue;
    const content = candidate.documents.find((item) => item.target === file.path)!.content;
    if ((await currentHash(file.path)) !== file.before) {
      journal.status = 'write_conflict';
      journal.conflicts = [{ path: file.path, expected: file.before, actual: await currentHash(file.path) }];
      await save();
      return journal;
    }
    await replaceFile(file.path, content);
    if ((await currentHash(file.path)) !== file.after) throw new GrindError('WRITE_FAILED', `Verification failed after writing ${file.path}`);
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
