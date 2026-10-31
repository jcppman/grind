import { readInitiative } from './artifacts.js';
import { GrindError } from './errors.js';
import { resolveIdentifier } from './resolve.js';
import { loadWorkspace } from './workspace.js';
/**
 * The init a session concerns: only what the agent or the person set with
 * `review bind`. The cwd locates the workspace and never selects an init.
 */
export async function currentInit(cwd, options = {}) {
    let workspace;
    try {
        workspace = await loadWorkspace({ cwd, ...(options.binding ? { workspace: options.binding.workspace } : options.workspace === undefined ? {} : { workspace: options.workspace }) });
    }
    catch (error) {
        if (error instanceof GrindError && error.code === 'WORKSPACE_NOT_FOUND')
            return { state: 'none', workspace: null, reason: 'Not in a Grind workspace' };
        return unavailable(null, error);
    }
    if (!options.binding)
        return { state: 'none', workspace: workspace.root, reason: 'No init is set for this session' };
    try {
        const initiative = await resolveIdentifier(workspace, options.binding.initiative);
        const state = (await readInitiative(initiative.dir, { workspace })).ledgerState?.state ?? null;
        return {
            state: 'resolved',
            workspace: workspace.root,
            initiative: initiative.id,
            setBy: options.binding.setBy ?? 'user',
            status: state?.status ?? null,
            phase: state?.phase ?? null,
            currentTask: state?.current_task ?? null,
        };
    }
    catch (error) {
        return unavailable(workspace.root, error);
    }
}
function unavailable(workspace, error) {
    return { state: 'unavailable', workspace, reason: error.message, code: error instanceof GrindError ? error.code : 'ERROR' };
}
/** The association a new draft takes from the session's current init. */
export function associationFor(current) {
    if (current.state === 'resolved') {
        return { workspace: current.workspace, initiative: current.initiative, source: 'explicit' };
    }
    return { workspace: current.workspace, initiative: null, source: 'none' };
}
//# sourceMappingURL=review-current.js.map