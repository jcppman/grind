import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GrindError } from './errors.ts';
import { gitCommonDir } from './git.ts';
import type { Workspace } from './workspace.ts';

export interface OperationCheckout {
  repository: string;
  checkout: string;
  sourceBranch: string;
  targetBranch: string;
  sourceInitiative?: string | null;
  notePayload?: string;
  noteState?: 'captured' | 'parked' | 'removed';
  restoreBatches?: Array<{ operationId: string; payload: string }>;
  restoreState?: 'captured' | 'copied' | 'removed' | 'complete';
}

export interface OperationRecord {
  version: 1;
  id: string;
  kind: 'start';
  target: string;
  createdAt: string;
  updatedAt: string;
  step: string;
  checkouts: OperationCheckout[];
}

export interface PendingOperationSummary {
  id: string;
  kind: OperationRecord['kind'];
  target: string;
  step: string;
  path: string;
}

async function operationsDir(workspace: Workspace): Promise<string> {
  const common = await gitCommonDir(workspace.stateGitRoot);
  if (common === null) throw new GrindError('GIT_ERROR', `${workspace.stateGitRoot} is not a Git repository`);
  return path.join(common, 'grind-operations');
}

function parseOperation(value: unknown, file: string): OperationRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GrindError('OPERATION_INVALID', `Operation journal ${file} must contain an object`, { path: file });
  }
  const record = value as Record<string, unknown>;
  if (
    record['version'] !== 1 ||
    typeof record['id'] !== 'string' ||
    record['kind'] !== 'start' ||
    typeof record['target'] !== 'string' ||
    typeof record['createdAt'] !== 'string' ||
    typeof record['updatedAt'] !== 'string' ||
    typeof record['step'] !== 'string' ||
    !Array.isArray(record['checkouts']) ||
    !record['checkouts'].every(isOperationCheckout)
  ) {
    throw new GrindError('OPERATION_INVALID', `Operation journal ${file} has an unsupported shape`, { path: file });
  }
  return {
    version: 1,
    id: record['id'] as string,
    kind: 'start',
    target: record['target'] as string,
    createdAt: record['createdAt'] as string,
    updatedAt: record['updatedAt'] as string,
    step: record['step'] as string,
    checkouts: record['checkouts'] as OperationCheckout[],
  };
}

function isOperationCheckout(value: unknown): value is OperationCheckout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const checkout = value as Record<string, unknown>;
  const required = ['repository', 'checkout', 'sourceBranch', 'targetBranch'].every(
    (key) => typeof checkout[key] === 'string' && (checkout[key] as string).trim() !== '',
  );
  if (!required) return false;
  if (checkout['sourceInitiative'] !== undefined && checkout['sourceInitiative'] !== null && typeof checkout['sourceInitiative'] !== 'string') return false;
  if (checkout['notePayload'] !== undefined && typeof checkout['notePayload'] !== 'string') return false;
  if (checkout['noteState'] !== undefined && !['captured', 'parked', 'removed'].includes(checkout['noteState'] as string)) return false;
  if (checkout['restoreState'] !== undefined && !['captured', 'copied', 'removed', 'complete'].includes(checkout['restoreState'] as string)) return false;
  if (checkout['restoreBatches'] !== undefined && (!Array.isArray(checkout['restoreBatches']) || !checkout['restoreBatches'].every((batch) => {
    if (typeof batch !== 'object' || batch === null || Array.isArray(batch)) return false;
    const item = batch as Record<string, unknown>;
    return typeof item['operationId'] === 'string' && typeof item['payload'] === 'string';
  }))) return false;
  return true;
}

export async function readPendingOperations(workspace: Workspace): Promise<Array<OperationRecord & { path: string }>> {
  const dir = await operationsDir(workspace);
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const operations: Array<OperationRecord & { path: string }> = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new GrindError('OPERATION_INVALID', `Cannot read operation journal ${file}: ${(error as Error).message}`, { path: file });
    }
    operations.push({ ...parseOperation(parsed, file), path: file });
  }
  return operations;
}

export async function pendingOperationSummaries(workspace: Workspace): Promise<PendingOperationSummary[]> {
  return (await readPendingOperations(workspace)).map(({ id, kind, target, step, path: file }) => ({
    id,
    kind,
    target,
    step,
    path: file,
  }));
}

export async function assertNoPendingOperation(workspace: Workspace, initiative?: string): Promise<void> {
  const pending = await readPendingOperations(workspace);
  const blocking = initiative === undefined ? pending : pending.filter((operation) => operation.target === initiative);
  if (blocking.length > 0) {
    throw new GrindError(
      'OPERATION_PENDING',
      `A lifecycle operation is pending for ${blocking.map((operation) => operation.target).join(', ')}; resume it with grind start before changing initiative state`,
      { operations: blocking.map(({ path: file, ...operation }) => ({ ...operation, path: file })) },
    );
  }
}

export function newStartOperation(target: string, checkouts: OperationCheckout[]): OperationRecord {
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

export async function writeOperation(workspace: Workspace, operation: OperationRecord): Promise<string> {
  const dir = await operationsDir(workspace);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${operation.id}.json`);
  const temp = path.join(dir, `.${operation.id}.${process.pid}.tmp`);
  await writeFile(temp, `${JSON.stringify(operation, null, 2)}\n`, { flag: 'wx' });
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return file;
}

export async function atomicWriteFile(file: string, content: string): Promise<void> {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temp, content, { flag: 'wx' });
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export interface LockOwner {
  operationId: string;
  pid: number;
  host: string;
  createdAt: string;
}

async function acquireLock(lock: string, code: 'STATE_LOCKED' | 'REPOSITORY_LOCKED', operationId: string): Promise<() => Promise<void>> {
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = await readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => 'Owner information unavailable');
    throw new GrindError(code, `Cooperative lock is held at ${lock}. Verify its owner is no longer running before removing it.`, { lock, owner });
  }
  const owner: LockOwner = { operationId, pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString() };
  try {
    await writeFile(path.join(lock, 'owner.json'), `${JSON.stringify(owner)}\n`);
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
  return () => rm(lock, { recursive: true });
}

export async function withLifecycleLocks<T>(
  workspace: Workspace,
  repositoryRoots: readonly string[],
  operationId: string,
  action: () => Promise<T>,
): Promise<T> {
  const stateCommon = await gitCommonDir(workspace.stateGitRoot);
  if (stateCommon === null) throw new GrindError('GIT_ERROR', `${workspace.stateGitRoot} is not a Git repository`);
  const repositoryCommons = await Promise.all(repositoryRoots.map((root) => gitCommonDir(root)));
  if (repositoryCommons.some((common) => common === null)) {
    throw new GrindError('GIT_ERROR', 'Every lifecycle checkout must be a Git repository');
  }
  const locks = [...new Set((repositoryCommons as string[]).filter((common) => common !== stateCommon))]
    .sort()
    .map((common) => path.join(common, 'grind-repository.lock'));
  const releases: Array<() => Promise<void>> = [];
  try {
    releases.push(await acquireLock(path.join(stateCommon, 'grind-write.lock'), 'STATE_LOCKED', operationId));
    for (const lock of locks) releases.push(await acquireLock(lock, 'REPOSITORY_LOCKED', operationId));
    return await action();
  } finally {
    for (const release of releases.reverse()) await release();
  }
}

export async function withRepositoryLock<T>(repositoryRoot: string, operationId: string, action: () => Promise<T>): Promise<T> {
  const common = await gitCommonDir(repositoryRoot);
  if (common === null) throw new GrindError('GIT_ERROR', `${repositoryRoot} is not a Git repository`);
  const release = await acquireLock(path.join(common, 'grind-repository.lock'), 'REPOSITORY_LOCKED', operationId);
  try {
    return await action();
  } finally {
    await release();
  }
}
