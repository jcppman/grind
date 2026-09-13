import { diagnostic, hasErrors, type Diagnostic } from './errors.ts';
import { WORKTREES_FOLDER } from './discovery.ts';
import { getString, isRecord, type Frontmatter } from './frontmatter.ts';
import { isContainedRelativePath, normalizeRepositoryPath } from './paths.ts';

export const LEDGER_TYPE = 'Initiative Ledger';

export interface RepositoryEntry {
  /** Workspace-relative path of the repository. */
  path: string;
  branch: string;
  /** `clone`, or an initiative-relative worktree path. */
  checkout: string;
  pull_request: string | null;
}

export interface ClosureRecord {
  date: string;
  outcome: 'delivered' | 'abandoned';
}

export interface LedgerState {
  status: 'open' | 'closed';
  updated_at: string;
  phase: string | null;
  current_task: string | null;
  next_action: string | null;
  result: string | null;
  closed: ClosureRecord | null;
  repositories: RepositoryEntry[];
}

export interface LedgerValidation {
  /** Structured state, or null when required Grind fields are malformed. */
  state: LedgerState | null;
  /** True when the record predates frontmatter and needs explicit migration. */
  legacy: boolean;
  diagnostics: Diagnostic[];
}

const TIMESTAMP_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_FIELD = /^(?:Status|Phase|Current task|Next action|Last updated):/m;
const LEGACY_TRACKING = /^## Tracking[ \t]*$/m;
const BRANCH_FORBIDDEN = /[\s\p{Cc}]/u;

export function isTimestampWithOffset(value: string): boolean {
  return TIMESTAMP_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value));
}

function hasLegacyFields(body: string): boolean {
  return LEGACY_FIELD.test(body) || LEGACY_TRACKING.test(body);
}

/** Validates ledger frontmatter against the shared artifact contract. */
export function validateLedger(frontmatter: Frontmatter, path: string): LedgerValidation {
  const diagnostics: Diagnostic[] = [];
  const legacyFields = hasLegacyFields(frontmatter.body);

  if (!frontmatter.hasFrontmatter) {
    diagnostics.push(
      diagnostic(
        'warning',
        'LEGACY_RECORD',
        'Ledger has no frontmatter; migrate it explicitly before mutating operations',
        path,
      ),
    );
    return { state: null, legacy: true, diagnostics };
  }
  if (frontmatter.error !== undefined || frontmatter.data === null) {
    diagnostics.push(
      diagnostic('error', 'FRONTMATTER_INVALID', frontmatter.error ?? 'Invalid frontmatter', path),
    );
    return { state: null, legacy: false, diagnostics };
  }

  const grind = frontmatter.data['grind'];
  if (!isRecord(grind)) {
    diagnostics.push(
      diagnostic('error', 'MISSING_GRIND_STATE', 'Ledger frontmatter has no `grind` mapping', path),
    );
    return { state: null, legacy: legacyFields, diagnostics };
  }
  if (legacyFields) {
    diagnostics.push(
      diagnostic(
        'error',
        'LEGACY_CONFLICT',
        'Ledger body still carries legacy status fields alongside `grind` frontmatter; remove one',
        path,
      ),
    );
  }

  const fail = (code: string, message: string): void => {
    diagnostics.push(diagnostic('error', code, message, path));
  };

  const status = grind['status'];
  if (status !== 'open' && status !== 'closed') {
    fail('INVALID_STATUS', '`grind.status` must be "open" or "closed"');
  }

  const updatedAt = getString(grind, 'updated_at');
  if (updatedAt === null || !isTimestampWithOffset(updatedAt)) {
    fail('INVALID_TIMESTAMP', '`grind.updated_at` must be an ISO 8601 timestamp with a UTC offset');
  }

  const phase = getString(grind, 'phase');
  const currentTask = getString(grind, 'current_task');
  const nextAction = getString(grind, 'next_action');
  const result = getString(grind, 'result');
  const closed = parseClosure(grind['closed'], fail);

  if (status === 'open') {
    for (const [key, value] of [
      ['phase', phase],
      ['current_task', currentTask],
      ['next_action', nextAction],
    ] as const) {
      if (value === null) fail('MISSING_OPEN_FIELD', `Open ledger requires nonempty \`grind.${key}\``);
    }
    if ('closed' in grind || 'result' in grind) {
      fail('OPEN_WITH_CLOSURE', 'Open ledger must not carry `grind.closed` or `grind.result`');
    }
  } else if (status === 'closed') {
    if (result === null) fail('MISSING_RESULT', 'Closed ledger requires nonempty `grind.result`');
    if (closed === null) fail('MISSING_CLOSURE', 'Closed ledger requires `grind.closed` with date and outcome');
    if (phase !== null || currentTask !== null || nextAction !== null) {
      fail('CLOSED_WITH_OPEN_FIELDS', 'Closed ledger must not carry phase, current_task, or next_action');
    }
  }

  const warn = (code: string, message: string): void => {
    diagnostics.push(diagnostic('warning', code, message, path));
  };
  const repositories = parseRepositories(grind['repositories'], fail, warn);

  if (hasErrors(diagnostics)) {
    return { state: null, legacy: legacyFields, diagnostics };
  }
  return {
    state: {
      status: status as 'open' | 'closed',
      updated_at: updatedAt as string,
      phase,
      current_task: currentTask,
      next_action: nextAction,
      result,
      closed,
      repositories: repositories as RepositoryEntry[],
    },
    legacy: false,
    diagnostics,
  };
}

function parseClosure(
  value: unknown,
  fail: (code: string, message: string) => void,
): ClosureRecord | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    fail('INVALID_CLOSURE', '`grind.closed` must be a mapping with date and outcome');
    return null;
  }
  const date = getString(value, 'date');
  const outcome = value['outcome'];
  let valid = true;
  if (date === null || !DATE_ONLY.test(date) || Number.isNaN(Date.parse(date))) {
    fail('INVALID_CLOSURE', '`grind.closed.date` must be a YYYY-MM-DD date');
    valid = false;
  }
  if (outcome !== 'delivered' && outcome !== 'abandoned') {
    fail('INVALID_CLOSURE', '`grind.closed.outcome` must be "delivered" or "abandoned"');
    valid = false;
  }
  return valid ? { date: date as string, outcome: outcome as ClosureRecord['outcome'] } : null;
}

function parseRepositories(
  value: unknown,
  fail: (code: string, message: string) => void,
  warn: (code: string, message: string) => void,
): RepositoryEntry[] | null {
  if (!Array.isArray(value)) {
    fail('INVALID_REPOSITORIES', '`grind.repositories` must be a list (empty when no repository is chosen)');
    return null;
  }
  const entries: RepositoryEntry[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const label = `grind.repositories[${index}]`;
    if (!isRecord(item)) {
      fail('INVALID_REPOSITORY_ENTRY', `${label} must be a mapping`);
      return;
    }
    const repoPath = getString(item, 'path');
    const branch = getString(item, 'branch');
    const checkout = getString(item, 'checkout');
    const pullRequest = item['pull_request'];
    let valid = true;
    if (repoPath === null || !isContainedRelativePath(repoPath)) {
      fail('INVALID_REPOSITORY_PATH', `${label}.path must be a workspace-relative path without ".." segments`);
      valid = false;
    }
    if (branch === null || BRANCH_FORBIDDEN.test(branch)) {
      fail('INVALID_REPOSITORY_BRANCH', `${label}.branch must be an exact branch name without whitespace or control characters`);
      valid = false;
    }
    if (checkout === null || (checkout !== 'clone' && !isContainedRelativePath(checkout))) {
      fail('INVALID_REPOSITORY_CHECKOUT', `${label}.checkout must be "clone" or an initiative-relative worktree path`);
      valid = false;
    } else if (checkout !== 'clone' && !checkout.startsWith(`${WORKTREES_FOLDER}/`)) {
      warn('WORKTREE_LOCATION', `${label}.checkout should live under the initiative's ${WORKTREES_FOLDER}/ folder`);
    }
    if (pullRequest !== undefined && pullRequest !== null && typeof pullRequest !== 'string') {
      fail('INVALID_PULL_REQUEST', `${label}.pull_request must be a string or null`);
      valid = false;
    }
    if (repoPath !== null) {
      const normalized = normalizeRepositoryPath(repoPath);
      if (seen.has(normalized)) {
        fail('DUPLICATE_REPOSITORY', `${label}.path duplicates an earlier entry`);
        valid = false;
      }
      seen.add(normalized);
    }
    if (valid) {
      entries.push({
        path: repoPath as string,
        branch: branch as string,
        checkout: checkout as string,
        pull_request: typeof pullRequest === 'string' ? pullRequest : null,
      });
    }
  });
  return entries;
}
