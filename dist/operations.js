import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GrindError } from './errors.js';
import { gitCommonDir } from './git.js';
async function operationsDir(workspace) {
    const common = await gitCommonDir(workspace.stateGitRoot);
    if (common === null)
        throw new GrindError('GIT_ERROR', `${workspace.stateGitRoot} is not a Git repository`);
    return path.join(common, 'grind-operations');
}
function parseOperation(value, file) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new GrindError('OPERATION_INVALID', `Operation journal ${file} must contain an object`, { path: file });
    }
    const record = value;
    if (record['version'] !== 1 ||
        typeof record['id'] !== 'string' ||
        !['start', 'close', 'reopen', 'archive'].includes(record['kind']) ||
        typeof record['target'] !== 'string' ||
        typeof record['createdAt'] !== 'string' ||
        typeof record['updatedAt'] !== 'string' ||
        typeof record['step'] !== 'string' ||
        (record['details'] !== undefined && !isStringRecord(record['details'])) ||
        !Array.isArray(record['checkouts']) ||
        !record['checkouts'].every(isOperationCheckout)) {
        throw new GrindError('OPERATION_INVALID', `Operation journal ${file} has an unsupported shape`, { path: file });
    }
    return {
        version: 1,
        id: record['id'],
        kind: record['kind'],
        target: record['target'],
        createdAt: record['createdAt'],
        updatedAt: record['updatedAt'],
        step: record['step'],
        checkouts: record['checkouts'],
        ...(isStringRecord(record['details']) ? { details: record['details'] } : {}),
    };
}
function isStringRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string');
}
function isOperationCheckout(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const checkout = value;
    const required = ['repository', 'checkout', 'sourceBranch', 'targetBranch'].every((key) => typeof checkout[key] === 'string' && checkout[key].trim() !== '');
    if (!required)
        return false;
    if (checkout['sourceInitiative'] !== undefined && checkout['sourceInitiative'] !== null && typeof checkout['sourceInitiative'] !== 'string')
        return false;
    if (checkout['notePayload'] !== undefined && typeof checkout['notePayload'] !== 'string')
        return false;
    if (checkout['noteState'] !== undefined && !['captured', 'parked', 'removed'].includes(checkout['noteState']))
        return false;
    if (checkout['restoreState'] !== undefined && !['captured', 'copied', 'removed', 'complete'].includes(checkout['restoreState']))
        return false;
    if (checkout['targetSource'] !== undefined && !['local', 'remote', 'remote-default'].includes(checkout['targetSource']))
        return false;
    if (checkout['switchState'] !== undefined && !['planned', 'notes-parked', 'checkout-planned', 'checked-out', 'notes-restored'].includes(checkout['switchState']))
        return false;
    if (checkout['restoreBatches'] !== undefined && (!Array.isArray(checkout['restoreBatches']) || !checkout['restoreBatches'].every((batch) => {
        if (typeof batch !== 'object' || batch === null || Array.isArray(batch))
            return false;
        const item = batch;
        return typeof item['operationId'] === 'string' && typeof item['payload'] === 'string';
    })))
        return false;
    return true;
}
export async function readPendingOperations(workspace) {
    const dir = await operationsDir(workspace);
    const names = await readdir(dir).catch((error) => {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    });
    const operations = [];
    for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
        const file = path.join(dir, name);
        let parsed;
        try {
            parsed = JSON.parse(await readFile(file, 'utf8'));
        }
        catch (error) {
            throw new GrindError('OPERATION_INVALID', `Cannot read operation journal ${file}: ${error.message}`, { path: file });
        }
        operations.push({ ...parseOperation(parsed, file), path: file });
    }
    return operations;
}
export async function pendingOperationSummaries(workspace) {
    return (await readPendingOperations(workspace)).map(({ id, kind, target, step, path: file }) => ({
        id,
        kind,
        target,
        step,
        path: file,
    }));
}
export async function assertNoPendingOperation(workspace, initiative) {
    const pending = await readPendingOperations(workspace);
    const blocking = initiative === undefined ? pending : pending.filter((operation) => operation.target === initiative);
    if (blocking.length > 0) {
        throw new GrindError('OPERATION_PENDING', `A lifecycle operation is pending for ${blocking.map((operation) => operation.target).join(', ')}; resume it with grind start before changing initiative state`, { operations: blocking.map(({ path: file, ...operation }) => ({ ...operation, path: file })) });
    }
}
export function newStartOperation(target, checkouts) {
    const now = new Date().toISOString();
    return {
        version: 1,
        id: randomUUID(),
        kind: 'start',
        target,
        createdAt: now,
        updatedAt: now,
        step: 'planned',
        checkouts,
    };
}
export function newLifecycleOperation(kind, target, details, checkouts = []) {
    const now = new Date().toISOString();
    return { version: 1, id: randomUUID(), kind, target, createdAt: now, updatedAt: now, step: 'planned', checkouts, details };
}
export function updateOperation(operation, step) {
    return { ...operation, updatedAt: new Date().toISOString(), step };
}
export async function writeOperation(workspace, operation) {
    const dir = await operationsDir(workspace);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${operation.id}.json`);
    const temp = path.join(dir, `.${operation.id}.${process.pid}.tmp`);
    await writeFile(temp, `${JSON.stringify(operation, null, 2)}\n`, { flag: 'wx' });
    try {
        await rename(temp, file);
    }
    catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
    return file;
}
export function updateOperationCheckout(operation, checkoutIndex, update, step) {
    const current = operation.checkouts[checkoutIndex];
    if (current === undefined)
        throw new GrindError('OPERATION_INVALID', `Operation has no checkout at index ${checkoutIndex}`);
    const checkouts = operation.checkouts.map((checkout, index) => index === checkoutIndex ? { ...checkout, ...update } : checkout);
    return { ...operation, updatedAt: new Date().toISOString(), step, checkouts };
}
export async function deleteOperation(workspace, operationId) {
    const dir = await operationsDir(workspace);
    await rm(path.join(dir, `${operationId}.json`), { force: true });
}
export async function atomicWriteFile(file, content) {
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temp, content, { flag: 'wx' });
    try {
        await rename(temp, file);
    }
    catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}
async function acquireLock(lock, code, operationId) {
    try {
        await mkdir(lock);
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        const owner = await readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => 'Owner information unavailable');
        throw new GrindError(code, `Cooperative lock is held at ${lock}. Verify its owner is no longer running before removing it.`, { lock, owner });
    }
    const owner = { operationId, pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString() };
    try {
        await writeFile(path.join(lock, 'owner.json'), `${JSON.stringify(owner)}\n`);
    }
    catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
    }
    return () => rm(lock, { recursive: true });
}
export async function withLifecycleLocks(workspace, repositoryRoots, operationId, action) {
    const stateCommon = await gitCommonDir(workspace.stateGitRoot);
    if (stateCommon === null)
        throw new GrindError('GIT_ERROR', `${workspace.stateGitRoot} is not a Git repository`);
    const repositoryCommons = await Promise.all(repositoryRoots.map((root) => gitCommonDir(root)));
    if (repositoryCommons.some((common) => common === null)) {
        throw new GrindError('GIT_ERROR', 'Every lifecycle checkout must be a Git repository');
    }
    const locks = [...new Set(repositoryCommons.filter((common) => common !== stateCommon))]
        .sort()
        .map((common) => path.join(common, 'grind-repository.lock'));
    const releases = [];
    try {
        releases.push(await acquireLock(path.join(stateCommon, 'grind-write.lock'), 'STATE_LOCKED', operationId));
        for (const lock of locks)
            releases.push(await acquireLock(lock, 'REPOSITORY_LOCKED', operationId));
        return await action();
    }
    finally {
        for (const release of releases.reverse())
            await release();
    }
}
export async function withRepositoryLock(repositoryRoot, operationId, action) {
    const common = await gitCommonDir(repositoryRoot);
    if (common === null)
        throw new GrindError('GIT_ERROR', `${repositoryRoot} is not a Git repository`);
    const release = await acquireLock(path.join(common, 'grind-repository.lock'), 'REPOSITORY_LOCKED', operationId);
    try {
        return await action();
    }
    finally {
        await release();
    }
}
//# sourceMappingURL=operations.js.map