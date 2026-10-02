import { readRoadmaps, type RoadmapDocument } from './roadmaps.ts';
import { readInitiative } from './artifacts.ts';
import { listInitiatives } from './discovery.ts';
import { GrindError, type Diagnostic } from './errors.ts';
import { realpath } from 'node:fs/promises';
import { gitToplevel } from './git.ts';
import { inspectInitiative, type InitiativeInspection } from './inspect.ts';
import type { LedgerState } from './ledger.ts';
import { resolveFromFolder, resolveInitiative, type Resolution } from './resolve.ts';
import type { Workspace } from './workspace.ts';
import { pendingOperationSummaries, type PendingOperationSummary } from './operations.ts';
import { inspectArchiveEligibility, type ArchiveEligibility } from './lifecycle-commands.ts';
import { isContainedRelativePath, toPosix } from './paths.ts';
import { repositoryStatus, type RepositoryStatus } from './worktree.ts';

export interface CommandContext {
  workspace: Workspace;
  cwd: string;
}

export interface ListEntry {
  roadmap: Pick<RoadmapDocument, 'id' | 'path'> | null;
  id: string;
  dir: string;
  status: LedgerState['status'] | null;
  updated_at: string | null;
  phase: string | null;
  current_task: string | null;
  next_action: string | null;
  result: string | null;
  diagnostics: Diagnostic[];
}

export interface ListResult {
  initiatives: ListEntry[];
  diagnostics: Diagnostic[];
}

export interface ListOptions {
  scope?: string;
  status?: LedgerState['status'];
}

/** Unarchived initiatives with their recorded resume information; malformed ones stay listed. */
export async function listCommand(context: CommandContext, options: ListOptions = {}): Promise<ListResult> {
  const listing = await listInitiatives(context.workspace.initiativesDir);
  const scope = options.scope === undefined ? null : normalizeListScope(options.scope);
  const initiatives: ListEntry[] = [];
  const roadmapCatalog = await readRoadmaps(context.workspace.stateDir);
  for (const entry of listing.entries) {
    if (entry.archived) continue;
    if (scope !== null && entry.id !== scope && !entry.id.startsWith(`${scope}/`)) continue;
    const record = await readInitiative(entry.dir, { workspace: context.workspace, roadmapCatalog });
    const state = record.ledgerState?.state ?? null;
    if (options.status !== undefined && state?.status !== options.status) continue;
    initiatives.push({
      roadmap: record.roadmap ? { id: record.roadmap.id, path: record.roadmap.path } : null,
      id: entry.id,
      dir: entry.dir,
      status: state?.status ?? null,
      updated_at: state?.updated_at ?? null,
      phase: state?.phase ?? null,
      current_task: state?.current_task ?? null,
      next_action: state?.next_action ?? null,
      result: state?.result ?? null,
      diagnostics: record.diagnostics,
    });
  }
  return { initiatives, diagnostics: [...listing.diagnostics, ...roadmapCatalog.diagnostics] };
}

function normalizeListScope(scope: string): string {
  const normalized = toPosix(scope).replace(/\/+$/, '');
  if (!isContainedRelativePath(normalized)) {
    throw new GrindError('PATH_ESCAPE', `Scope "${scope}" must be a path relative to initiatives/`, { scope });
  }
  return normalized;
}

export interface InitiativeStatus {
  kind: 'initiative';
  resolution: Pick<Resolution, 'source'>;
  inspection: InitiativeInspection;
  pendingOperations: PendingOperationSummary[];
  archiveEligibility: ArchiveEligibility;
}

export type StatusResult = InitiativeStatus | ({ kind: 'repository' } & RepositoryStatus);

/**
 * An initiative's recorded and observed state, or, without an identifier inside a repository,
 * the repository's owning initiative and where its other initiatives are checked out.
 */
export async function statusCommand(context: CommandContext, identifier?: string): Promise<StatusResult> {
  if (identifier === undefined && await resolveFromFolder(context.workspace, await realpath(context.cwd)) === null && await gitToplevel(context.cwd) !== null) {
    return { kind: 'repository', ...(await repositoryStatus(context)) };
  }
  return initiativeStatus(context, identifier);
}

export async function initiativeStatus(context: CommandContext, identifier?: string): Promise<InitiativeStatus> {
  const resolution = await resolveInitiative({ workspace: context.workspace, cwd: context.cwd, ...(identifier === undefined ? {} : { identifier }) });
  const inspection = await inspectInitiative(context.workspace, resolution.initiative);
  const pendingOperations = (await pendingOperationSummaries(context.workspace)).filter(
    (operation) => operation.target === inspection.id || `_archive/${operation.target}` === inspection.id,
  );
  const archiveEligibility = await inspectArchiveEligibility(context.workspace, inspection);
  inspection.diagnostics.unshift(...resolution.diagnostics);
  return { kind: 'initiative', resolution: { source: resolution.source }, inspection, pendingOperations, archiveEligibility };
}
