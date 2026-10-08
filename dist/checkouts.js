import { lstat, mkdir, readlink, realpath, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.js';
import { git, gitToplevel } from './git.js';
import { pathExists, pathsBelow, toPosix } from './paths.js';
import { findNestedWorkspaceConfig } from './workspace.js';
export const WORKTREES_FOLDER = '.worktrees';
const APP_WORKTREE_SEGMENTS = [`${path.sep}.claude${path.sep}worktrees${path.sep}`, `${path.sep}.codex${path.sep}worktrees${path.sep}`];
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'];
/**
 * Worktrees of the repository at `dir`; the first entry is the main worktree. Registrations
 * whose directory is gone are left out.
 */
export async function listWorktrees(dir) {
    const result = await git(['worktree', 'list', '--porcelain'], dir);
    if (!result.ok)
        throw new GrindError('GIT_ERROR', result.stderr.trim() || `Cannot list worktrees of ${dir}`);
    const entries = [];
    let current = null;
    for (const line of result.stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
            current = { path: line.slice('worktree '.length), branch: null, head: null, bare: false, prunable: false };
            entries.push(current);
        }
        else if (current !== null && line.startsWith('branch refs/heads/'))
            current.branch = line.slice('branch refs/heads/'.length);
        else if (current !== null && line.startsWith('HEAD '))
            current.head = line.slice('HEAD '.length);
        else if (current !== null && line === 'bare')
            current.bare = true;
        else if (current !== null && (line === 'prunable' || line.startsWith('prunable ')))
            current.prunable = true;
    }
    for (const entry of entries)
        entry.path = await realpath(entry.path).catch(() => path.resolve(entry.path));
    return entries.filter((entry, index) => index === 0 || !entry.prunable);
}
/** The repository containing `dir`, identified by its canonical checkout inside the workspace. */
export async function repositoryCheckout(workspace, dir) {
    const root = await gitToplevel(dir);
    if (root === null)
        return null;
    const worktrees = await listWorktrees(root);
    const main = worktrees[0];
    if (main === undefined || main.bare)
        return null;
    const relative = path.relative(workspace.root, main.path);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative))
        return null;
    if (await findNestedWorkspaceConfig(workspace.root, main.path))
        return null;
    const current = worktrees.find((entry) => entry.path === root);
    return { root, canonical: main.path, repositoryPath: toPosix(relative), branch: current?.branch ?? null };
}
/** Removes registrations of worktrees whose directory is gone, so their branches can be checked out again. */
export async function pruneWorktrees(dir) {
    await git(['worktree', 'prune'], dir);
}
export function worktreesRoot(workspace) {
    return path.join(workspace.root, WORKTREES_FOLDER);
}
/** Last segment of an initiative ID, used to name its worktrees and default branches. */
export function initiativeName(id) {
    return id.split('/').at(-1);
}
export function standardWorktreePath(workspace, repositoryPath, initiativeId) {
    return path.join(worktreesRoot(workspace), ...repositoryPath.split('/'), initiativeName(initiativeId));
}
export function checkoutKind(workspace, canonical, checkout) {
    if (checkout === canonical)
        return 'canonical';
    const relative = path.relative(worktreesRoot(workspace), checkout);
    if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative))
        return 'grind';
    if (APP_WORKTREE_SEGMENTS.some((segment) => `${checkout}${path.sep}`.includes(segment)))
        return 'app';
    return 'other';
}
/** Where `branch` of the repository at `canonical` is checked out. */
export async function locateBranch(workspace, canonical, branch) {
    const entry = (await listWorktrees(canonical)).find((item) => item.branch === branch);
    if (entry === undefined)
        return { path: null, kind: null };
    return { path: entry.path, kind: checkoutKind(workspace, canonical, entry.path) };
}
async function gitPathExists(checkout, name) {
    const location = await git(['rev-parse', '--git-path', name], checkout);
    if (!location.ok)
        return false;
    return lstat(path.resolve(checkout, location.stdout.trim())).then(() => true, () => false);
}
/** Name of the merge, rebase, or similar operation in progress in `checkout`, or null. */
export async function inProgressOperation(checkout) {
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
        if (await gitPathExists(checkout, marker))
            return marker;
    }
    return null;
}
async function lines(dir, args) {
    const result = await git(args, dir);
    return result.ok ? result.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}
/** The remote whose default branch new branches start from. */
export async function defaultRemote(dir) {
    const remotes = await lines(dir, ['remote']);
    if (remotes.includes('origin'))
        return 'origin';
    return remotes.length === 1 ? remotes[0] : null;
}
/**
 * How to obtain `branch`: the local branch, a remote branch of the same name, or a new
 * branch from the remote's default branch, or from local main or master when there is no
 * remote. Callers fetch first when they want fresh refs.
 */
export async function branchSource(dir, branch) {
    if ((await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], dir)).ok)
        return { origin: 'local', base: null, track: false };
    const remote = await defaultRemote(dir);
    if (remote === null) {
        if ((await lines(dir, ['remote'])).length === 0) {
            for (const candidate of ['main', 'master']) {
                if ((await git(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], dir)).ok)
                    return { origin: 'local-default', base: candidate, track: false };
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
function creation(branch, source) {
    return source.base === null ? [] : [source.track ? '--track' : '--no-track', '-b', branch];
}
export function worktreeAddArgs(target, branch, source) {
    return ['worktree', 'add', ...creation(branch, source), target, source.base ?? branch];
}
export function checkoutArgs(branch, source) {
    return ['checkout', ...creation(branch, source), source.base ?? branch];
}
/** Fetches the default remote; returns a warning instead of failing when offline. */
export async function fetchDefaultRemote(dir) {
    const remote = await defaultRemote(dir);
    if (remote === null)
        return null;
    const result = await git(['fetch', '--quiet', remote], dir);
    return result.ok ? null : `git fetch ${remote} failed; using local refs: ${result.stderr.trim()}`;
}
/**
 * Mirrors instruction files of the folders between the workspace root and the canonical
 * checkout under the worktree root, so worktrees receive the same directory-scoped instructions.
 */
export async function ensureInstructionLinks(workspace, canonical) {
    const results = [];
    const folders = pathsBelow(workspace.root, path.dirname(canonical)).reverse();
    for (const folder of folders) {
        const relative = path.relative(workspace.root, folder);
        for (const name of INSTRUCTION_FILES) {
            const target = path.join(folder, name);
            if (!(await pathExists(target)))
                continue;
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
//# sourceMappingURL=checkouts.js.map