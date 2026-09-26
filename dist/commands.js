import { readInitiative } from './artifacts.js';
import { listInitiatives } from './discovery.js';
import { GrindError } from './errors.js';
import { inspectInitiative } from './inspect.js';
import { planStart } from './lifecycle.js';
import { resolveInitiative } from './resolve.js';
import { pendingOperationSummaries, readPendingOperations } from './operations.js';
import { beginStartSwitch, repairStartPointers, resumeStartSwitch } from './switching.js';
import { assertReopenable, inspectArchiveEligibility, reopenPreparedInitiative } from './lifecycle-commands.js';
import { isContainedRelativePath, toPosix } from './paths.js';
/** Unarchived initiatives with their recorded resume information; malformed ones stay listed. */
export async function listCommand(context, options = {}) {
    const listing = await listInitiatives(context.workspace.initiativesDir);
    const scope = options.scope === undefined ? null : normalizeListScope(options.scope);
    const initiatives = [];
    for (const entry of listing.entries) {
        if (entry.archived)
            continue;
        if (scope !== null && entry.id !== scope && !entry.id.startsWith(`${scope}/`))
            continue;
        const record = await readInitiative(entry.dir, { workspace: context.workspace });
        const state = record.ledgerState?.state ?? null;
        if (options.status !== undefined && state?.status !== options.status)
            continue;
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
function normalizeListScope(scope) {
    const normalized = toPosix(scope).replace(/\/+$/, '');
    if (!isContainedRelativePath(normalized)) {
        throw new GrindError('PATH_ESCAPE', `Scope "${scope}" must be a path relative to initiatives/`, { scope });
    }
    return normalized;
}
export async function statusCommand(context, identifier) {
    const resolution = await resolveInitiative({ workspace: context.workspace, cwd: context.cwd, ...(identifier === undefined ? {} : { identifier }) });
    const inspection = await inspectInitiative(context.workspace, resolution.initiative);
    const pendingOperations = (await pendingOperationSummaries(context.workspace)).filter((operation) => operation.target === inspection.id || `_archive/${operation.target}` === inspection.id);
    const archiveEligibility = await inspectArchiveEligibility(context.workspace, inspection);
    inspection.diagnostics.unshift(...resolution.diagnostics);
    return {
        resolution: { source: resolution.source, stalePointer: resolution.stalePointer, checkout: resolution.checkout?.root ?? null },
        inspection,
        pendingOperations,
        archiveEligibility,
    };
}
/** Enters an open initiative whose checkouts already sit on their recorded branches. */
export async function startCommand(context, identifier) {
    const status = await statusCommand(context, identifier);
    const { inspection } = status;
    if (inspection.archived) {
        throw new GrindError('TRANSITION_UNSUPPORTED', `${inspection.id} is archived and read-only; start a new initiative instead`, { initiative: inspection.id });
    }
    await assertReopenable(inspection);
    const pending = await readPendingOperations(context.workspace);
    if (pending.length > 0) {
        if (pending.length !== 1 || pending[0]?.target !== inspection.id) {
            throw new GrindError('OPERATION_PENDING', `Another lifecycle operation must be reconciled before starting ${inspection.id}`, {
                operations: pending.map(({ path: file, ...operation }) => ({ ...operation, path: file })),
            });
        }
        if (pending[0].kind === 'reopen') {
            await reopenPreparedInitiative(context.workspace, inspection);
            const refreshed = await statusCommand(context, inspection.id);
            const plan = await planStart(context.workspace, refreshed.inspection);
            const pendingNotes = refreshed.inspection.repositories.reduce((sum, repository) => sum + (repository.observed.sidecar?.pendingNotes ?? 0), 0);
            return { ...refreshed, switched: false, switchedRepositories: [], noteTransfers: [], dependencyChanges: [], pendingNotes, plan };
        }
        if (pending[0].kind !== 'start')
            throw new GrindError('OPERATION_PENDING', `Pending ${pending[0].kind} operation must be resumed with its original command`);
        const execution = await resumeStartSwitch(context.workspace, inspection, pending[0]);
        if (inspection.state?.status === 'closed') {
            const prepared = await statusCommand(context, inspection.id);
            await reopenPreparedInitiative(context.workspace, prepared.inspection);
        }
        const refreshed = await statusCommand(context, inspection.id);
        const pendingNotes = refreshed.inspection.repositories.reduce((sum, repository) => sum + (repository.observed.sidecar?.pendingNotes ?? 0), 0);
        return { ...refreshed, switched: execution.switchedRepositories.length > 0, switchedRepositories: execution.switchedRepositories, noteTransfers: execution.noteTransfers, dependencyChanges: execution.dependencyChanges, pendingNotes, plan: execution.plan };
    }
    const plan = await planStart(context.workspace, inspection);
    const blockers = plan.blockers;
    if (blockers.length > 0) {
        throw new GrindError('START_BLOCKED', `${inspection.id} cannot be started: ${blockers.join('; ')}`, { initiative: inspection.id, blockers, plan, diagnostics: inspection.diagnostics.filter((d) => d.severity === 'error') });
    }
    const pendingNotes = inspection.repositories.reduce((sum, r) => sum + (r.observed.sidecar?.pendingNotes ?? 0), 0);
    const needsSwitch = plan.checkouts.some((checkout) => checkout.action === 'switch');
    if (needsSwitch) {
        const execution = await beginStartSwitch(context.workspace, inspection, plan);
        if (inspection.state?.status === 'closed') {
            const prepared = await statusCommand(context, inspection.id);
            await reopenPreparedInitiative(context.workspace, prepared.inspection);
        }
        const refreshed = await statusCommand(context, inspection.id);
        const refreshedPendingNotes = refreshed.inspection.repositories.reduce((sum, repository) => sum + (repository.observed.sidecar?.pendingNotes ?? 0), 0);
        return { ...refreshed, switched: true, switchedRepositories: execution.switchedRepositories, noteTransfers: execution.noteTransfers, dependencyChanges: execution.dependencyChanges, pendingNotes: refreshedPendingNotes, plan: execution.plan };
    }
    await repairStartPointers(context.workspace, inspection);
    if (inspection.state?.status === 'closed')
        await reopenPreparedInitiative(context.workspace, inspection);
    const refreshed = await statusCommand(context, inspection.id);
    return { ...refreshed, switched: false, switchedRepositories: [], noteTransfers: [], dependencyChanges: [], pendingNotes, plan };
}
//# sourceMappingURL=commands.js.map