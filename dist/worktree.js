import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readInitiative } from './artifacts.js';
import { branchSource, checkoutArgs, checkoutKind, ensureInstructionLinks, fetchDefaultRemote, inProgressOperation, initiativeName, listWorktrees, locateBranch, pruneWorktrees, repositoryCheckout, standardWorktreePath, worktreeAddArgs, } from './checkouts.js';
import { listInitiatives } from './discovery.js';
import { GrindError } from './errors.js';
import { editFrontmatter } from './frontmatter.js';
import { git, gitChangedFiles } from './git.js';
import { atomicWriteFile, withLifecycleLocks } from './operations.js';
import { pathExists, toPosix } from './paths.js';
import { branchOwners, resolveIdentifierOrFragment, tracksPath } from './resolve.js';
import { checkedGit } from './writes.js';
const execFileAsync = promisify(execFile);
const RECENT_ACTIVITY_MS = 5 * 60 * 1000;
/** A user-supplied repository is tried relative to `cwd` first; recorded paths are workspace-relative. */
async function checkoutForRepository(context, repository, userSupplied) {
    const candidates = [...(userSupplied ? [path.resolve(context.cwd, repository)] : []), path.resolve(context.workspace.root, repository)];
    for (const candidate of candidates) {
        if (!(await pathExists(candidate)))
            continue;
        const checkout = await repositoryCheckout(context.workspace, candidate);
        if (checkout !== null)
            return checkout;
    }
    throw new GrindError('USAGE', `${repository} is not a Git repository inside workspace ${context.workspace.root}`, { repository });
}
/**
 * The initiative's repository entry for the selected or sole repository. A repository the
 * initiative does not track yet gets a branch named after the initiative, which the caller
 * records with `recordRepository`.
 */
async function trackedRepository(context, entry, repository) {
    if (entry.archived)
        throw new GrindError('UNSUPPORTED_OPERATION', `${entry.id} is archived and read-only`);
    const record = await readInitiative(entry.dir, { workspace: context.workspace });
    const state = record.ledgerState?.state;
    if (!state)
        throw new GrindError('ARTIFACT_INVALID', `Repair the ledger of ${entry.id} first`, { diagnostics: record.diagnostics });
    let recordedEntry;
    let checkout;
    if (repository === undefined) {
        if (state.repositories.length !== 1) {
            throw new GrindError('USAGE', state.repositories.length === 0
                ? `${entry.id} tracks no repository; pass --repo <repository>`
                : `${entry.id} tracks several repositories (${state.repositories.map((item) => item.path).join(', ')}); pass --repo <repository>`);
        }
        recordedEntry = state.repositories[0];
        checkout = await checkoutForRepository(context, recordedEntry.path, false);
    }
    else {
        checkout = await checkoutForRepository(context, repository, true);
        recordedEntry = state.repositories.find((item) => tracksPath(item, checkout.repositoryPath));
    }
    if (recordedEntry !== undefined)
        return { entry, checkout, branch: recordedEntry.branch, unrecorded: false };
    if (state.status !== 'open')
        throw new GrindError('UNSUPPORTED_OPERATION', `${entry.id} is closed; reopen it before recording a branch`);
    const branch = initiativeName(entry.id);
    const owners = (await branchOwners(context.workspace, checkout.repositoryPath, branch)).filter((owner) => owner.id !== entry.id);
    if (owners.length > 0) {
        throw new GrindError('USAGE', `Branch ${branch} of ${checkout.repositoryPath} already belongs to ${owners.map((owner) => owner.id).join(', ')}`);
    }
    return { entry, checkout, branch, unrecorded: true };
}
/** Adds the repository and branch to the ledger; the caller holds the state lock. */
async function recordRepository(tracked) {
    const ledger = path.join(tracked.entry.dir, 'ledger.md');
    const raw = await readFile(ledger, 'utf8');
    await atomicWriteFile(ledger, editFrontmatter(raw, (document) => {
        document.addIn(['grind', 'repositories'], document.createNode({ path: tracked.checkout.repositoryPath, branch: tracked.branch, pull_request: null }));
    }));
}
/** Path where the initiative's work lives, creating a worktree at the standard location if needed. */
export async function worktreeCommand(context, identifier, options = {}) {
    const entry = await resolveIdentifierOrFragment(context.workspace, identifier);
    const tracked = await trackedRepository(context, entry, options.repository);
    const { canonical, repositoryPath } = tracked.checkout;
    const fetchWarning = (await locateBranch(context.workspace, canonical, tracked.branch)).path === null ? await fetchDefaultRemote(canonical) : null;
    return withLifecycleLocks(context.workspace, [canonical], `worktree-${process.pid}`, async () => {
        if (tracked.unrecorded)
            await recordRepository(tracked);
        const instructionLinks = await ensureInstructionLinks(context.workspace, canonical);
        const warnings = blockedLinkWarnings(instructionLinks);
        if (fetchWarning !== null)
            warnings.push(fetchWarning);
        const base = { initiative: entry.id, repository: repositoryPath, branch: tracked.branch, recorded: tracked.unrecorded, instructionLinks, warnings };
        const location = await locateBranch(context.workspace, canonical, tracked.branch);
        if (location.kind === 'canonical') {
            throw new GrindError('CHECKOUT_HELD', `${tracked.branch} is checked out in the canonical checkout ${canonical}, which belongs to the user`, {
                ...base,
                path: canonical,
            });
        }
        if (location.path !== null)
            return { ...base, path: location.path, kind: location.kind, created: false, branchOrigin: null };
        const target = standardWorktreePath(context.workspace, repositoryPath, entry.id);
        if (await lstat(target).catch(() => null) && !(await isIdleWorktree(canonical, target))) {
            throw new GrindError('USAGE', `${target} already exists but does not hold ${tracked.branch}; move or remove it first`, { path: target });
        }
        const source = await branchSource(canonical, tracked.branch);
        const placed = await placeBranch(canonical, target, tracked.branch, source);
        return { ...base, path: target, kind: 'grind', created: placed === 'created', branchOrigin: source.origin };
    });
}
function blockedLinkWarnings(links) {
    return links
        .filter((link) => link.status === 'blocked')
        .map((link) => `${link.link} is not a link to ${link.target}; worktrees below it may miss those instructions`);
}
async function repositoryInitiatives(workspace, checkout) {
    const result = [];
    const worktrees = await listWorktrees(checkout.canonical);
    for (const entry of (await listInitiatives(workspace.initiativesDir)).entries) {
        if (entry.archived)
            continue;
        const state = (await readInitiative(entry.dir, { workspace })).ledgerState?.state;
        if (state?.status !== 'open')
            continue;
        for (const repository of state.repositories.filter((item) => tracksPath(item, checkout.repositoryPath))) {
            const holder = worktrees.find((item) => item.branch === repository.branch);
            result.push({
                id: entry.id,
                branch: repository.branch,
                current_task: state.current_task,
                next_action: state.next_action,
                path: holder?.path ?? null,
                kind: holder === undefined ? null : checkoutKind(workspace, checkout.canonical, holder.path),
            });
        }
    }
    return result;
}
/** The repository at `cwd`: who owns its current branch and where its other inits live. */
export async function repositoryStatus(context) {
    const checkout = await repositoryCheckout(context.workspace, context.cwd);
    if (checkout === null) {
        throw new GrindError('INITIATIVE_UNRESOLVED', `${context.cwd} is not in a repository inside workspace ${context.workspace.root}`, { cwd: context.cwd });
    }
    const initiatives = await repositoryInitiatives(context.workspace, checkout);
    const owners = initiatives.filter((item) => checkout.branch !== null && item.branch === checkout.branch);
    return {
        repository: checkout.repositoryPath,
        canonical: checkout.canonical,
        checkout: { path: checkout.root, branch: checkout.branch, kind: checkoutKind(context.workspace, checkout.canonical, checkout.root) },
        owner: owners.length === 1 ? owners[0] : null,
        owners: owners.map((item) => item.id),
        initiatives: initiatives.filter((item) => !owners.includes(item)),
    };
}
/** Other worktrees nested inside `dir`, relative to it. */
async function nestedWorktrees(dir) {
    return (await listWorktrees(dir))
        .filter((item) => item.path.startsWith(`${dir}${path.sep}`))
        .map((item) => toPosix(path.relative(dir, item.path)));
}
/** Uncommitted changes, ignoring worktrees nested inside `dir` that Git lists as untracked. */
async function uncommittedChanges(dir) {
    const nested = await nestedWorktrees(dir);
    return ((await gitChangedFiles(dir)) ?? []).filter((line) => !nested.some((item) => line === `?? ${item}/`));
}
async function stashChanges(dir, label, branch, restoreIn) {
    if ((await uncommittedChanges(dir)).length === 0)
        return null;
    const excludes = (await nestedWorktrees(dir)).map((item) => `:(exclude,literal)${item}`);
    const top = async () => (await git(['rev-parse', '--verify', '--quiet', 'refs/stash'], dir)).stdout.trim();
    const before = await top();
    await checkedGit(dir, 'stash', 'push', '--include-untracked', '--message', label, '--', '.', ...excludes);
    const commit = await top();
    // Some status entries, such as a dirty submodule, cannot be stashed; then nothing was saved.
    if (commit === before)
        return null;
    return { label, commit, branch, origin: dir, restoreIn };
}
async function restoreStash(dir, stash) {
    await checkedGit(dir, 'stash', 'apply', '--index', stash.commit);
    const index = (await checkedGit(dir, 'stash', 'list', '--format=%H')).split('\n').indexOf(stash.commit);
    if (index !== -1)
        await checkedGit(dir, 'stash', 'drop', `stash@{${index}}`);
}
/** Processes whose working directory is inside `dir`, or null when they cannot be listed. */
async function processesInside(dir) {
    if (process.platform === 'win32')
        return null;
    let stdout;
    try {
        ({ stdout } = await execFileAsync('lsof', ['-w', '-d', 'cwd', '-F', 'pn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    }
    catch (error) {
        const partial = error.stdout;
        if (!partial)
            return null;
        stdout = partial;
    }
    const pids = new Set();
    let pid = 0;
    for (const line of stdout.split('\n')) {
        if (line.startsWith('p'))
            pid = Number(line.slice(1));
        else if (line.startsWith('n')) {
            const cwd = line.slice(1);
            if (pid !== process.pid && (cwd === dir || cwd.startsWith(`${dir}${path.sep}`)))
                pids.add(pid);
        }
    }
    return [...pids];
}
/** Changed files, or HEAD moves such as commits and checkouts, newer than `windowMs` in the worktree at `dir`. */
async function recentActivity(dir, windowMs) {
    const since = Date.now() - windowMs;
    const recent = [];
    const moved = await git(['log', '--walk-reflogs', '-1', '--date=unix', '--format=%gd', 'HEAD'], dir);
    const movedAt = /\{(\d+)\}/.exec(moved.stdout)?.[1];
    if (moved.ok && movedAt !== undefined && Number(movedAt) * 1000 > since)
        recent.push('HEAD moved');
    for (const line of await uncommittedChanges(dir)) {
        const entry = line.slice(3);
        const file = entry.includes(' -> ') ? entry.slice(entry.lastIndexOf(' -> ') + 4) : entry;
        const info = await stat(path.join(dir, file)).catch(() => null);
        if (info !== null && info.mtimeMs > since)
            recent.push(file);
    }
    return recent;
}
/** Whether `dir` is a clean, detached worktree of the repository that a branch can be checked out into. */
async function isIdleWorktree(canonical, dir) {
    const worktrees = await listWorktrees(canonical);
    const index = worktrees.findIndex((item) => item.path === dir);
    return index > 0 && worktrees[index]?.branch === null && (await uncommittedChanges(dir)).length === 0;
}
/** Checks `branch` out at `dir`, reusing an idle worktree left there or adding a new one. */
async function placeBranch(canonical, dir, branch, source) {
    if (await isIdleWorktree(canonical, dir)) {
        await checkedGit(dir, ...checkoutArgs(branch, source));
        return 'reused';
    }
    await pruneWorktrees(canonical);
    await mkdir(path.dirname(dir), { recursive: true });
    await checkedGit(canonical, ...worktreeAddArgs(dir, branch, source));
    return 'created';
}
/**
 * Commands that restore each stash: in place where its branch is checked out, else back in the
 * idle checkout it came from, else at its destination.
 */
async function recoveryDetails(canonical, stashes) {
    const worktrees = await listWorktrees(canonical);
    const details = [];
    for (const stash of stashes) {
        const holder = worktrees.find((item) => item.branch === stash.branch);
        const apply = (dir) => `git -C '${dir}' stash apply --index ${stash.commit}`;
        const checkout = (dir) => [`git -C '${dir}' checkout ${stash.branch}`, apply(dir)];
        let recovery;
        if (holder !== undefined)
            recovery = [apply(holder.path)];
        else if (await isIdleWorktree(canonical, stash.origin))
            recovery = checkout(stash.origin);
        else if (await isIdleWorktree(canonical, stash.restoreIn))
            recovery = checkout(stash.restoreIn);
        else
            recovery = [`git -C '${canonical}' worktree add '${stash.restoreIn}' ${stash.branch}`, apply(stash.restoreIn)];
        details.push({ ...stash, recovery });
    }
    return details;
}
/**
 * Brings the target initiative's branch into the canonical checkout of the current repository
 * and moves the work it held to that initiative's standard worktree.
 */
export async function switchCommand(context, identifier, options = {}) {
    const here = await repositoryCheckout(context.workspace, context.cwd);
    if (here === null)
        throw new GrindError('USAGE', `${context.cwd} is not in a repository inside workspace ${context.workspace.root}`);
    const entry = await resolveIdentifierOrFragment(context.workspace, identifier);
    const tracked = await trackedRepository(context, entry, here.canonical);
    const { canonical, repositoryPath } = tracked.checkout;
    const branch = tracked.branch;
    const fetchWarning = (await locateBranch(context.workspace, canonical, branch)).path === null ? await fetchDefaultRemote(canonical) : null;
    return withLifecycleLocks(context.workspace, [canonical], `switch-${process.pid}`, async () => {
        const warnings = fetchWarning === null ? [] : [fetchWarning];
        const block = (message, details) => {
            throw new GrindError('SWITCH_BLOCKED', message, details);
        };
        const base = { initiative: entry.id, repository: repositoryPath, canonical, branch, recorded: tracked.unrecorded };
        const operation = await inProgressOperation(canonical);
        if (operation !== null)
            block(`${canonical} has a Git operation in progress (${operation}); finish or abort it first`);
        const current = (await listWorktrees(canonical))[0]?.branch ?? null;
        if (current === branch) {
            return { ...base, switched: false, previous: null, takenFrom: null, branchOrigin: null, warnings };
        }
        const dirty = (await uncommittedChanges(canonical)).length > 0;
        const owners = current === null ? [] : await branchOwners(context.workspace, repositoryPath, current);
        if (dirty && owners.length !== 1) {
            block(owners.length === 0
                ? `${canonical} has uncommitted changes on ${current ?? 'a detached HEAD'}, which no init owns; commit, stash, or discard them first`
                : `${canonical} has uncommitted changes on ${current}, which several inits own (${owners.map((owner) => owner.id).join(', ')})`);
        }
        const previousOwner = owners.length === 1 ? owners[0] : null;
        const previousPath = previousOwner === null ? null : standardWorktreePath(context.workspace, repositoryPath, previousOwner.id);
        const location = await locateBranch(context.workspace, canonical, branch);
        if (location.path !== null) {
            const busy = await processesInside(location.path);
            if (busy === null)
                warnings.push(`Could not check for processes working in ${location.path}`);
            else if (busy.length > 0)
                block(`Processes are working in ${location.path} (pids ${busy.join(', ')}); stop them before taking ${branch}`, { path: location.path, pids: busy });
            const recent = await recentActivity(location.path, options.recentActivityMs ?? RECENT_ACTIVITY_MS);
            if (recent.length > 0 && !options.force) {
                block(`${location.path} changed in the last few minutes (${recent.slice(0, 5).join(', ')}); an agent may still be working there. Force the switch to take it anyway`, { path: location.path, recent });
            }
        }
        if (previousPath !== null && previousPath !== location.path && await lstat(previousPath).catch(() => null) && !(await isIdleWorktree(canonical, previousPath))) {
            block(`${previousPath} already exists and is not an idle worktree of this repository; move or remove it so ${current} can move there`, { path: previousPath });
        }
        if (tracked.unrecorded)
            await recordRepository(tracked);
        const pending = [];
        let takenFrom = null;
        let branchOrigin = null;
        try {
            if (dirty && previousOwner !== null && current !== null) {
                const saved = await stashChanges(canonical, `grind switch: ${previousOwner.id} (${current})`, current, previousPath);
                if (saved)
                    pending.push(saved);
            }
            if (location.path !== null) {
                const saved = await stashChanges(location.path, `grind switch: ${entry.id} (${branch})`, branch, canonical);
                if (saved)
                    pending.push(saved);
                await checkedGit(location.path, 'checkout', '--detach');
                takenFrom = { path: location.path, kind: location.kind, released: 'detached' };
                await checkedGit(canonical, 'checkout', branch);
            }
            else {
                await pruneWorktrees(canonical);
                const source = await branchSource(canonical, branch);
                await checkedGit(canonical, ...checkoutArgs(branch, source));
                branchOrigin = source.origin;
            }
            const incoming = pending.find((stash) => stash.restoreIn === canonical);
            if (incoming) {
                await restoreStash(canonical, incoming);
                pending.splice(pending.indexOf(incoming), 1);
            }
            if (previousPath !== null && current !== null) {
                const placed = await placeBranch(canonical, previousPath, current, { origin: 'local', base: null, track: false });
                warnings.push(...blockedLinkWarnings(await ensureInstructionLinks(context.workspace, canonical)));
                if (placed === 'created')
                    warnings.push(`Ignored files such as dependencies, build output, and .env stayed in ${canonical}; ${previousPath} needs its own`);
                const outgoing = pending.find((stash) => stash.restoreIn === previousPath);
                if (outgoing) {
                    await restoreStash(previousPath, outgoing);
                    pending.splice(pending.indexOf(outgoing), 1);
                }
            }
        }
        catch (error) {
            const stashes = await recoveryDetails(canonical, pending);
            const saved = stashes.length === 0 ? 'No changes are waiting in a stash.' : `Saved changes remain in ${stashes.map((stash) => `"${stash.label}" (${stash.commit})`).join(', ')}; restore them with: ${stashes.flatMap((stash) => stash.recovery).join('; ')}.`;
            throw new GrindError('SWITCH_INCOMPLETE', `Switching to ${entry.id} stopped: ${error.message}. ${saved}`, { ...base, stashes });
        }
        return {
            ...base,
            switched: true,
            previous: { branch: current, initiative: previousOwner?.id ?? null, path: previousPath },
            takenFrom,
            branchOrigin,
            warnings,
        };
    });
}
//# sourceMappingURL=worktree.js.map