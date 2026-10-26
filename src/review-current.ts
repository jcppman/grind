import { readInitiative } from './artifacts.ts';
import { GrindError } from './errors.ts';
import { resolveIdentifier, resolveInitiative, type ResolutionSource } from './resolve.ts';
import type { ReviewAssociation, SessionRegistration } from './review-store.ts';
import { loadWorkspace, type Workspace } from './workspace.ts';

export type CurrentInit =
  | {
      state: 'resolved';
      workspace: string;
      initiative: string;
      /** `explicit` when the session was bound to the init; otherwise how the resolver found it. */
      source: 'explicit' | ResolutionSource;
      status: string | null;
      phase: string | null;
      currentTask: string | null;
    }
  | { state: 'none'; workspace: string | null; reason: string }
  | { state: 'ambiguous'; workspace: string; candidates: string[]; reason: string }
  | { state: 'unavailable'; workspace: string | null; reason: string; code: string };

/**
 * The init a session concerns: its explicit binding, else what the folder or
 * branch resolver finds for its cwd. Read-only; never guesses among owners.
 */
export async function currentInit(cwd: string, options: { workspace?: string; binding?: SessionRegistration['binding'] } = {}): Promise<CurrentInit> {
  let workspace: Workspace;
  try {
    workspace = await loadWorkspace({ cwd, ...(options.binding ? { workspace: options.binding.workspace } : options.workspace === undefined ? {} : { workspace: options.workspace }) });
  } catch (error) {
    if (error instanceof GrindError && error.code === 'WORKSPACE_NOT_FOUND') return { state: 'none', workspace: null, reason: 'Not in a Grind workspace' };
    return unavailable(null, error);
  }
  try {
    const resolution = options.binding
      ? { initiative: await resolveIdentifier(workspace, options.binding.initiative), source: 'explicit' as const }
      : await resolveInitiative({ workspace, cwd });
    const state = (await readInitiative(resolution.initiative.dir, { workspace })).ledgerState?.state ?? null;
    return {
      state: 'resolved',
      workspace: workspace.root,
      initiative: resolution.initiative.id,
      source: resolution.source,
      status: state?.status ?? null,
      phase: state?.phase ?? null,
      currentTask: state?.current_task ?? null,
    };
  } catch (error) {
    if (error instanceof GrindError && error.code === 'INITIATIVE_UNRESOLVED') return { state: 'none', workspace: workspace.root, reason: error.message };
    if (error instanceof GrindError && error.code === 'INITIATIVE_AMBIGUOUS') {
      const candidates = (error.details as { candidates?: string[] } | undefined)?.candidates ?? [];
      return { state: 'ambiguous', workspace: workspace.root, candidates, reason: error.message };
    }
    return unavailable(workspace.root, error);
  }
}

function unavailable(workspace: string | null, error: unknown): CurrentInit {
  return { state: 'unavailable', workspace, reason: (error as Error).message, code: error instanceof GrindError ? error.code : 'ERROR' };
}

/** The association a new draft takes from the session's current init. */
export function associationFor(current: CurrentInit): ReviewAssociation {
  if (current.state === 'resolved') {
    return { workspace: current.workspace, initiative: current.initiative, source: current.source === 'explicit' ? 'explicit' : 'inferred' };
  }
  return { workspace: current.workspace, initiative: null, source: 'none' };
}
