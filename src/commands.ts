import { readInitiative } from './artifacts.ts';
import { listInitiatives } from './discovery.ts';
import { GrindError, type Diagnostic } from './errors.ts';
import { inspectInitiative, type InitiativeInspection } from './inspect.ts';
import { planStart, type StartPlan } from './lifecycle.ts';
import type { LedgerState } from './ledger.ts';
import { resolveInitiative, type Resolution } from './resolve.ts';
import type { Workspace } from './workspace.ts';
import { assertNoPendingOperation, pendingOperationSummaries, type PendingOperationSummary } from './operations.ts';

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
  pendingOperations: PendingOperationSummary[];
}

export async function statusCommand(context: CommandContext, identifier?: string): Promise<StatusResult> {
  const resolution = await resolveInitiative({ workspace: context.workspace, cwd: context.cwd, ...(identifier === undefined ? {} : { identifier }) });
  const inspection = await inspectInitiative(context.workspace, resolution.initiative);
  const pendingOperations = (await pendingOperationSummaries(context.workspace)).filter(
    (operation) => operation.target === inspection.id,
  );
  inspection.diagnostics.unshift(...resolution.diagnostics);
  return {
    resolution: { source: resolution.source, stalePointer: resolution.stalePointer, checkout: resolution.checkout?.root ?? null },
    inspection,
    pendingOperations,
  };
}

export interface StartResult extends StatusResult {
  /** Always false in this increment: no checkout was switched and nothing was reopened. */
  switched: false;
  pendingNotes: number;
  plan: StartPlan;
}

/** Enters an open initiative whose checkouts already sit on their recorded branches. */
export async function startCommand(context: CommandContext, identifier?: string): Promise<StartResult> {
  const status = await statusCommand(context, identifier);
  const { inspection } = status;
  await assertNoPendingOperation(context.workspace);
  if (inspection.archived) {
    throw new GrindError('TRANSITION_UNSUPPORTED', `${inspection.id} is archived and read-only; start a new initiative instead`, { initiative: inspection.id });
  }
  if (inspection.state?.status === 'closed') {
    throw new GrindError('TRANSITION_UNSUPPORTED', `${inspection.id} is closed; reopening is not supported in this increment`, { initiative: inspection.id });
  }
  const plan = await planStart(context.workspace, inspection);
  const blockers = plan.blockers;
  if (blockers.length > 0) {
    const needsSwitch = inspection.repositories.some((r) => r.observed.repository && !r.onRecordedBranch);
    throw new GrindError(
      needsSwitch ? 'TRANSITION_UNSUPPORTED' : 'START_BLOCKED',
      needsSwitch
        ? `${inspection.id} needs a checkout switch, which this increment does not perform: ${blockers.join('; ')}`
        : `${inspection.id} cannot be started: ${blockers.join('; ')}`,
      { initiative: inspection.id, blockers, plan, diagnostics: inspection.diagnostics.filter((d) => d.severity === 'error') },
    );
  }
  const pendingNotes = inspection.repositories.reduce((sum, r) => sum + (r.observed.sidecar?.pendingNotes ?? 0), 0);
  const needsSwitch = plan.checkouts.some((checkout) => checkout.action === 'switch');
  if (needsSwitch) {
    throw new GrindError('TRANSITION_UNSUPPORTED', `${inspection.id} has a valid switch plan, but checkout execution is delivered in increment 2c`, {
      initiative: inspection.id,
      blockers: plan.checkouts.filter((checkout) => checkout.action === 'switch').map(
        (checkout) => `${checkout.repository} is on ${checkout.sourceBranch}, not ${checkout.targetBranch}`,
      ),
      plan,
    });
  }
  return { ...status, switched: false, pendingNotes, plan };
}
