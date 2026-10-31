import type { BindingSetter, ReviewAssociation, SessionRegistration } from './review-store.ts';
export type CurrentInit = {
    state: 'resolved';
    workspace: string;
    initiative: string;
    setBy: BindingSetter;
    status: string | null;
    phase: string | null;
    currentTask: string | null;
} | {
    state: 'none';
    workspace: string | null;
    reason: string;
} | {
    state: 'unavailable';
    workspace: string | null;
    reason: string;
    code: string;
};
/**
 * The init a session concerns: only what the agent or the person set with
 * `review bind`. The cwd locates the workspace and never selects an init.
 */
export declare function currentInit(cwd: string, options?: {
    workspace?: string;
    binding?: SessionRegistration['binding'];
}): Promise<CurrentInit>;
/** The association a new draft takes from the session's current init. */
export declare function associationFor(current: CurrentInit): ReviewAssociation;
