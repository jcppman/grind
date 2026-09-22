import path from 'node:path';
import { readInitiative, type InitiativeRecord } from './artifacts.ts';
import type { InitiativeEntry } from './discovery.ts';
import { diagnostic, hasErrors, type Diagnostic } from './errors.ts';
import { gitChangedFiles, gitCurrentBranch, gitToplevel } from './git.ts';
import type { LedgerState, RepositoryEntry } from './ledger.ts';
import { isDirectory } from './paths.ts';
import { readSidecar, SIDECAR_FILENAME } from './sidecar.ts';
import type { Workspace } from './workspace.ts';

export interface ArtifactSummary {
  path: string;
  role: string;
  type: string | null;
}

export interface ObservedCheckout {
  /** Absolute path where the recorded checkout should be. */
  path: string;
  exists: boolean;
  /** True when the path is a Git checkout. */
  repository: boolean;
  branch: string | null;
  detached: boolean;
  changedFiles: string[];
  sidecar: { initiative: string | null; verified: boolean; pendingNotes: number } | null;
}

export interface RepositoryInspection {
  recorded: RepositoryEntry;
  observed: ObservedCheckout;
  /** True when the checkout exists and is on the recorded branch. */
  onRecordedBranch: boolean;
}

export interface InitiativeInspection {
  id: string;
  dir: string;
  archived: boolean;
  state: LedgerState | null;
  legacy: boolean;
  artifacts: ArtifactSummary[];
  repositories: RepositoryInspection[];
  diagnostics: Diagnostic[];
}

/** Recorded and observed state of one initiative, gathered without changing anything. */
export async function inspectInitiative(
  workspace: Workspace,
  entry: InitiativeEntry,
  suppliedRecord?: InitiativeRecord,
): Promise<InitiativeInspection> {
  const record = suppliedRecord ?? await readInitiative(entry.dir, { workspace });
  const diagnostics = [...record.diagnostics];
  const artifacts = summarizeArtifacts(record);
  const state = record.ledgerState?.state ?? null;
  const repositories: RepositoryInspection[] = [];
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
    repositories,
    diagnostics,
  };
}

function summarizeArtifacts(record: InitiativeRecord): ArtifactSummary[] {
  return record.documents.map((doc) => ({ path: doc.relativePath, role: doc.role, type: doc.type }));
}

async function inspectRepository(
  workspace: Workspace,
  entry: InitiativeEntry,
  recorded: RepositoryEntry,
  diagnostics: Diagnostic[],
): Promise<RepositoryInspection> {
  const relative = recorded.checkout === 'clone' ? recorded.path : recorded.checkout;
  const checkoutPath = path.resolve(workspace.root, relative);
  const observed: ObservedCheckout = {
    path: checkoutPath,
    exists: await isDirectory(checkoutPath),
    repository: false,
    branch: null,
    detached: false,
    changedFiles: [],
    sidecar: null,
  };
  if (!observed.exists) {
    diagnostics.push(diagnostic('error', 'CHECKOUT_MISSING', `Recorded checkout ${relative} does not exist`, checkoutPath));
    return { recorded, observed, onRecordedBranch: false };
  }
  const toplevel = await gitToplevel(checkoutPath);
  if (toplevel === null) {
    diagnostics.push(diagnostic('error', 'CHECKOUT_NOT_REPOSITORY', `Recorded checkout ${relative} is not a Git checkout`, checkoutPath));
    return { recorded, observed, onRecordedBranch: false };
  }
  observed.repository = true;
  observed.branch = await gitCurrentBranch(checkoutPath);
  observed.detached = observed.branch === null;
  // The sidecar is never repository content, whether or not the user's global excludes hide it.
  observed.changedFiles = ((await gitChangedFiles(checkoutPath)) ?? []).filter(
    (line) => porcelainPath(line) !== SIDECAR_FILENAME,
  );
  const sidecar = await readSidecar(toplevel);
  if (sidecar) {
    diagnostics.push(...sidecar.diagnostics);
    observed.sidecar = {
      initiative: sidecar.initiative,
      verified: sidecar.initiative === entry.id && observed.branch === recorded.branch,
      pendingNotes: sidecar.notes.length,
    };
    if (sidecar.initiative !== null && sidecar.initiative !== entry.id) {
      diagnostics.push(diagnostic('warning', 'POINTER_MISMATCH', `Sidecar of ${relative} points at ${sidecar.initiative}`, sidecar.path));
    }
    if (sidecar.notes.length > 0) {
      diagnostics.push(diagnostic('warning', 'PENDING_NOTES', `${sidecar.notes.length} review note(s) pending in ${relative}`, sidecar.path));
    }
  }
  const onRecordedBranch = observed.branch === recorded.branch;
  if (observed.detached) {
    diagnostics.push(diagnostic('warning', 'DETACHED_HEAD', `Checkout ${relative} has a detached HEAD; recorded branch is ${recorded.branch}`, checkoutPath));
  } else if (!onRecordedBranch) {
    diagnostics.push(diagnostic('warning', 'BRANCH_MISMATCH', `Checkout ${relative} is on ${observed.branch}; recorded branch is ${recorded.branch}`, checkoutPath));
  }
  return { recorded, observed, onRecordedBranch };
}

/** Destination path of a porcelain status line, including the target of a rename or copy. */
function porcelainPath(line: string): string {
  const entry = line.slice(3);
  const arrow = entry.lastIndexOf(' -> ');
  return arrow === -1 ? entry : entry.slice(arrow + 4);
}

/** Whether the inspection shows a state that a non-switching start may enter. */
export function startBlockers(inspection: InitiativeInspection): string[] {
  const blockers: string[] = [];
  if (inspection.state === null) blockers.push('ledger state is malformed or legacy');
  if (hasErrors(inspection.diagnostics)) {
    blockers.push(...inspection.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message));
  }
  for (const repo of inspection.repositories) {
    if (repo.observed.exists && repo.observed.repository && !repo.onRecordedBranch) {
      blockers.push(
        repo.observed.detached
          ? `${repo.recorded.path} has a detached HEAD`
          : `${repo.recorded.path} is on ${repo.observed.branch}, not ${repo.recorded.branch}`,
      );
    }
  }
  return blockers;
}
