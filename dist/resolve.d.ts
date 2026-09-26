import { type InitiativeEntry } from './discovery.ts';
import { type Diagnostic } from './errors.ts';
import { type Sidecar } from './sidecar.ts';
import { type Workspace } from './workspace.ts';
export type ResolutionSource = 'argument' | 'folder' | 'sidecar' | 'branch';
export interface CheckoutContext {
    /** Real path of the checkout root. */
    root: string;
    /** Workspace-relative repository path. */
    repositoryPath: string;
    branch: string | null;
    sidecar: Sidecar | null;
}
export interface Resolution {
    initiative: InitiativeEntry;
    source: ResolutionSource;
    checkout: CheckoutContext | null;
    /** Set when the sidecar pointed somewhere Git does not confirm. */
    stalePointer: {
        pointed: string;
        reason: string;
    } | null;
    diagnostics: Diagnostic[];
}
export interface ResolveOptions {
    workspace: Workspace;
    cwd: string;
    identifier?: string;
}
/**
 * Selects the initiative for a command: an explicit identifier, then the
 * enclosing initiative folder, then the checkout's verified sidecar or branch.
 */
export declare function resolveInitiative(options: ResolveOptions): Promise<Resolution>;
export declare function resolveIdentifier(workspace: Workspace, identifier: string): Promise<InitiativeEntry>;
/** Open, unarchived initiatives tracking this repository and branch. */
export declare function branchOwners(workspace: Workspace, repositoryPath: string, branch: string): Promise<InitiativeEntry[]>;
