import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative } from './artifacts.js';
import { locateBranch, standardWorktreePath } from './checkouts.js';
import { diagnostic } from './errors.js';
import { gitChangedFiles, gitToplevel } from './git.js';
import { isDirectory, normalizeRepositoryPath } from './paths.js';
/** Recorded and observed state of one initiative, gathered without changing anything. */
export async function inspectInitiative(workspace, entry, suppliedRecord) {
    const record = suppliedRecord ?? await readInitiative(entry.dir, { workspace });
    const diagnostics = [...record.diagnostics];
    const artifacts = summarizeArtifacts(record);
    const state = record.ledgerState?.state ?? null;
    const repositories = [];
    for (const recorded of state?.repositories ?? []) {
        repositories.push(await inspectRepository(workspace, entry, recorded, diagnostics));
    }
    return {
        id: entry.id,
        dir: entry.dir,
        archived: entry.archived,
        state,
        legacy: record.ledgerState?.legacy ?? false,
        artifacts,
        roadmap: record.roadmap ? { id: record.roadmap.id, path: record.roadmap.path } : null,
        repositories,
        diagnostics,
    };
}
function summarizeArtifacts(record) {
    return record.documents.map((doc) => ({ path: doc.relativePath, role: doc.role, type: doc.type }));
}
async function inspectRepository(workspace, entry, recorded, diagnostics) {
    const canonical = path.resolve(workspace.root, recorded.path);
    const observed = {
        canonical,
        repository: false,
        path: null,
        kind: null,
        standardPath: standardWorktreePath(workspace, normalizeRepositoryPath(recorded.path), entry.id),
        changedFiles: [],
    };
    if (!(await isDirectory(canonical))) {
        diagnostics.push(diagnostic('error', 'CHECKOUT_MISSING', `Recorded repository ${recorded.path} does not exist`, canonical));
        return { recorded, observed };
    }
    if (await gitToplevel(canonical) === null) {
        diagnostics.push(diagnostic('error', 'CHECKOUT_NOT_REPOSITORY', `Recorded repository ${recorded.path} is not a Git checkout`, canonical));
        return { recorded, observed };
    }
    observed.repository = true;
    observed.canonical = await realpath(canonical);
    const location = await locateBranch(workspace, observed.canonical, recorded.branch);
    observed.path = location.path;
    observed.kind = location.kind;
    if (location.path !== null)
        observed.changedFiles = (await gitChangedFiles(location.path)) ?? [];
    return { recorded, observed };
}
//# sourceMappingURL=inspect.js.map