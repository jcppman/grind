import { lstat, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.ts';
import type { CommandContext } from './commands.ts';
import { GrindError } from './errors.ts';
import { git } from './git.ts';
import { inspectInitiative, type InitiativeInspection } from './inspect.ts';
import { readNotes } from './notes.ts';
import {
  deleteOperation,
  newLifecycleOperation,
  readPendingOperations,
  updateOperation,
  withLifecycleLocks,
  writeOperation,
  atomicWriteFile,
  type OperationRecord,
} from './operations.ts';
import { toPosix } from './paths.ts';
import { resolveIdentifier, resolveInitiative } from './resolve.ts';
import { closeLedger, type CloseInput } from './transitions.ts';
import { checkedGit, validateForWrite } from './writes.ts';
import type { Workspace } from './workspace.ts';

export interface CloseOptions {
  outcome: CloseInput['outcome'];
  result: string;
  notes: 'handled' | 'parked';
  date?: string;
}

export interface ArchiveEligibility {
  eligible: boolean;
  closedDays: number | null;
  blockers: string[];
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
  const pendingNotes = (await readNotes(inspection.dir)).length;
  if (options.notes === 'handled' && pendingNotes > 0) {
    throw new GrindError('PENDING_NOTES', `${pendingNotes} unresolved note(s) remain in notes.md; handle them or use --notes parked`);
  }
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GrindError('USAGE', '--date must be YYYY-MM-DD');
  const operation = newLifecycleOperation('close', inspection.id, { outcome: options.outcome, result: options.result, notes: options.notes, date });
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
  return withLifecycleLocks(workspace, [], operation.id, async () => {
    const file = ledgerPath(inspection);
    const raw = await readFile(file, 'utf8');
    if (inspection.state?.status === 'open') {
      await atomicWriteFile(file, closeLedger(raw, {
        outcome: details['outcome'] as CloseInput['outcome'], result: details['result'] as string, date: details['date'] as string, updatedAt: new Date().toISOString(),
      }));
    } else if (inspection.state?.status !== 'closed') {
      throw new GrindError('OPERATION_INVALID', `Cannot reconcile closure for ${operation.target}`);
    }
    await writeOperation(workspace, updateOperation(operation, 'ledger-closed'));
    const commit = await commitScoped(workspace, [inspection.dir], `Close ${operation.target}`);
    await deleteOperation(workspace, operation.id);
    return { id: operation.target, status: 'closed' as const, commit, notes: details['notes'] };
  });
}

export async function inspectArchiveEligibility(workspace: Workspace, inspection: InitiativeInspection): Promise<ArchiveEligibility> {
  const blockers: string[] = [];
  let closedDays: number | null = null;
  if (inspection.archived) blockers.push('initiative is already archived');
  if (inspection.state?.status !== 'closed' || inspection.state.closed === null) {
    blockers.push('initiative is not closed');
  } else {
    const closedAt = Date.parse(`${inspection.state.closed.date}T00:00:00Z`);
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (Number.isFinite(closedAt)) closedDays = Math.floor((todayUtc - closedAt) / 86_400_000);
    if (closedDays === null || closedDays <= 60) blockers.push('initiative has not been closed for more than 60 days');
  }
  blockers.push(...inspection.diagnostics.filter((item) => item.severity === 'error').map((item) => item.message));
  const pending = (await readPendingOperations(workspace)).filter((operation) => operation.target === inspection.id);
  if (pending.length > 0) blockers.push('a lifecycle operation is pending');
  if ((await readNotes(inspection.dir)).length > 0) blockers.push('unresolved notes remain in notes.md');
  for (const repository of inspection.repositories) {
    if (repository.observed.path !== null) blockers.push(`${repository.recorded.branch} is checked out at ${repository.observed.path}`);
  }
  return { eligible: blockers.length === 0, closedDays, blockers: [...new Set(blockers)] };
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
  const eligibility = await inspectArchiveEligibility(context.workspace, inspection);
  if (!eligibility.eligible) throw new GrindError('ARCHIVE_BLOCKED', `${inspection.id} is not eligible for archival: ${eligibility.blockers.join('; ')}`, eligibility);
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
