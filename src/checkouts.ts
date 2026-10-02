import { lstat, mkdir, readlink, realpath, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.ts';
import { git, gitToplevel } from './git.ts';
import { pathExists, pathsBelow, toPosix } from './paths.ts';
import { findNestedWorkspaceConfig, type Workspace } from './workspace.ts';

export const WORKTREES_FOLDER = '.worktrees';
const APP_WORKTREE_SEGMENTS = [`${path.sep}.claude${path.sep}worktrees${path.sep}`, `${path.sep}.codex${path.sep}worktrees${path.sep}`];
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'];

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
}

export type CheckoutKind = 'canonical' | 'grind' | 'app' | 'other';

export interface BranchLocation {
  /** Where the branch is checked out, or null when it is not checked out anywhere. */
  path: string | null;
  kind: CheckoutKind | null;
}

export interface RepositoryCheckout {
  /** Real path of the checkout containing the inspected directory. */
  root: string;
  /** Real path of the repository's main worktree. */
  canonical: string;
  /** Workspace-relative path of the canonical checkout. */
  repositoryPath: string;
  branch: string | null;
}

/** Worktrees of the repository at `dir`; the first entry is the main worktree. */
export async function listWorktrees(dir: string): Promise<WorktreeEntry[]> {
  const result = await git(['worktree', 'list', '--porcelain'], dir);
  if (!result.ok) throw new GrindError('GIT_ERROR', result.stderr.trim() || `Cannot list worktrees of ${dir}`);
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, head: null, bare: false };
      entries.push(current);
    } else if (current !== null && line.startsWith('branch refs/heads/')) current.branch = line.slice('branch refs/heads/'.length);
    else if (current !== null && line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    else if (current !== null && line === 'bare') current.bare = true;
  }
  for (const entry of entries) entry.path = await realpath(entry.path).catch(() => path.resolve(entry.path));
  return entries;
}

/** The repository containing `dir`, identified by its canonical checkout inside the workspace. */
export async function repositoryCheckout(workspace: Workspace, dir: string): Promise<RepositoryCheckout | null> {
  const root = await gitToplevel(dir);
  if (root === null) return null;
  const worktrees = await listWorktrees(root);
  const main = worktrees[0];
  if (main === undefined || main.bare) return null;
  const relative = path.relative(workspace.root, main.path);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (await findNestedWorkspaceConfig(workspace.root, main.path)) return null;
  const current = worktrees.find((entry) => entry.path === root);
  return { root, canonical: main.path, repositoryPath: toPosix(relative), branch: current?.branch ?? null };
}

export function worktreesRoot(workspace: Workspace): string {
  return path.join(workspace.root, WORKTREES_FOLDER);
}

/** Last segment of an initiative ID, used to name its worktrees and default branches. */
export function initiativeName(id: string): string {
  return id.split('/').at(-1) as string;
}

export function standardWorktreePath(workspace: Workspace, repositoryPath: string, initiativeId: string): string {
  return path.join(worktreesRoot(workspace), ...repositoryPath.split('/'), initiativeName(initiativeId));
}

export function checkoutKind(workspace: Workspace, canonical: string, checkout: string): CheckoutKind {
  if (checkout === canonical) return 'canonical';
  const relative = path.relative(worktreesRoot(workspace), checkout);
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) return 'grind';
  if (APP_WORKTREE_SEGMENTS.some((segment) => `${checkout}${path.sep}`.includes(segment))) return 'app';
  return 'other';
}

/** Where `branch` of the repository at `canonical` is checked out. */
export async function locateBranch(workspace: Workspace, canonical: string, branch: string): Promise<BranchLocation> {
  const entry = (await listWorktrees(canonical)).find((item) => item.branch === branch);
  if (entry === undefined) return { path: null, kind: null };
  return { path: entry.path, kind: checkoutKind(workspace, canonical, entry.path) };
}

async function gitPathExists(checkout: string, name: string): Promise<boolean> {
  const location = await git(['rev-parse', '--git-path', name], checkout);
  if (!location.ok) return false;
  return lstat(path.resolve(checkout, location.stdout.trim())).then(() => true, () => false);
}

/** Name of the merge, rebase, or similar operation in progress in `checkout`, or null. */
export async function inProgressOperation(checkout: string): Promise<string | null> {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
    if (await gitPathExists(checkout, marker)) return marker;
  }
  return null;
}

async function lines(dir: string, args: string[]): Promise<string[]> {
  const result = await git(args, dir);
  return result.ok ? result.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

/** The remote whose default branch new branches start from. */
export async function defaultRemote(dir: string): Promise<string | null> {
  const remotes = await lines(dir, ['remote']);
  if (remotes.includes('origin')) return 'origin';
  return remotes.length === 1 ? remotes[0] as string : null;
}

export interface BranchSource {
  /** `local-default` applies only to repositories without remotes. */
  origin: 'local' | 'remote' | 'remote-default' | 'local-default';
  /** Start point of a branch that does not exist locally yet. */
  base: string | null;
  track: boolean;
}

/**
 * How to obtain `branch`: the local branch, a remote branch of the same name, or a new
 * branch from the remote's default branch, or from local main or master when there is no
 * remote. Callers fetch first when they want fresh refs.
 */
export async function branchSource(dir: string, branch: string): Promise<BranchSource> {
  if ((await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], dir)).ok) return { origin: 'local', base: null, track: false };
  const remote = await defaultRemote(dir);
  if (remote === null) {
    if ((await lines(dir, ['remote'])).length === 0) {
      for (const candidate of ['main', 'master']) {
        if ((await git(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], dir)).ok) return { origin: 'local-default', base: candidate, track: false };
      }
    }
    throw new GrindError('GIT_ERROR', `Cannot create branch ${branch} in ${dir}: no origin, not exactly one remote, and no local main or master`, { branch });
  }
  if ((await git(['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`], dir)).ok) {
    return { origin: 'remote', base: `${remote}/${branch}`, track: true };
  }
  const head = await git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], dir);
  let base = head.ok ? head.stdout.trim() : '';
  if (base === '') {
    for (const candidate of ['main', 'master']) {
      if ((await git(['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${candidate}`], dir)).ok) {
        base = `${remote}/${candidate}`;
        break;
      }
    }
  }
  if (base === '') {
    throw new GrindError('GIT_ERROR', `Cannot create branch ${branch}: the default branch of ${remote} is unknown; run git remote set-head ${remote} --auto`, { branch, remote });
  }
  return { origin: 'remote-default', base, track: false };
}

function creation(branch: string, source: BranchSource): string[] {
  return source.base === null ? [] : [source.track ? '--track' : '--no-track', '-b', branch];
}

export function worktreeAddArgs(target: string, branch: string, source: BranchSource): string[] {
  return ['worktree', 'add', ...creation(branch, source), target, source.base ?? branch];
}

export function checkoutArgs(branch: string, source: BranchSource): string[] {
  return ['checkout', ...creation(branch, source), source.base ?? branch];
}

/** Fetches the default remote; returns a warning instead of failing when offline. */
export async function fetchDefaultRemote(dir: string): Promise<string | null> {
  const remote = await defaultRemote(dir);
  if (remote === null) return null;
  const result = await git(['fetch', '--quiet', remote], dir);
  return result.ok ? null : `git fetch ${remote} failed; using local refs: ${result.stderr.trim()}`;
}

export interface InstructionLink {
  link: string;
  target: string;
  status: 'exists' | 'created' | 'replaced' | 'blocked';
}

/**
 * Mirrors instruction files of the folders between the workspace root and the canonical
 * checkout under the worktree root, so worktrees receive the same directory-scoped instructions.
 */
export async function ensureInstructionLinks(workspace: Workspace, canonical: string): Promise<InstructionLink[]> {
  const results: InstructionLink[] = [];
  const folders = pathsBelow(workspace.root, path.dirname(canonical)).reverse();
  for (const folder of folders) {
    const relative = path.relative(workspace.root, folder);
    for (const name of INSTRUCTION_FILES) {
      const target = path.join(folder, name);
      if (!(await pathExists(target))) continue;
      const link = path.join(worktreesRoot(workspace), relative, name);
      const linkTarget = path.relative(path.dirname(link), target);
      const existing = await lstat(link).catch(() => null);
      if (existing !== null && !existing.isSymbolicLink()) {
        results.push({ link, target, status: 'blocked' });
        continue;
      }
      if (existing !== null) {
        const current = path.resolve(path.dirname(link), await readlink(link));
        if (current === target) {
          results.push({ link, target, status: 'exists' });
          continue;
        }
        await rm(link);
      }
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(linkTarget, link);
      results.push({ link, target, status: existing === null ? 'created' : 'replaced' });
    }
  }
  return results;
}
