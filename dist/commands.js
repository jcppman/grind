import { readRoadmaps } from './roadmaps.js';
import { readInitiative } from './artifacts.js';
import { listInitiatives } from './discovery.js';
import { GrindError } from './errors.js';
import { realpath } from 'node:fs/promises';
import { gitToplevel } from './git.js';
import { inspectInitiative } from './inspect.js';
import { resolveFromFolder, resolveInitiative } from './resolve.js';
import { pendingOperationSummaries } from './operations.js';
import { inspectArchiveEligibility } from './lifecycle-commands.js';
import { isContainedRelativePath, toPosix } from './paths.js';
import { repositoryStatus } from './worktree.js';
/** Unarchived initiatives with their recorded resume information; malformed ones stay listed. */
export async function listCommand(context, options = {}) {
    const listing = await listInitiatives(context.workspace.initiativesDir);
    const scope = options.scope === undefined ? null : normalizeListScope(options.scope);
    const initiatives = [];
    const roadmapCatalog = await readRoadmaps(context.workspace.stateDir);
    for (const entry of listing.entries) {
        if (entry.archived)
            continue;
        if (scope !== null && entry.id !== scope && !entry.id.startsWith(`${scope}/`))
            continue;
        const record = await readInitiative(entry.dir, { workspace: context.workspace, roadmapCatalog });
        const state = record.ledgerState?.state ?? null;
        if (options.status !== undefined && state?.status !== options.status)
            continue;
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
function normalizeListScope(scope) {
    const normalized = toPosix(scope).replace(/\/+$/, '');
    if (!isContainedRelativePath(normalized)) {
        throw new GrindError('PATH_ESCAPE', `Scope "${scope}" must be a path relative to initiatives/`, { scope });
    }
    return normalized;
}
/**
 * An initiative's recorded and observed state, or, without an identifier inside a repository,
 * the repository's owning initiative and where its other initiatives are checked out.
 */
export async function statusCommand(context, identifier) {
    if (identifier === undefined && await resolveFromFolder(context.workspace, await realpath(context.cwd)) === null && await gitToplevel(context.cwd) !== null) {
        return { kind: 'repository', ...(await repositoryStatus(context)) };
    }
    return initiativeStatus(context, identifier);
}
export async function initiativeStatus(context, identifier) {
    const resolution = await resolveInitiative({ workspace: context.workspace, cwd: context.cwd, ...(identifier === undefined ? {} : { identifier }) });
    const inspection = await inspectInitiative(context.workspace, resolution.initiative);
    const pendingOperations = (await pendingOperationSummaries(context.workspace)).filter((operation) => operation.target === inspection.id || `_archive/${operation.target}` === inspection.id);
    const archiveEligibility = await inspectArchiveEligibility(context.workspace, inspection);
    inspection.diagnostics.unshift(...resolution.diagnostics);
    return { kind: 'initiative', resolution: { source: resolution.source }, inspection, pendingOperations, archiveEligibility };
}
//# sourceMappingURL=commands.js.map