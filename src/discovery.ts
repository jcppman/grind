import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDirectory, pathExists, toPosix } from './paths.ts';

export const ARCHIVE_FOLDER = '_archive';
export const WORKTREES_FOLDER = 'worktrees';
export const INTENT_FILENAME = 'intent.md';

/** Whether an initiative id sits beneath the read-only archive prefix. */
export function isArchivedId(id: string): boolean {
  return id === ARCHIVE_FOLDER || id.startsWith(`${ARCHIVE_FOLDER}/`);
}

export interface InitiativeEntry {
  /** Path relative to `initiatives/`, using forward slashes. */
  id: string;
  dir: string;
  archived: boolean;
}

/**
 * Every initiative folder beneath `initiativesDir`. A folder is an initiative
 * when it contains `intent.md`; folders below it are documents, not initiatives.
 */
export async function listInitiatives(initiativesDir: string): Promise<InitiativeEntry[]> {
  if (!(await pathExists(initiativesDir))) return [];
  const entries: InitiativeEntry[] = [];
  await walk(initiativesDir, initiativesDir, entries);
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

async function walk(root: string, dir: string, entries: InitiativeEntry[]): Promise<void> {
  if (await pathExists(path.join(dir, INTENT_FILENAME))) {
    const id = toPosix(path.relative(root, dir));
    entries.push({ id, dir, archived: isArchivedId(id) });
    return;
  }
  for (const name of await readdir(dir)) {
    if (name === WORKTREES_FOLDER) continue;
    const child = path.join(dir, name);
    if (await isDirectory(child)) await walk(root, child, entries);
  }
}
