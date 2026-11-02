import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readInitiative, type InitiativeRecord } from './artifacts.ts';
import { locateBranch, standardWorktreePath, type CheckoutKind } from './checkouts.ts';
import type { InitiativeEntry } from './discovery.ts';
import { diagnostic, type Diagnostic } from './errors.ts';
import { gitChangedFiles, gitToplevel } from './git.ts';
import type { LedgerState, RepositoryEntry } from './ledger.ts';
import { isDirectory, normalizeRepositoryPath } from './paths.ts';
import type { Workspace } from './workspace.ts';

export interface ArtifactSummary {
  path: string;
  role: string;
  type: string | null;
}

export interface ObservedCheckout {
  /** Absolute path of the recorded repository's canonical checkout. */
  canonical: string;
  /** True when the canonical path is a Git checkout. */
  repository: boolean;
  /** Where the recorded branch is checked out, or null when it is not checked out. */
  path: string | null;
  kind: CheckoutKind | null;
  /** Where `grind worktree` places this initiative's worktree. */
  standardPath: string;
  changedFiles: string[];
}

export interface RepositoryInspection {
  recorded: RepositoryEntry;
  observed: ObservedCheckout;
}

export interface InitiativeInspection {
  id: string;
  dir: string;
  archived: boolean;
  state: LedgerState | null;
  legacy: boolean;
  artifacts: ArtifactSummary[];
  roadmap: { id: string; path: string } | null;
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
    roadmap: record.roadmap ? { id: record.roadmap.id, path: record.roadmap.path } : null,
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
  const canonical = path.resolve(workspace.root, recorded.path);
  const observed: ObservedCheckout = {
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
  if (location.path !== null) observed.changedFiles = (await gitChangedFiles(location.path)) ?? [];
  return { recorded, observed };
}
