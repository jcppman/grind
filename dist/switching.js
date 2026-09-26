import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.js';
import { git, gitChangedFiles, gitCurrentBranch } from './git.js';
import { inspectInitiative } from './inspect.js';
import { planStart, withLockedStartPlan } from './lifecycle.js';
import { parkCheckoutNotes, restoreCheckoutNotes } from './notes.js';
import { deleteOperation, atomicWriteFile, newStartOperation, readPendingOperations, updateOperationCheckout, withLifecycleLocks, writeOperation, } from './operations.js';
import { isContainedRelativePath, toPosix } from './paths.js';
import { branchOwners, resolveIdentifier } from './resolve.js';
import { renderSidecar } from './sidecar.js';
import { parseSidecar } from './sidecar.js';
const DEPENDENCY_FILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock'];
function noteCount(payload) {
    return payload === undefined || payload === '' ? 0 : parseSidecar(payload, 'note-payload').notes.length;
}
async function dependencyChanges(checkout) {
    const result = await git(['diff', '--name-only', checkout.sourceBranch, checkout.targetBranch, '--', ...DEPENDENCY_FILES], checkout.checkout);
    if (!result.ok)
        return [];
    return result.stdout.split('\n').filter(Boolean).map((file) => `${checkout.repository}:${file}`);
}
async function checkedGit(cwd, ...args) {
    const result = await git(args, cwd);
    if (!result.ok)
        throw new GrindError('GIT_ERROR', result.stderr.trim() || `git ${args[0]} failed`, { cwd, args });
    return result.stdout;
}
async function fetchAll(checkout) {
    const remotes = (await checkedGit(checkout, 'remote')).split('\n').filter(Boolean);
    for (const remote of remotes)
        await checkedGit(checkout, 'fetch', remote);
}
async function sidecarIsExcluded(checkout) {
    return (await git(['check-ignore', '--quiet', '.grind.md'], checkout)).ok;
}
async function ensureSidecarExcluded(checkout) {
    if ((await git(['ls-files', '--error-unmatch', '--', '.grind.md'], checkout)).ok) {
        throw new GrindError('START_BLOCKED', `${checkout} tracks .grind.md; untrack it before starting`);
    }
    if (await sidecarIsExcluded(checkout))
        return;
    const exclude = path.resolve(checkout, (await checkedGit(checkout, 'rev-parse', '--git-path', 'info/exclude')).trim());
    try {
        const existing = await readFile(exclude, 'utf8').catch((error) => {
            if (error.code === 'ENOENT')
                return '';
            throw error;
        });
        if (!existing.split(/\r?\n/).includes('/.grind.md')) {
            await mkdir(path.dirname(exclude), { recursive: true });
            await appendFile(exclude, `${existing !== '' && !existing.endsWith('\n') ? '\n' : ''}/.grind.md\n`);
        }
    }
    catch (error) {
        throw new GrindError('START_BLOCKED', `Cannot configure ${exclude}: ${error.message}`);
    }
    if (!(await sidecarIsExcluded(checkout))) {
        throw new GrindError('START_BLOCKED', `${checkout} still does not exclude .grind.md; check for overriding ignore rules`);
    }
}
async function remoteTarget(checkout, branch) {
    const refs = (await checkedGit(checkout, 'for-each-ref', '--format=%(refname:short)', `refs/remotes/*/${branch}`))
        .split('\n')
        .filter(Boolean);
    if (refs.length !== 1)
        throw new GrindError('START_BLOCKED', `Expected one remote branch for ${branch}, found ${refs.length}`, { refs });
    return refs[0];
}
async function remoteDefault(checkout) {
    const remotes = (await checkedGit(checkout, 'remote')).split('\n').filter(Boolean);
    if (remotes.length !== 1)
        throw new GrindError('START_BLOCKED', `Expected one remote to create a branch, found ${remotes.length}`);
    const remote = remotes[0];
    const result = await git(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], checkout);
    if (!result.ok || result.stdout.trim() === '')
        throw new GrindError('START_BLOCKED', `${remote} has no default-branch ref`);
    return result.stdout.trim();
}
async function checkoutTarget(checkout) {
    const current = await gitCurrentBranch(checkout.checkout);
    if (current === checkout.targetBranch)
        return;
    if (current !== checkout.sourceBranch) {
        throw new GrindError('START_BLOCKED', `${checkout.repository} moved to ${current}; expected ${checkout.sourceBranch}`);
    }
    const changes = ((await gitChangedFiles(checkout.checkout)) ?? []).filter((line) => !line.endsWith(' .grind.md'));
    if (changes.length > 0)
        throw new GrindError('START_BLOCKED', `${checkout.repository} changed after preflight`, { changes });
    if (checkout.targetSource === 'local') {
        await checkedGit(checkout.checkout, 'checkout', checkout.targetBranch);
    }
    else if (checkout.targetSource === 'remote') {
        await checkedGit(checkout.checkout, 'checkout', '--track', '-b', checkout.targetBranch, await remoteTarget(checkout.checkout, checkout.targetBranch));
    }
    else if (checkout.targetSource === 'remote-default') {
        await checkedGit(checkout.checkout, 'checkout', '-b', checkout.targetBranch, await remoteDefault(checkout.checkout));
    }
    else {
        throw new GrindError('OPERATION_INVALID', `${checkout.repository} has no usable target source`);
    }
    if (await gitCurrentBranch(checkout.checkout) !== checkout.targetBranch) {
        throw new GrindError('GIT_ERROR', `${checkout.repository} did not reach ${checkout.targetBranch}`);
    }
}
async function sourceInitiative(workspace, repository, branch) {
    const owners = await branchOwners(workspace, repository, branch);
    if (owners.length > 1)
        throw new GrindError('INITIATIVE_AMBIGUOUS', `${repository} ${branch} has several owners`, { owners: owners.map((owner) => owner.id) });
    return owners[0]?.id ?? null;
}
async function commitState(workspace, operation, ledgerPaths) {
    const root = workspace.stateGitRoot;
    const allowed = new Set(ledgerPaths.map((file) => toPosix(path.relative(root, file))));
    if ([...allowed].some((file) => !isContainedRelativePath(file)))
        throw new GrindError('PATH_ESCAPE', 'Lifecycle ledger lies outside the state repository');
    const staged = (await checkedGit(root, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean);
    if (staged.some((file) => !allowed.has(file))) {
        throw new GrindError('INDEX_NOT_CLEAN', 'State repository contains unrelated staged changes', { staged });
    }
    if (staged.length === 0) {
        await checkedGit(root, 'add', '-A', '--', ...[...allowed].map((file) => `:(literal)${file}`));
    }
    const nextStaged = (await checkedGit(root, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean);
    if (nextStaged.length === 0)
        return;
    const result = await git(['commit', '-m', `grind: switch to ${operation.target}`], root);
    if (!result.ok)
        throw new GrindError('COMMIT_FAILED', 'Lifecycle state commit failed; staged changes and operation journal are preserved', { stderr: result.stderr });
}
async function executeOperation(workspace, inspection, operation, plan) {
    let current = operation;
    const ledgers = new Set([path.join(inspection.dir, 'ledger.md')]);
    const switchedRepositories = [];
    const noteTransfers = [];
    const changedDependencies = [];
    for (const checkout of current.checkouts)
        await ensureSidecarExcluded(checkout.checkout);
    for (let index = 0; index < current.checkouts.length; index += 1) {
        let checkout = current.checkouts[index];
        let sourceLedger = null;
        if (checkout.sourceInitiative !== null && checkout.sourceInitiative !== undefined) {
            const source = await resolveIdentifier(workspace, checkout.sourceInitiative);
            sourceLedger = path.join(source.dir, 'ledger.md');
            ledgers.add(sourceLedger);
        }
        if (checkout.switchState === 'planned') {
            if (sourceLedger !== null) {
                current = await parkCheckoutNotes(workspace, current, index, sourceLedger);
            }
            else {
                current = updateOperationCheckout(current, index, { notePayload: '', noteState: 'removed' }, `notes:${checkout.repository}:removed`);
                await writeOperation(workspace, current);
            }
            current = updateOperationCheckout(current, index, { switchState: 'notes-parked' }, `switch:${checkout.repository}:notes-parked`);
            await writeOperation(workspace, current);
            checkout = current.checkouts[index];
        }
        if (checkout.switchState === 'notes-parked') {
            current = updateOperationCheckout(current, index, { switchState: 'checkout-planned' }, `switch:${checkout.repository}:checkout-planned`);
            await writeOperation(workspace, current);
            checkout = current.checkouts[index];
        }
        if (checkout.switchState === 'checkout-planned') {
            await checkoutTarget(checkout);
            current = updateOperationCheckout(current, index, { switchState: 'checked-out' }, `switch:${checkout.repository}:checked-out`);
            await writeOperation(workspace, current);
            checkout = current.checkouts[index];
            switchedRepositories.push(checkout.repository);
        }
        else if (await gitCurrentBranch(checkout.checkout) === checkout.targetBranch) {
            switchedRepositories.push(checkout.repository);
        }
        if (checkout.switchState === 'checked-out') {
            current = await restoreCheckoutNotes(workspace, current, index, path.join(inspection.dir, 'ledger.md'), inspection.id);
            current = updateOperationCheckout(current, index, { switchState: 'notes-restored' }, `switch:${checkout.repository}:notes-restored`);
            await writeOperation(workspace, current);
        }
        checkout = current.checkouts[index];
        noteTransfers.push({
            repository: checkout.repository,
            parked: noteCount(checkout.notePayload),
            restored: (checkout.restoreBatches ?? []).reduce((sum, batch) => sum + noteCount(batch.payload), 0),
        });
        changedDependencies.push(...await dependencyChanges(checkout));
    }
    current = { ...current, updatedAt: new Date().toISOString(), step: 'state:commit-planned' };
    await writeOperation(workspace, current);
    await commitState(workspace, current, [...ledgers]);
    current = { ...current, updatedAt: new Date().toISOString(), step: 'complete' };
    await writeOperation(workspace, current);
    await deleteOperation(workspace, current.id);
    return {
        plan,
        switchedRepositories: [...new Set(switchedRepositories)],
        noteTransfers,
        dependencyChanges: [...new Set(changedDependencies)],
    };
}
export async function beginStartSwitch(workspace, inspection, _initialPlan) {
    return withLockedStartPlan(workspace, inspection, `start-${process.pid}`, async (lockedPlan) => {
        const switching = lockedPlan.checkouts.filter((checkout) => checkout.action === 'switch');
        let operation = newStartOperation(inspection.id, switching.map((checkout) => ({
            repository: checkout.repository,
            checkout: checkout.checkout,
            sourceBranch: checkout.sourceBranch,
            targetBranch: checkout.targetBranch,
            targetSource: checkout.targetSource,
            switchState: 'planned',
        })));
        await writeOperation(workspace, operation);
        try {
            for (const checkout of operation.checkouts)
                await fetchAll(checkout.checkout);
            const refreshed = await inspectInitiative(workspace, { id: inspection.id, dir: inspection.dir, archived: inspection.archived });
            const fetchedPlan = await planStart(workspace, refreshed);
            if (fetchedPlan.blockers.length > 0)
                throw new GrindError('START_BLOCKED', `${inspection.id} is blocked after fetch`, { blockers: fetchedPlan.blockers });
            const byRepository = new Map(fetchedPlan.checkouts.map((checkout) => [checkout.repository, checkout]));
            for (let index = 0; index < operation.checkouts.length; index += 1) {
                const checkout = operation.checkouts[index];
                const fetched = byRepository.get(checkout.repository);
                if (fetched === undefined || fetched.targetSource === 'current' || fetched.targetSource === 'unknown') {
                    throw new GrindError('START_BLOCKED', `Cannot determine target source for ${checkout.repository}`);
                }
                operation = updateOperationCheckout(operation, index, {
                    targetSource: fetched.targetSource,
                    sourceInitiative: await sourceInitiative(workspace, checkout.repository, checkout.sourceBranch),
                }, `switch:${checkout.repository}:planned`);
            }
            await writeOperation(workspace, operation);
            return await executeOperation(workspace, inspection, operation, fetchedPlan);
        }
        catch (error) {
            const persisted = (await readPendingOperations(workspace)).find((pending) => pending.id === operation.id);
            if (persisted?.checkouts.every((checkout) => checkout.switchState === 'planned' && checkout.noteState === undefined)) {
                await deleteOperation(workspace, operation.id);
            }
            throw error;
        }
    });
}
export async function resumeStartSwitch(workspace, inspection, operation) {
    return withLifecycleLocks(workspace, operation.checkouts.map((checkout) => checkout.checkout), operation.id, async () => {
        const plan = await planStart(workspace, inspection);
        return executeOperation(workspace, inspection, operation, plan);
    });
}
export async function repairStartPointers(workspace, inspection) {
    const repositories = inspection.repositories.filter((repository) => repository.observed.repository);
    await withLifecycleLocks(workspace, repositories.map((repository) => repository.observed.path), `pointers-${process.pid}`, async () => {
        const refreshed = await inspectInitiative(workspace, { id: inspection.id, dir: inspection.dir, archived: inspection.archived });
        const plan = await planStart(workspace, refreshed);
        if (plan.blockers.length > 0) {
            throw new GrindError('START_BLOCKED', `${inspection.id} cannot repair pointers`, { blockers: plan.blockers });
        }
        for (const repository of refreshed.repositories) {
            if (!repository.onRecordedBranch)
                throw new GrindError('START_BLOCKED', `${repository.recorded.path} changed before pointer repair`);
            await ensureSidecarExcluded(repository.observed.path);
            if (repository.observed.sidecar?.verified)
                continue;
            const sidecarPath = path.join(repository.observed.path, '.grind.md');
            const raw = await readFile(sidecarPath, 'utf8').catch((error) => {
                if (error.code === 'ENOENT')
                    return '';
                throw error;
            });
            await atomicWriteFile(sidecarPath, renderSidecar(raw, inspection.id));
        }
    });
}
//# sourceMappingURL=switching.js.map