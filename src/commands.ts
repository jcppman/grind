import { readInitiative } from './artifacts.ts';
import { listInitiatives } from './discovery.ts';
import { GrindError, type Diagnostic } from './errors.ts';
import { inspectInitiative, startBlockers, type InitiativeInspection } from './inspect.ts';
import type { LedgerState } from './ledger.ts';
import { resolveInitiative, type Resolution } from './resolve.ts';
import type { Workspace } from './workspace.ts';

export interface CommandContext {
  workspace: Workspace;
  cwd: string;
}

export interface ListEntry {
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

/** Unarchived initiatives with their recorded resume information; malformed ones stay listed. */
export async function listCommand(context: CommandContext): Promise<ListResult> {
  const listing = await listInitiatives(context.workspace.initiativesDir);
  const initiatives: ListEntry[] = [];
  for (const entry of listing.entries) {
    if (entry.archived) continue;
    const record = await readInitiative(entry.dir, { workspace: context.workspace });
    const state = record.ledgerState?.state ?? null;
    initiatives.push({
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
  return { initiatives, diagnostics: listing.diagnostics };
}

export interface StatusResult {
  resolution: Pick<Resolution, 'source' | 'stalePointer'> & { checkout: string | null };
  inspection: InitiativeInspection;
}

export async function statusCommand(context: CommandContext, identifier?: string): Promise<StatusResult> {
  const resolution = await resolveInitiative({ workspace: context.workspace, cwd: context.cwd, ...(identifier === undefined ? {} : { identifier }) });
  const inspection = await inspectInitiative(context.workspace, resolution.initiative);
  inspection.diagnostics.unshift(...resolution.diagnostics);
  return {
    resolution: { source: resolution.source, stalePointer: resolution.stalePointer, checkout: resolution.checkout?.root ?? null },
    inspection,
  };
}

export interface StartResult extends StatusResult {
  /** Always false in this increment: no checkout was switched and nothing was reopened. */
  switched: false;
  pendingNotes: number;
}

/** Enters an open initiative whose checkouts already sit on their recorded branches. */
export async function startCommand(context: CommandContext, identifier?: string): Promise<StartResult> {
  const status = await statusCommand(context, identifier);
  const { inspection } = status;
  if (inspection.archived) {
    throw new GrindError('TRANSITION_UNSUPPORTED', `${inspection.id} is archived and read-only; start a new initiative instead`, { initiative: inspection.id });
  }
  if (inspection.state?.status === 'closed') {
    throw new GrindError('TRANSITION_UNSUPPORTED', `${inspection.id} is closed; reopening is not supported in this increment`, { initiative: inspection.id });
  }
  const blockers = startBlockers(inspection);
  if (blockers.length > 0) {
    const needsSwitch = inspection.repositories.some((r) => r.observed.repository && !r.onRecordedBranch);
    throw new GrindError(
      needsSwitch ? 'TRANSITION_UNSUPPORTED' : 'START_BLOCKED',
      needsSwitch
        ? `${inspection.id} needs a checkout switch, which this increment does not perform: ${blockers.join('; ')}`
        : `${inspection.id} cannot be started: ${blockers.join('; ')}`,
      { initiative: inspection.id, blockers, diagnostics: inspection.diagnostics.filter((d) => d.severity === 'error') },
    );
  }
  const pendingNotes = inspection.repositories.reduce((sum, r) => sum + (r.observed.sidecar?.pendingNotes ?? 0), 0);
  return { ...status, switched: false, pendingNotes };
}
