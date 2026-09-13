import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { diagnostic, type Diagnostic } from './errors.ts';
import { pathExists, toPosix } from './paths.ts';

export const ARCHIVE_FOLDER = '_archive';
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

export interface InitiativeListing {
  entries: InitiativeEntry[];
  diagnostics: Diagnostic[];
}

/**
 * Every initiative folder beneath `initiativesDir`. A folder is an initiative
 * when it contains `intent.md`; folders below it are documents, not initiatives.
 * Symbolic links are not allowed and are reported, not followed.
 */
export async function listInitiatives(initiativesDir: string): Promise<InitiativeListing> {
  const listing: InitiativeListing = { entries: [], diagnostics: [] };
  if (!(await pathExists(initiativesDir))) return listing;
  await walk(initiativesDir, initiativesDir, listing);
  listing.entries.sort((a, b) => a.id.localeCompare(b.id));
  return listing;
}

async function walk(root: string, dir: string, listing: InitiativeListing): Promise<void> {
  if (await pathExists(path.join(dir, INTENT_FILENAME))) {
    const id = toPosix(path.relative(root, dir));
    listing.entries.push({ id, dir, archived: isArchivedId(id) });
    return;
  }
  for (const name of await readdir(dir)) {
    const child = path.join(dir, name);
    const info = await lstat(child);
    if (info.isSymbolicLink()) {
      listing.diagnostics.push(
        diagnostic('error', 'SYMLINK_NOT_ALLOWED', 'Symbolic links are not allowed beneath initiatives/', child),
      );
    } else if (info.isDirectory()) {
      await walk(root, child, listing);
    }
  }
}
