import { execFile } from 'node:child_process';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readInitiative } from './artifacts.ts';
import { defaultRemote, inProgressOperation, listWorktrees, pruneWorktrees, worktreesRoot } from './checkouts.ts';
import { listInitiatives } from './discovery.ts';
import { git, gitChangedFiles } from './git.ts';
import { branchOwners } from './resolve.ts';
import { inspectInitiative } from './inspect.ts';
import { normalizeRepositoryPath, toPosix } from './paths.ts';
import type { Workspace } from './workspace.ts';

const execFileAsync = promisify(execFile);
const DAY_MS = 86_400_000;
const MAX_SCAN_DEPTH = 6;
const MERGED_GRACE_DAYS = 1;

export interface RemovalCheck {
  removable: boolean;
  reasons: string[];
}

interface Blocker {
  code: 'not-worktree' | 'outside-root' | 'dirty' | 'unpushed' | 'operation' | 'in-use' | 'unknown';
  message: string;
}

export interface RemovalOptions {
  /** Working directories of live processes, as returned by `processWorkingDirectories`; read once per batch. */
  cwds?: string[] | null;
  /** Waives the unpushed-commit check; the local branch keeps the commits when the worktree is removed. */
  allowUnpushed?: boolean;
}

/** Working directories of all live processes, or null when they cannot be determined. */
export async function processWorkingDirectories(): Promise<string[] | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-Fn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    const failure = error as { stdout?: string };
    // lsof exits 1 when it could not inspect some processes but still reports the others.
    if (typeof failure.stdout !== 'string' || !/^p\d+$/m.test(failure.stdout)) return null;
    stdout = failure.stdout;
  }
  return stdout.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function blockers(workspace: Workspace, dir: string, options: RemovalOptions): Promise<Blocker[]> {
  const real = await realpath(dir).catch(() => null);
  if (real === null) return [{ code: 'not-worktree', message: 'path does not exist' }];
  const root = await realpath(worktreesRoot(workspace)).catch(() => worktreesRoot(workspace));
  if (!inside(root, real) || real === root) return [{ code: 'outside-root', message: `not under ${root}` }];
  const marker = await lstat(path.join(real, '.git')).catch(() => null);
  if (marker === null || !marker.isFile()) return [{ code: 'not-worktree', message: 'not a linked worktree' }];
  const worktrees = await listWorktrees(real).catch(() => []);
  const main = worktrees[0];
  if (main === undefined || main.path === real || !worktrees.some((entry) => entry.path === real)) {
    return [{ code: 'not-worktree', message: 'not a linked worktree of a repository' }];
  }

  const found: Blocker[] = [];
  const changed = await gitChangedFiles(real);
  if (changed === null) found.push({ code: 'unknown', message: 'git status failed' });
  else if (changed.length > 0) found.push({ code: 'dirty', message: `${changed.length} uncommitted or untracked file(s)` });

  if (options.allowUnpushed !== true) {
    const unpushed = await git(['rev-list', 'HEAD', '--not', '--remotes'], real);
    if (!unpushed.ok) found.push({ code: 'unknown', message: 'cannot list unpushed commits' });
    else if (unpushed.stdout.trim() !== '') found.push({ code: 'unpushed', message: `${unpushed.stdout.trim().split('\n').length} commit(s) not on any remote` });
  }

  const operation = await inProgressOperation(real);
  if (operation !== null) found.push({ code: 'operation', message: `${operation} in progress` });

  const cwds = options.cwds === undefined ? await processWorkingDirectories() : options.cwds;
  if (cwds === null) found.push({ code: 'unknown', message: 'cannot determine whether a process uses it (lsof failed)' });
  else if (cwds.some((cwd) => inside(real, cwd))) found.push({ code: 'in-use', message: 'a running process has its working directory inside it' });
  return found;
}

/**
 * Whether the linked worktree at `dir` may be deleted without losing work: it lies under the
 * workspace's worktree root, is clean (ignored files do not count), has no commits missing
 * from every remote and no operation in progress, and no process works inside it.
 */
export async function worktreeRemovalCheck(workspace: Workspace, dir: string, options: RemovalOptions = {}): Promise<RemovalCheck> {
  const found = await blockers(workspace, dir, options);
  return { removable: found.length === 0, reasons: found.map((item) => item.message) };
}

export interface RemovedWorktree {
  path: string;
  branch: string | null;
}

export interface SkippedWorktree extends RemovedWorktree {
  reasons: string[];
}

/** Removes `dir` with `git worktree remove` (never forced) when `worktreeRemovalCheck` passes. */
export async function removeWorktreeIfSafe(workspace: Workspace, dir: string, options: RemovalOptions = {}): Promise<{ removed: boolean; reasons: string[] }> {
  const check = await worktreeRemovalCheck(workspace, dir, options);
  if (!check.removable) return { removed: false, reasons: check.reasons };
  const real = await realpath(dir);
  const worktrees = await listWorktrees(real);
  const main = worktrees[0]!.path;
  const result = await git(['worktree', 'remove', real], main);
  await pruneWorktrees(main);
  return result.ok ? { removed: true, reasons: [] } : { removed: false, reasons: [`git worktree remove failed: ${result.stderr.trim()}`] };
}

export interface InitiativeWorktreeRemoval {
  removed: RemovedWorktree[];
  skipped: SkippedWorktree[];
}

/** Removes the safe linked worktrees of the branches that the initiative `id` records. */
export async function removeInitiativeWorktrees(workspace: Workspace, id: string, initiative: Parameters<typeof inspectInitiative>[1]): Promise<InitiativeWorktreeRemoval> {
  const result: InitiativeWorktreeRemoval = { removed: [], skipped: [] };
  const inspection = await inspectInitiative(workspace, initiative);
  const cwds = await processWorkingDirectories();
  for (const repository of inspection.repositories) {
    const { path: checkout, kind } = repository.observed;
    const entry = { path: checkout ?? '', branch: repository.recorded.branch };
    if (checkout === null || kind === null) continue;
    const others = (await branchOwners(workspace, normalizeRepositoryPath(repository.recorded.path), repository.recorded.branch)).filter((owner) => owner.id !== id);
    if (others.length > 0) {
      result.skipped.push({ ...entry, reasons: [`branch is also owned by open init ${others.map((owner) => owner.id).join(', ')}`] });
      continue;
    }
    const outcome = await removeWorktreeIfSafe(workspace, checkout, { cwds });
    if (outcome.removed) result.removed.push(entry);
    else result.skipped.push({ ...entry, reasons: outcome.reasons });
  }
  return result;
}

export interface PruneCandidate extends RemovedWorktree {
  sizeKb: number;
  reason: string;
}

export interface PruneResult {
  dryRun: boolean;
  idleDays: number;
  candidates: PruneCandidate[];
  removed: PruneCandidate[];
  failed: SkippedWorktree[];
  skipped: SkippedWorktree[];
  totalKb: number;
  reclaimedKb: number;
}

export interface PruneOptions {
  dryRun: boolean;
  idleDays?: number;
  now?: number;
}

/** Linked-worktree directories under the worktree root; symbolic links are never followed. */
async function scanWorktrees(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    const marker = await lstat(path.join(dir, '.git')).catch(() => null);
    if (marker !== null) {
      if (marker.isFile()) found.push(dir);
      return;
    }
    if (depth >= MAX_SCAN_DEPTH) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(path.join(dir, entry.name), depth + 1);
    }
  }
  const info = await lstat(root).catch(() => null);
  if (info !== null && info.isDirectory()) await walk(root, 0);
  return found.sort();
}

async function openInitiativeBranches(workspace: Workspace): Promise<Set<string>> {
  const owned = new Set<string>();
  const listing = await listInitiatives(workspace.initiativesDir);
  for (const entry of listing.entries) {
    if (entry.archived) continue;
    const record = await readInitiative(entry.dir, { workspace });
    const state = record.ledgerState?.state;
    if (state?.status !== 'open') continue;
    for (const repository of state.repositories) owned.add(`${normalizeRepositoryPath(repository.path)}\0${repository.branch}`);
  }
  return owned;
}

async function lastActivity(dir: string): Promise<number> {
  let latest = 0;
  const commit = await git(['log', '-1', '--format=%ct'], dir);
  if (commit.ok && commit.stdout.trim() !== '') latest = Number(commit.stdout.trim()) * 1000;
  const marker = await stat(path.join(dir, '.git')).catch(() => null);
  if (marker !== null) latest = Math.max(latest, marker.mtimeMs);
  const files = await git(['ls-files', '-z'], dir);
  for (const file of files.ok ? files.stdout.split('\0').filter(Boolean) : []) {
    const info = await lstat(path.join(dir, file)).catch(() => null);
    if (info !== null) latest = Math.max(latest, info.mtimeMs);
  }
  return latest;
}

async function mergedReason(dir: string, branch: string | null): Promise<string | null> {
  const remote = await defaultRemote(dir);
  if (remote === null) return null;
  let base = '';
  const head = await git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], dir);
  if (head.ok) base = head.stdout.trim();
  else {
    for (const candidate of ['main', 'master']) {
      if ((await git(['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${candidate}`], dir)).ok) {
        base = `${remote}/${candidate}`;
        break;
      }
    }
  }
  if (base !== '' && (await git(['merge-base', '--is-ancestor', 'HEAD', base], dir)).ok) return `merged into ${base}`;
  if (branch !== null) {
    const track = await git(['for-each-ref', '--format=%(upstream:track)', `refs/heads/${branch}`], dir);
    if (track.ok && track.stdout.trim() === '[gone]') return 'upstream branch was deleted';
  }
  return null;
}

async function sizeKb(dir: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', dir], { encoding: 'utf8' });
    return Number.parseInt(stdout, 10) || 0;
  } catch (error) {
    return Number.parseInt((error as { stdout?: string }).stdout ?? '', 10) || 0;
  }
}

/**
 * Finds, and unless `dryRun` removes, worktrees under the worktree root that no longer
 * hold work: removal-safe, not on a branch of an open init, and either merged (or its
 * upstream deleted) or idle for `idleDays`.
 */
export async function pruneWorktreesCommand(workspace: Workspace, options: PruneOptions): Promise<PruneResult> {
  const idleDays = options.idleDays ?? 14;
  const now = options.now ?? Date.now();
  const root = await realpath(worktreesRoot(workspace)).catch(() => null);
  const result: PruneResult = { dryRun: options.dryRun, idleDays, candidates: [], removed: [], failed: [], skipped: [], totalKb: 0, reclaimedKb: 0 };
  if (root === null) return result;
  const owned = await openInitiativeBranches(workspace);
  const cwds = await processWorkingDirectories();
  const allowedUnpushed = new Map<string, boolean>();

  for (const dir of await scanWorktrees(root)) {
    const branchResult = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], dir);
    const branch = branchResult.ok && branchResult.stdout.trim() !== '' ? branchResult.stdout.trim() : null;
    const entry = { path: dir, branch };
    const worktrees = await listWorktrees(dir).catch(() => []);
    const main = worktrees[0]?.path;
    if (main !== undefined && branch !== null) {
      const repositoryPath = toPosix(path.relative(workspace.root, main));
      if (owned.has(`${normalizeRepositoryPath(repositoryPath)}\0${branch}`)) {
        result.skipped.push({ ...entry, reasons: ['branch is owned by an open init'] });
        continue;
      }
    }
    const merged = await mergedReason(dir, branch);
    const gone = merged === 'upstream branch was deleted';
    allowedUnpushed.set(dir, gone);
    const check = await worktreeRemovalCheck(workspace, dir, { cwds, allowUnpushed: gone });
    if (!check.removable) {
      result.skipped.push({ ...entry, reasons: check.reasons });
      continue;
    }
    const activity = await lastActivity(dir);
    const idleFor = (now - activity) / DAY_MS;
    let reason: string | null = null;
    if (merged !== null && idleFor > MERGED_GRACE_DAYS) reason = merged;
    else if (idleFor > idleDays) reason = `idle for ${Math.floor(idleFor)} days`;
    if (reason === null) {
      result.skipped.push({ ...entry, reasons: [merged === null ? `active within ${idleDays} days and not merged` : 'merged but active within the last day'] });
      continue;
    }
    result.candidates.push({ ...entry, sizeKb: await sizeKb(dir), reason });
  }
  result.totalKb = result.candidates.reduce((sum, item) => sum + item.sizeKb, 0);
  if (options.dryRun) return result;
  for (const candidate of result.candidates) {
    const outcome = await removeWorktreeIfSafe(workspace, candidate.path, { cwds, allowUnpushed: allowedUnpushed.get(candidate.path) === true });
    if (outcome.removed) {
      result.removed.push(candidate);
      result.reclaimedKb += candidate.sizeKb;
    } else result.failed.push({ path: candidate.path, branch: candidate.branch, reasons: outcome.reasons });
  }
  return result;
}
