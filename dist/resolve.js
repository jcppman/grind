import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.js';
import { isInitiativeRoot, isArchivedId, listInitiatives } from './discovery.js';
import { diagnostic, GrindError } from './errors.js';
import { gitCurrentBranch, gitToplevel } from './git.js';
import { isContainedRelativePath, normalizeRepositoryPath, resolveWithin, toPosix } from './paths.js';
import { readSidecar } from './sidecar.js';
import { findNestedWorkspaceConfig } from './workspace.js';
/**
 * Selects the initiative for a command: an explicit identifier, then the
 * enclosing initiative folder, then the checkout's verified sidecar or branch.
 */
export async function resolveInitiative(options) {
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
export async function resolveIdentifier(workspace, identifier) {
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
        if (await isInitiativeRoot(ancestor))
            throw new GrindError('ARTIFACT_INVALID', `Initiative ${normalized} is nested beneath ${ancestor}`);
        ancestor = path.dirname(ancestor);
    }
    return { id: normalized, dir, archived: isArchivedId(normalized) };
}
async function resolveFromFolder(workspace, cwd) {
    const initiativesDir = await realpath(workspace.initiativesDir).catch(() => null);
    if (initiativesDir === null)
        return null;
    const relative = path.relative(initiativesDir, cwd);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative))
        return null;
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
async function resolveFromCheckout(workspace, cwd) {
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
    const checkout = {
        root: checkoutRoot,
        repositoryPath: toPosix(relative),
        branch: await gitCurrentBranch(checkoutRoot),
        sidecar: await readSidecar(checkoutRoot),
    };
    const diagnostics = [...(checkout.sidecar?.diagnostics ?? [])];
    if (checkout.branch === null) {
        throw new GrindError('INITIATIVE_UNRESOLVED', `Checkout ${checkoutRoot} has a detached HEAD; no branch identifies an initiative`, {
            checkout: checkoutRoot,
        });
    }
    const pointed = checkout.sidecar?.initiative ?? null;
    let stalePointer = null;
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
        return { initiative: owners[0], source: 'branch', checkout, stalePointer, diagnostics };
    }
    if (owners.length > 1) {
        throw new GrindError('INITIATIVE_AMBIGUOUS', `Branch ${checkout.branch} of ${checkout.repositoryPath} is tracked by several initiatives: ${owners.map((o) => o.id).join(', ')}`, {
            candidates: owners.map((o) => o.id),
            stalePointer,
        });
    }
    throw new GrindError('INITIATIVE_UNRESOLVED', `No open initiative tracks ${checkout.repositoryPath} on branch ${checkout.branch}`, {
        checkout: checkoutRoot,
        branch: checkout.branch,
        stalePointer,
    });
}
async function verifyPointer(workspace, pointed, checkout) {
    let entry;
    try {
        entry = await resolveIdentifier(workspace, pointed);
    }
    catch (error) {
        return { entry: null, reason: error.message };
    }
    const record = await readInitiative(entry.dir, { workspace });
    const state = record.ledgerState?.state ?? null;
    if (state === null)
        return { entry: null, reason: 'its ledger state is unreadable' };
    const tracked = state.repositories.some((r) => tracksPath(r, checkout.repositoryPath) && r.branch === checkout.branch);
    return tracked
        ? { entry, reason: '' }
        : { entry: null, reason: `its ledger does not track ${checkout.repositoryPath} on branch ${checkout.branch}` };
}
/** Open, unarchived initiatives tracking this repository and branch. */
export async function branchOwners(workspace, repositoryPath, branch) {
    const owners = [];
    const listing = await listInitiatives(workspace.initiativesDir);
    for (const entry of listing.entries) {
        if (entry.archived)
            continue;
        const record = await readInitiative(entry.dir, { workspace });
        if (record.ledgerState?.state?.status !== 'open')
            continue;
        const repositories = record.ledgerState.state.repositories;
        if (repositories.some((r) => tracksPath(r, repositoryPath) && r.branch === branch)) {
            owners.push(entry);
        }
    }
    return owners;
}
function tracksPath(repository, repositoryPath) {
    return normalizeRepositoryPath(repository.path) === repositoryPath ||
        (repository.checkout !== 'clone' && normalizeRepositoryPath(repository.checkout) === repositoryPath);
}
//# sourceMappingURL=resolve.js.map