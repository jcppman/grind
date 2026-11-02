import { readInitiative } from './artifacts.ts';
import { GrindError } from './errors.ts';
import { resolveIdentifier } from './resolve.ts';
import type { BindingSetter, ReviewAssociation, SessionRegistration } from './review-store.ts';
import { loadWorkspace, type Workspace } from './workspace.ts';

export type CurrentInit =
  | {
      state: 'resolved';
      workspace: string;
      initiative: string;
      setBy: BindingSetter;
      status: string | null;
      phase: string | null;
      currentTask: string | null;
    }
  | { state: 'none'; workspace: string | null; reason: string }
  | { state: 'unavailable'; workspace: string | null; reason: string; code: string };

/**
 * The init a session concerns: only what the agent or the person set with
 * `review bind`. The cwd locates the workspace and never selects an init.
 */
export async function currentInit(cwd: string, options: { workspace?: string; binding?: SessionRegistration['binding'] } = {}): Promise<CurrentInit> {
  let workspace: Workspace;
  try {
    workspace = await loadWorkspace({ cwd, ...(options.binding ? { workspace: options.binding.workspace } : options.workspace === undefined ? {} : { workspace: options.workspace }) });
  } catch (error) {
    if (error instanceof GrindError && error.code === 'WORKSPACE_NOT_FOUND') return { state: 'none', workspace: null, reason: 'Not in a Grind workspace' };
    return unavailable(null, error);
  }
  if (!options.binding) return { state: 'none', workspace: workspace.root, reason: 'No init is set for this session' };
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
  } catch (error) {
    return unavailable(workspace.root, error);
  }
}

function unavailable(workspace: string | null, error: unknown): CurrentInit {
  return { state: 'unavailable', workspace, reason: (error as Error).message, code: error instanceof GrindError ? error.code : 'ERROR' };
}

/** The association a new draft takes from the session's current init. */
export function associationFor(current: CurrentInit): ReviewAssociation {
  if (current.state === 'resolved') {
    return { workspace: current.workspace, initiative: current.initiative, source: 'explicit' };
  }
  return { workspace: current.workspace, initiative: null, source: 'none' };
}
