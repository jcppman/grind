import { lstat, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.ts';
import type { CommandContext } from './commands.ts';
import { GrindError } from './errors.ts';
import { git } from './git.ts';
import { inspectInitiative, type InitiativeInspection } from './inspect.ts';
import { listParkedNoteBatches, parkCheckoutNotes } from './notes.ts';
import {
  deleteOperation,
  newLifecycleOperation,
  readPendingOperations,
  updateOperation,
  withLifecycleLocks,
  writeOperation,
  atomicWriteFile,
  type OperationCheckout,
  type OperationRecord,
} from './operations.ts';
import { toPosix } from './paths.ts';
import { resolveInitiative } from './resolve.ts';
import { resolveIdentifier } from './resolve.ts';
import { closeLedger, reopenLedger, type CloseInput } from './transitions.ts';
import { checkedGit, validateForWrite } from './writes.ts';
import type { Workspace } from './workspace.ts';

export interface CloseOptions {
  outcome: CloseInput['outcome'];
  result: string;
  notes: 'handled' | 'parked';
  date?: string;
}

export async function assertReopenable(inspection: InitiativeInspection): Promise<void> {
  if (inspection.state?.status !== 'closed') return;
  reopenLedger(await readFile(ledgerPath(inspection), 'utf8'), new Date().toISOString());
}

function ledgerPath(inspection: InitiativeInspection): string {
  return path.join(inspection.dir, 'ledger.md');
}

async function commitScoped(workspace: Workspace, paths: string[], message: string): Promise<string | null> {
  const relative = paths.map((item) => `:(literal)${toPosix(path.relative(workspace.stateGitRoot, item))}`);
  for (let index = 0; index < paths.length; index += 1) {
    if (await lstat(paths[index] as string).catch(() => null)) await checkedGit(workspace.stateGitRoot, 'add', '-A', '--', relative[index] as string);
    else await checkedGit(workspace.stateGitRoot, 'rm', '-r', '--cached', '--ignore-unmatch', '--', relative[index] as string);
  }
  const staged = await checkedGit(workspace.stateGitRoot, 'diff', '--cached', '--name-only', '-z');
  if (!staged) return null;
  const allowed = paths.map((item) => toPosix(path.relative(workspace.stateGitRoot, item)));
  const unexpected = staged.split('\0').filter(Boolean).filter((item) => !allowed.some((scope) => item === scope || item.startsWith(`${scope}/`)));
  if (unexpected.length > 0) throw new GrindError('INDEX_NOT_CLEAN', 'State index contains changes outside this lifecycle operation', { unexpected });
  const result = await git(['commit', '-m', message], workspace.stateGitRoot);
  if (!result.ok) {
    throw new GrindError('COMMIT_FAILED', 'Lifecycle commit failed. Files and scoped staged changes are preserved; retry the same command after resolving the failure.', {
      stderr: result.stderr,
      status: await checkedGit(workspace.stateGitRoot, 'status', '--porcelain'),
    });
  }
  return (await checkedGit(workspace.stateGitRoot, 'rev-parse', 'HEAD')).trim();
}

async function assertInitialIndexClean(workspace: Workspace): Promise<void> {
  if ((await checkedGit(workspace.stateGitRoot, 'diff', '--cached', '--name-only', '-z')).length > 0) {
    throw new GrindError('INDEX_NOT_CLEAN', 'State repository has staged changes; resolve the index before changing lifecycle state');
  }
}

function operationCheckouts(inspection: InitiativeInspection): OperationCheckout[] {
  return inspection.repositories.map((repository) => ({
    repository: repository.recorded.path,
    checkout: repository.observed.path,
    sourceBranch: repository.recorded.branch,
    targetBranch: repository.recorded.branch,
    sourceInitiative: inspection.id,
  }));
}

export async function closeCommand(context: CommandContext, identifier: string | undefined, options: CloseOptions) {
  if (!options.result.trim()) throw new GrindError('USAGE', 'close requires a nonempty --result');
  const pending = await readPendingOperations(context.workspace);
  if (pending.length > 0) {
    if (pending.length !== 1 || pending[0]?.kind !== 'close' || (identifier !== undefined && pending[0].target !== identifier)) {
      throw new GrindError('OPERATION_PENDING', 'Another lifecycle operation must be reconciled first', { operations: pending });
    }
    return resumeClose(context.workspace, pending[0]);
  }
  const { initiative } = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
  const inspection = await inspectInitiative(context.workspace, initiative);
  if (inspection.archived || inspection.state?.status !== 'open') throw new GrindError('UNSUPPORTED_OPERATION', 'Only an open, unarchived initiative can be closed');
  await validateForWrite(context.workspace, initiative.dir);
  const invalid = inspection.diagnostics.filter((item) => item.severity === 'error');
  if (invalid.length > 0) throw new GrindError('ARTIFACT_INVALID', 'Repair initiative and repository records before closing', { diagnostics: invalid });
  await assertInitialIndexClean(context.workspace);
  const pendingNotes = inspection.repositories.reduce((sum, repository) => sum + (repository.observed.sidecar?.pendingNotes ?? 0), 0);
  const parkedNotes = (await readFile(ledgerPath(inspection), 'utf8')).includes('<!-- grind-note-batch:');
  if (options.notes === 'handled' && (pendingNotes > 0 || parkedNotes)) {
    throw new GrindError('PENDING_NOTES', 'Unresolved notes remain; handle them or use --notes parked');
  }
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GrindError('USAGE', '--date must be YYYY-MM-DD');
  const operation = newLifecycleOperation('close', inspection.id, { outcome: options.outcome, result: options.result, notes: options.notes, date }, operationCheckouts(inspection));
  await writeOperation(context.workspace, operation);
  return resumeClose(context.workspace, operation);
}

async function resumeClose(workspace: Workspace, operation: OperationRecord) {
  const initiative = await resolveIdentifier(workspace, operation.target);
  const inspection = await inspectInitiative(workspace, initiative);
  const details = operation.details ?? {};
  if (!['delivered', 'abandoned'].includes(details['outcome'] ?? '') || !['handled', 'parked'].includes(details['notes'] ?? '') || !details['result'] || !details['date']) {
    throw new GrindError('OPERATION_INVALID', 'Close journal lacks required transition details');
  }
  return withLifecycleLocks(workspace, operation.checkouts.map((item) => item.checkout), operation.id, async () => {
    let current = operation;
    if (details['notes'] === 'parked') {
      for (let index = 0; index < current.checkouts.length; index += 1) {
        current = await parkCheckoutNotes(workspace, current, index, ledgerPath(inspection));
      }
    }
    const file = ledgerPath(inspection);
    const raw = await readFile(file, 'utf8');
    if (inspection.state?.status === 'open') {
      await atomicWriteFile(file, closeLedger(raw, {
        outcome: details['outcome'] as CloseInput['outcome'], result: details['result'] as string, date: details['date'] as string, updatedAt: new Date().toISOString(),
      }));
    } else if (inspection.state?.status !== 'closed') {
      throw new GrindError('OPERATION_INVALID', `Cannot reconcile closure for ${operation.target}`);
    }
    current = updateOperation(current, 'ledger-closed');
    await writeOperation(workspace, current);
    const commit = await commitScoped(workspace, [inspection.dir], `Close ${operation.target}`);
    await deleteOperation(workspace, operation.id);
    return { id: operation.target, status: 'closed' as const, commit, notes: details['notes'] };
  });
}

export async function reopenPreparedInitiative(workspace: Workspace, inspection: InitiativeInspection) {
  const pending = await readPendingOperations(workspace);
  let operation: OperationRecord;
  if (pending.length > 0) {
    if (pending.length !== 1 || pending[0]?.kind !== 'reopen' || pending[0].target !== inspection.id) {
      throw new GrindError('OPERATION_PENDING', 'Another lifecycle operation must be reconciled first', { operations: pending });
    }
    operation = pending[0];
  } else {
    await assertInitialIndexClean(workspace);
    operation = newLifecycleOperation('reopen', inspection.id, {});
    await writeOperation(workspace, operation);
  }
  return withLifecycleLocks(workspace, [], operation.id, async () => {
    const refreshed = await inspectInitiative(workspace, { id: inspection.id, dir: inspection.dir, archived: false });
    const file = ledgerPath(refreshed);
    if (refreshed.state?.status === 'closed') {
      await atomicWriteFile(file, reopenLedger(await readFile(file, 'utf8'), new Date().toISOString()));
    } else if (refreshed.state?.status !== 'open') {
      throw new GrindError('OPERATION_INVALID', `Cannot reconcile reopening for ${inspection.id}`);
    }
    await writeOperation(workspace, updateOperation(operation, 'ledger-reopened'));
    const commit = await commitScoped(workspace, [inspection.dir], `Reopen ${inspection.id}`);
    await deleteOperation(workspace, operation.id);
    return commit;
  });
}

function checkedOutBranches(raw: string): string[] {
  return raw.split('\n').filter((line) => line.startsWith('branch refs/heads/')).map((line) => line.slice('branch refs/heads/'.length));
}

export async function archiveCommand(context: CommandContext, identifier?: string) {
  const pending = await readPendingOperations(context.workspace);
  if (pending.length > 0) {
    if (pending.length !== 1 || pending[0]?.kind !== 'archive' || (identifier !== undefined && pending[0].target !== identifier)) {
      throw new GrindError('OPERATION_PENDING', 'Another lifecycle operation must be reconciled first', { operations: pending });
    }
    return resumeArchive(context.workspace, pending[0]);
  }
  const { initiative } = await resolveInitiative({ ...context, ...(identifier === undefined ? {} : { identifier }) });
  const inspection = await inspectInitiative(context.workspace, initiative);
  if (inspection.archived || inspection.state?.status !== 'closed' || inspection.state.closed === null) {
    throw new GrindError('ARCHIVE_BLOCKED', 'Only a closed, unarchived initiative can be archived');
  }
  const closedAt = Date.parse(`${inspection.state.closed.date}T00:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (!Number.isFinite(closedAt) || (todayUtc - closedAt) / 86_400_000 <= 60) throw new GrindError('ARCHIVE_BLOCKED', `${inspection.id} has not been closed for more than 60 days`);
  if (inspection.diagnostics.some((item) => item.severity === 'error')) throw new GrindError('ARCHIVE_BLOCKED', 'Repository or initiative state cannot be verified', { diagnostics: inspection.diagnostics });
  const raw = await readFile(ledgerPath(inspection), 'utf8');
  if (raw.includes('<!-- grind-note-batch:')) throw new GrindError('ARCHIVE_BLOCKED', 'Unresolved parked notes remain');
  for (const repository of inspection.repositories) {
    if ((repository.observed.sidecar?.pendingNotes ?? 0) > 0 || listParkedNoteBatches(raw, repository.recorded.path).length > 0) {
      throw new GrindError('ARCHIVE_BLOCKED', `Unresolved notes remain for ${repository.recorded.path}`);
    }
    const worktrees = await git(['worktree', 'list', '--porcelain'], repository.observed.path);
    if (!worktrees.ok) throw new GrindError('ARCHIVE_BLOCKED', `Cannot inspect linked worktrees for ${repository.recorded.path}`);
    if (checkedOutBranches(worktrees.stdout).includes(repository.recorded.branch)) {
      throw new GrindError('ARCHIVE_BLOCKED', `${repository.recorded.branch} is checked out in a linked worktree`, { repository: repository.recorded.path });
    }
  }
  await assertInitialIndexClean(context.workspace);
  const destination = path.join(context.workspace.initiativesDir, '_archive', ...inspection.id.split('/'));
  if (await lstat(destination).catch(() => null)) throw new GrindError('ARCHIVE_BLOCKED', `Archive destination already exists: ${destination}`);
  const operation = newLifecycleOperation('archive', inspection.id, { source: inspection.dir, destination });
  await writeOperation(context.workspace, operation);
  return resumeArchive(context.workspace, operation);
}

async function resumeArchive(workspace: Workspace, operation: OperationRecord) {
  const source = operation.details?.['source'];
  const destination = operation.details?.['destination'];
  if (source === undefined || destination === undefined) throw new GrindError('OPERATION_INVALID', 'Archive journal lacks source or destination');
  return withLifecycleLocks(workspace, [], operation.id, async () => {
    const sourceExists = await lstat(source).catch(() => null);
    const destinationExists = await lstat(destination).catch(() => null);
    if (sourceExists && destinationExists) throw new GrindError('ARCHIVE_BLOCKED', `Archive destination already exists: ${destination}`);
    if (sourceExists) {
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(source, destination);
    }
    else if (!destinationExists) throw new GrindError('OPERATION_INVALID', 'Neither archive source nor destination exists');
    await writeOperation(workspace, updateOperation(operation, 'moved'));
    const commit = await commitScoped(workspace, [source, destination], `Archive ${operation.target}`);
    await deleteOperation(workspace, operation.id);
    return { id: operation.target, archivedId: `_archive/${operation.target}`, dir: destination, commit };
  });
}
