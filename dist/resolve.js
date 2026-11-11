import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.js';
import { repositoryCheckout } from './checkouts.js';
import { isInitiativeRoot, isArchivedId, listInitiatives } from './discovery.js';
import { GrindError } from './errors.js';
import { gitToplevel } from './git.js';
import { isContainedRelativePath, normalizeRepositoryPath, resolveWithin, toPosix } from './paths.js';
/**
 * Selects the initiative for a command: an explicit identifier, then the
 * enclosing initiative folder, then the open initiative owning the checkout's branch.
 */
export async function resolveInitiative(options) {
    const { workspace } = options;
    if (options.identifier !== undefined) {
        return {
            initiative: await resolveIdentifierOrFragment(workspace, options.identifier),
            source: 'argument',
            checkout: null,
            diagnostics: [],
        };
    }
    const cwd = await realpath(options.cwd);
    const fromFolder = await resolveFromFolder(workspace, cwd);
    if (fromFolder) {
        return { initiative: fromFolder, source: 'folder', checkout: null, diagnostics: [] };
    }
    return resolveFromCheckout(workspace, cwd);
}
/** Resolves a full ID, or else a fragment matching exactly one unarchived initiative. */
export async function resolveIdentifierOrFragment(workspace, identifier) {
    try {
        return await resolveIdentifier(workspace, identifier);
    }
    catch (error) {
        if (!(error instanceof GrindError) || error.code !== 'INITIATIVE_NOT_FOUND')
            throw error;
        const fragment = toPosix(identifier).replace(/\/+$/, '');
        const entries = (await listInitiatives(workspace.initiativesDir)).entries.filter((entry) => !entry.archived);
        const suffix = entries.filter((entry) => entry.id.endsWith(`/${fragment}`));
        const candidates = suffix.length > 0 ? suffix : entries.filter((entry) => entry.id.includes(fragment));
        if (candidates.length === 1)
            return candidates[0];
        if (candidates.length > 1) {
            throw new GrindError('INITIATIVE_AMBIGUOUS', `"${identifier}" matches several initiatives: ${candidates.map((entry) => entry.id).join(', ')}`, {
                identifier,
                candidates: candidates.map((entry) => entry.id),
            });
        }
        throw error;
    }
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
/** The initiative whose folder contains `cwd`, or null. */
export async function resolveFromFolder(workspace, cwd) {
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
    if (await gitToplevel(cwd) === null) {
        throw new GrindError('INITIATIVE_UNRESOLVED', `${cwd} is neither an initiative folder nor a Git checkout`, { cwd });
    }
    const checkout = await repositoryCheckout(workspace, cwd);
    if (checkout === null) {
        throw new GrindError('INITIATIVE_UNRESOLVED', `${cwd} is not in a repository inside workspace ${workspace.root}`, { cwd });
    }
    if (checkout.branch === null) {
        throw new GrindError('INITIATIVE_UNRESOLVED', `Checkout ${checkout.root} has a detached HEAD; no branch identifies an initiative`, {
            checkout: checkout.root,
        });
    }
    const owners = await branchOwners(workspace, checkout.repositoryPath, checkout.branch);
    if (owners.length === 1) {
        return { initiative: owners[0], source: 'branch', checkout, diagnostics: [] };
    }
    if (owners.length > 1) {
        throw new GrindError('INITIATIVE_AMBIGUOUS', `Branch ${checkout.branch} of ${checkout.repositoryPath} is tracked by several initiatives: ${owners.map((o) => o.id).join(', ')}`, {
            candidates: owners.map((o) => o.id),
        });
    }
    throw new GrindError('INITIATIVE_UNRESOLVED', `No open initiative tracks ${checkout.repositoryPath} on branch ${checkout.branch}`, {
        checkout: checkout.root,
        branch: checkout.branch,
    });
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
export function tracksPath(repository, repositoryPath) {
    return normalizeRepositoryPath(repository.path) === normalizeRepositoryPath(repositoryPath);
}
//# sourceMappingURL=resolve.js.map