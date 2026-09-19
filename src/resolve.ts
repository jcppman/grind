import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.ts';
import { isInitiativeRoot, isArchivedId, listInitiatives, type InitiativeEntry } from './discovery.ts';
import { diagnostic, GrindError, type Diagnostic } from './errors.ts';
import { gitCurrentBranch, gitToplevel } from './git.ts';
import { isContainedRelativePath, normalizeRepositoryPath, resolveWithin, toPosix } from './paths.ts';
import { readSidecar, type Sidecar } from './sidecar.ts';
import { findNestedWorkspaceConfig, type Workspace } from './workspace.ts';

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
  stalePointer: { pointed: string; reason: string } | null;
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
export async function resolveInitiative(options: ResolveOptions): Promise<Resolution> {
  const { workspace } = options;
  if (options.identifier !== undefined) {
    return {
      initiative: await resolveIdentifier(workspace, options.identifier),
      source: 'argument',
      checkout: null,
      stalePointer: null,
      diagnostics: [],
    };
  }
  const cwd = await realpath(options.cwd);
  const fromFolder = await resolveFromFolder(workspace, cwd);
  if (fromFolder) {
    return { initiative: fromFolder, source: 'folder', checkout: null, stalePointer: null, diagnostics: [] };
  }
  return resolveFromCheckout(workspace, cwd);
}

export async function resolveIdentifier(
  workspace: Workspace,
  identifier: string,
): Promise<InitiativeEntry> {
  const normalized = toPosix(identifier).replace(/\/+$/, '');
  if (!isContainedRelativePath(normalized)) {
    throw new GrindError('PATH_ESCAPE', `Initiative "${identifier}" must be a path relative to initiatives/`, {
      identifier,
    });
  }
  const dir = await resolveWithin(workspace.initiativesDir, normalized);
  const initiativesDir = await realpath(workspace.initiativesDir);
  const lexical = path.join(initiativesDir, ...normalized.split('/'));
  if (dir !== lexical) {
    throw new GrindError('PATH_ESCAPE', `Initiative "${identifier}" passes through a symbolic link; links are not allowed beneath initiatives/`, {
      identifier,
      resolved: dir,
    });
  }
  if (!(await isInitiativeRoot(dir))) {
    throw new GrindError('INITIATIVE_NOT_FOUND', `No initiative at initiatives/${normalized} (intent.md must declare grind.root: true)`, {
      identifier: normalized,
    });
  }
  let ancestor = path.dirname(dir);
  while (ancestor !== initiativesDir) {
    if (await isInitiativeRoot(ancestor)) throw new GrindError('ARTIFACT_INVALID', `Initiative ${normalized} is nested beneath ${ancestor}`);
    ancestor = path.dirname(ancestor);
  }
  return { id: normalized, dir, archived: isArchivedId(normalized) };
}

async function resolveFromFolder(workspace: Workspace, cwd: string): Promise<InitiativeEntry | null> {
  const initiativesDir = await realpath(workspace.initiativesDir).catch(() => null);
  if (initiativesDir === null) return null;
  const relative = path.relative(initiativesDir, cwd);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  let current = cwd;
  while (current !== initiativesDir) {
    if (await isInitiativeRoot(current)) {
      const id = toPosix(path.relative(initiativesDir, current));
      return resolveIdentifier(workspace, id);
    }
    current = path.dirname(current);
  }
  return null;
}

async function resolveFromCheckout(workspace: Workspace, cwd: string): Promise<Resolution> {
  const checkoutRoot = await gitToplevel(cwd);
  if (checkoutRoot === null) {
    throw new GrindError('INITIATIVE_UNRESOLVED', `${cwd} is neither an initiative folder nor a Git checkout`, { cwd });
  }
  const relative = path.relative(workspace.root, checkoutRoot);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new GrindError('INITIATIVE_UNRESOLVED', `Checkout ${checkoutRoot} is not a repository inside workspace ${workspace.root}`, {
      checkout: checkoutRoot,
    });
  }
  const nested = await findNestedWorkspaceConfig(workspace.root, checkoutRoot);
  if (nested !== null) {
    throw new GrindError('INITIATIVE_UNRESOLVED', `Checkout ${checkoutRoot} belongs to the nested workspace at ${path.dirname(nested)}`, {
      checkout: checkoutRoot,
      nestedWorkspace: path.dirname(nested),
    });
  }
  const checkout: CheckoutContext = {
    root: checkoutRoot,
    repositoryPath: toPosix(relative),
    branch: await gitCurrentBranch(checkoutRoot),
    sidecar: await readSidecar(checkoutRoot),
  };
  const diagnostics: Diagnostic[] = [...(checkout.sidecar?.diagnostics ?? [])];
  if (checkout.branch === null) {
    throw new GrindError('INITIATIVE_UNRESOLVED', `Checkout ${checkoutRoot} has a detached HEAD; no branch identifies an initiative`, {
      checkout: checkoutRoot,
    });
  }

  const pointed = checkout.sidecar?.initiative ?? null;
  let stalePointer: Resolution['stalePointer'] = null;
  if (pointed !== null) {
    const verified = await verifyPointer(workspace, pointed, checkout);
    if (verified.entry) {
      return { initiative: verified.entry, source: 'sidecar', checkout, stalePointer: null, diagnostics };
    }
    stalePointer = { pointed, reason: verified.reason };
    diagnostics.push(diagnostic('warning', 'STALE_POINTER', `Sidecar points at ${pointed} but ${verified.reason}`, checkout.sidecar?.path));
  }

  const owners = await branchOwners(workspace, checkout.repositoryPath, checkout.branch);
  if (owners.length === 1) {
    return { initiative: owners[0] as InitiativeEntry, source: 'branch', checkout, stalePointer, diagnostics };
  }
  if (owners.length > 1) {
    throw new GrindError('INITIATIVE_AMBIGUOUS', `Branch ${checkout.branch} of ${checkout.repositoryPath} is tracked by several initiatives: ${owners.map((o) => o.id).join(', ')}`, {
      candidates: owners.map((o) => o.id),
      stalePointer,
    });
  }
  throw new GrindError('INITIATIVE_UNRESOLVED', `No unarchived initiative tracks ${checkout.repositoryPath} on branch ${checkout.branch}`, {
    checkout: checkoutRoot,
    branch: checkout.branch,
    stalePointer,
  });
}

async function verifyPointer(
  workspace: Workspace,
  pointed: string,
  checkout: CheckoutContext,
): Promise<{ entry: InitiativeEntry | null; reason: string }> {
  let entry: InitiativeEntry;
  try {
    entry = await resolveIdentifier(workspace, pointed);
  } catch (error) {
    return { entry: null, reason: (error as Error).message };
  }
  const record = await readInitiative(entry.dir, { workspace });
  const state = record.ledgerState?.state ?? null;
  if (state === null) return { entry: null, reason: 'its ledger state is unreadable' };
  const tracked = state.repositories.some(
    (r) => normalizeRepositoryPath(r.path) === checkout.repositoryPath && r.branch === checkout.branch,
  );
  return tracked
    ? { entry, reason: '' }
    : { entry: null, reason: `its ledger does not track ${checkout.repositoryPath} on branch ${checkout.branch}` };
}

/** Unarchived initiatives whose ledgers track this repository on this branch. */
export async function branchOwners(
  workspace: Workspace,
  repositoryPath: string,
  branch: string,
): Promise<InitiativeEntry[]> {
  const owners: InitiativeEntry[] = [];
  const listing = await listInitiatives(workspace.initiativesDir);
  for (const entry of listing.entries) {
    if (entry.archived) continue;
    const record = await readInitiative(entry.dir, { workspace });
    const repositories = record.ledgerState?.state?.repositories ?? [];
    if (repositories.some((r) => normalizeRepositoryPath(r.path) === repositoryPath && r.branch === branch)) {
      owners.push(entry);
    }
  }
  return owners;
}
