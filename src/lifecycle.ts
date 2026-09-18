import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.ts';
import { branchOwners } from './resolve.ts';
import { git } from './git.ts';
import { inspectInitiative, type InitiativeInspection, type RepositoryInspection } from './inspect.ts';
import { withLifecycleLocks } from './operations.ts';
import type { Workspace } from './workspace.ts';

export interface PlannedCheckout {
  repository: string;
  checkout: string;
  sourceBranch: string | null;
  targetBranch: string;
  action: 'stay' | 'switch' | 'verify-worktree';
  targetSource: 'current' | 'local' | 'remote' | 'remote-default' | 'unknown';
}

export interface StartPlan {
  target: string;
  checkouts: PlannedCheckout[];
  blockers: string[];
}

async function gitPathExists(checkout: string, name: string): Promise<boolean> {
  const location = await git(['rev-parse', '--git-path', name], checkout);
  if (!location.ok) return false;
  return lstat(path.resolve(checkout, location.stdout.trim())).then(() => true, () => false);
}

async function inProgressOperation(checkout: string): Promise<string | null> {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
    if (await gitPathExists(checkout, marker)) return marker;
  }
  return null;
}

async function branchOccupiedElsewhere(checkout: string, branch: string): Promise<string | null> {
  const result = await git(['worktree', 'list', '--porcelain'], checkout);
  if (!result.ok) return null;
  let worktree: string | null = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) worktree = line.slice('worktree '.length);
    if (line === `branch refs/heads/${branch}` && worktree !== null && path.resolve(worktree) !== path.resolve(checkout)) {
      return worktree;
    }
    if (line === '') worktree = null;
  }
  return null;
}

async function planTargetSource(
  checkout: string,
  targetBranch: string,
  blockers: string[],
  repository: string,
): Promise<PlannedCheckout['targetSource']> {
  const local = await git(['show-ref', '--verify', '--quiet', `refs/heads/${targetBranch}`], checkout);
  if (local.ok) return 'local';

  const remoteMatches = await git(
    ['for-each-ref', '--format=%(refname:short)', `refs/remotes/*/${targetBranch}`],
    checkout,
  );
  const matches = remoteMatches.ok ? remoteMatches.stdout.split('\n').filter(Boolean) : [];
  if (matches.length === 1) return 'remote';
  if (matches.length > 1) {
    blockers.push(`${repository} branch ${targetBranch} exists on several remotes: ${matches.join(', ')}`);
    return 'unknown';
  }

  const remotes = await git(['remote'], checkout);
  const names = remotes.ok ? remotes.stdout.split('\n').filter(Boolean) : [];
  if (names.length !== 1) {
    blockers.push(`${repository} cannot create ${targetBranch}: expected one configured remote, found ${names.length}`);
    return 'unknown';
  }
  const remote = names[0] as string;
  const head = await git(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], checkout);
  if (!head.ok || head.stdout.trim() === '') {
    blockers.push(`${repository} cannot create ${targetBranch}: ${remote} has no local default-branch ref`);
    return 'unknown';
  }
  return 'remote-default';
}

async function targetReference(
  checkout: string,
  branch: string,
  source: PlannedCheckout['targetSource'],
): Promise<string | null> {
  if (source === 'local') return `refs/heads/${branch}`;
  if (source === 'remote') {
    const refs = await git(['for-each-ref', '--format=%(refname)', `refs/remotes/*/${branch}`], checkout);
    const matches = refs.ok ? refs.stdout.split('\n').filter(Boolean) : [];
    return matches.length === 1 ? matches[0] as string : null;
  }
  if (source === 'remote-default') {
    const remotes = await git(['remote'], checkout);
    const names = remotes.ok ? remotes.stdout.split('\n').filter(Boolean) : [];
    if (names.length !== 1) return null;
    const head = await git(['symbolic-ref', '--quiet', `refs/remotes/${names[0]}/HEAD`], checkout);
    return head.ok ? head.stdout.trim() : null;
  }
  return null;
}

async function inspectCheckout(
  workspace: Workspace,
  target: string,
  repository: RepositoryInspection,
  blockers: string[],
): Promise<PlannedCheckout> {
  const { recorded, observed } = repository;
  const action: PlannedCheckout['action'] =
    recorded.checkout !== 'clone' ? 'verify-worktree' : repository.onRecordedBranch ? 'stay' : 'switch';
  const planned: PlannedCheckout = {
    repository: recorded.path,
    checkout: observed.path,
    sourceBranch: observed.branch,
    targetBranch: recorded.branch,
    action,
    targetSource: repository.onRecordedBranch ? 'current' : 'unknown',
  };
  if (!observed.exists || !observed.repository) return planned;
  if (observed.detached) blockers.push(`${recorded.path} has a detached HEAD`);

  const operation = await inProgressOperation(observed.path);
  if (operation !== null) blockers.push(`${recorded.path} has an in-progress Git operation (${operation})`);

  const targetOwners = await branchOwners(workspace, recorded.path, recorded.branch);
  if (targetOwners.length !== 1 || targetOwners[0]?.id !== target) {
    blockers.push(
      targetOwners.length === 0
        ? `${recorded.path} branch ${recorded.branch} is not owned by ${target}`
        : `${recorded.path} branch ${recorded.branch} has conflicting owners: ${targetOwners.map((owner) => owner.id).join(', ')}`,
    );
  }

  if (recorded.checkout !== 'clone') {
    if (!repository.onRecordedBranch) blockers.push(`${recorded.path} worktree is on ${observed.branch}, not ${recorded.branch}`);
    return planned;
  }
  if (repository.onRecordedBranch) return planned;
  planned.targetSource = await planTargetSource(observed.path, recorded.branch, blockers, recorded.path);
  const targetRef = await targetReference(observed.path, recorded.branch, planned.targetSource);
  if (targetRef !== null) {
    const checkoutCheck = await git(['read-tree', '-n', '-m', '-u', 'HEAD', targetRef], observed.path);
    if (!checkoutCheck.ok) {
      blockers.push(`${recorded.path} cannot switch cleanly: ${checkoutCheck.stderr.trim() || 'target tree conflicts with checkout files'}`);
    }
    const changed = await git(['diff', '--name-only', '-z', 'HEAD', targetRef], observed.path);
    for (const relative of changed.ok ? changed.stdout.split('\0').filter(Boolean) : []) {
      const tracked = await git(['ls-files', '--error-unmatch', '--', relative], observed.path);
      if (!tracked.ok && await lstat(path.join(observed.path, relative)).then(() => true, () => false)) {
        blockers.push(`${recorded.path} cannot switch cleanly: ${relative} is an untracked or ignored checkout obstruction`);
      }
    }
  }
  if (observed.changedFiles.length > 0) {
    blockers.push(`${recorded.path} must switch but has ${observed.changedFiles.length} changed file(s)`);
  }
  const trackedSidecar = await git(['ls-files', '--error-unmatch', '.grind.md'], observed.path);
  if (trackedSidecar.ok) blockers.push(`${recorded.path} tracks .grind.md; remove it from repository history before switching`);
  if (observed.branch !== null) {
    const sourceOwners = await branchOwners(workspace, recorded.path, observed.branch);
    if (sourceOwners.length > 1) {
      blockers.push(`${recorded.path} branch ${observed.branch} has conflicting owners: ${sourceOwners.map((owner) => owner.id).join(', ')}`);
    } else if (sourceOwners.length === 0 && (observed.sidecar?.pendingNotes ?? 0) > 0) {
      blockers.push(`${recorded.path} has notes on unowned branch ${observed.branch}`);
    }
  }
  const occupied = await branchOccupiedElsewhere(observed.path, recorded.branch);
  if (occupied !== null) blockers.push(`${recorded.path} branch ${recorded.branch} is checked out at ${occupied}`);
  return planned;
}

/** Builds a complete, read-only checkout plan. Execution revalidates it after locks are acquired. */
export async function planStart(workspace: Workspace, inspection: InitiativeInspection): Promise<StartPlan> {
  const blockers = inspection.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.message);
  if (inspection.state === null) blockers.unshift('ledger state is malformed or legacy');
  const checkouts: PlannedCheckout[] = [];
  for (const repository of inspection.repositories) {
    checkouts.push(await inspectCheckout(workspace, inspection.id, repository, blockers));
  }
  return { target: inspection.id, checkouts, blockers: [...new Set(blockers)] };
}

/** Acquires state and repository locks, then rebuilds the plan before any lifecycle mutation. */
export async function withLockedStartPlan<T>(
  workspace: Workspace,
  inspection: InitiativeInspection,
  operationId: string,
  action: (plan: StartPlan) => Promise<T>,
): Promise<T> {
  const repositoryRoots = inspection.repositories
    .filter((repository) => repository.observed.repository)
    .map((repository) => repository.observed.path);
  return withLifecycleLocks(workspace, repositoryRoots, operationId, async () => {
    const refreshed = await inspectInitiative(workspace, {
      id: inspection.id,
      dir: inspection.dir,
      archived: inspection.archived,
    });
    const plan = await planStart(workspace, refreshed);
    if (plan.blockers.length > 0) {
      throw new GrindError('START_BLOCKED', `${inspection.id} changed before lifecycle locks were acquired`, {
        initiative: inspection.id,
        blockers: plan.blockers,
        plan,
      });
    }
    return action(plan);
  });
}
