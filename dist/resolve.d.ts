import { type RepositoryCheckout } from './checkouts.ts';
import { type InitiativeEntry } from './discovery.ts';
import { type Diagnostic } from './errors.ts';
import type { Workspace } from './workspace.ts';
export type ResolutionSource = 'argument' | 'folder' | 'branch';
export interface Resolution {
    initiative: InitiativeEntry;
    source: ResolutionSource;
    checkout: RepositoryCheckout | null;
    diagnostics: Diagnostic[];
}
export interface ResolveOptions {
    workspace: Workspace;
    cwd: string;
    identifier?: string;
}
/**
 * Selects the initiative for a command: an explicit identifier, then the
 * enclosing initiative folder, then the open initiative owning the checkout's branch.
 */
export declare function resolveInitiative(options: ResolveOptions): Promise<Resolution>;
/** Resolves a full ID, or else a fragment matching exactly one unarchived initiative. */
export declare function resolveIdentifierOrFragment(workspace: Workspace, identifier: string): Promise<InitiativeEntry>;
export declare function resolveIdentifier(workspace: Workspace, identifier: string): Promise<InitiativeEntry>;
/** The initiative whose folder contains `cwd`, or null. */
export declare function resolveFromFolder(workspace: Workspace, cwd: string): Promise<InitiativeEntry | null>;
/** Open, unarchived initiatives tracking this repository and branch. */
export declare function branchOwners(workspace: Workspace, repositoryPath: string, branch: string): Promise<InitiativeEntry[]>;
export declare function tracksPath(repository: {
    path: string;
}, repositoryPath: string): boolean;
