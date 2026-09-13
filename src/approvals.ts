import path from 'node:path';
import type { ArtifactDocument } from './artifacts.ts';
import { diagnostic, type Diagnostic } from './errors.ts';
import { getString, isRecord, parseFrontmatter } from './frontmatter.ts';
import { gitShowFile } from './git.ts';
import { isTimestampWithOffset } from './ledger.ts';
import { toPosix } from './paths.ts';

export interface ApprovalEvent {
  by: string;
  at: string;
  revision: { commit: string; path: string };
}

export type Coverage = 'current' | 'outdated' | 'unknown';

export interface ApprovalCoverage {
  event: ApprovalEvent;
  coverage: Coverage;
  reason?: string;
}

export interface ApprovalReport {
  coverages: ApprovalCoverage[];
  diagnostics: Diagnostic[];
}

const COMMIT_ID = /^[0-9a-f]{40}$/;

/**
 * Checks each recorded approval against the reviewed revision in the state
 * repository. Content is compared excluding `grind.approvals` itself.
 */
export async function checkApprovals(
  doc: ArtifactDocument,
  stateGitRoot: string,
): Promise<ApprovalReport> {
  const diagnostics: Diagnostic[] = [];
  const coverages: ApprovalCoverage[] = [];
  const events = approvalEvents(doc, diagnostics);
  const currentRepoPath = toPosix(path.relative(stateGitRoot, doc.path));
  for (const event of events) {
    if (event.revision.path !== currentRepoPath) {
      diagnostics.push(
        diagnostic(
          'warning',
          'APPROVAL_PATH_MISMATCH',
          `Approval references ${event.revision.path} but the document is at ${currentRepoPath}`,
          doc.path,
        ),
      );
    }
    const reviewed = await gitShowFile(stateGitRoot, event.revision.commit, event.revision.path);
    if (reviewed === null) {
      coverages.push({
        event,
        coverage: 'unknown',
        reason: `Revision ${event.revision.commit}:${event.revision.path} is unavailable`,
      });
      diagnostics.push(
        diagnostic('warning', 'APPROVAL_UNKNOWN', 'Approved revision is unavailable; coverage cannot be established', doc.path),
      );
      continue;
    }
    const current = comparable(doc.frontmatter.raw);
    const approved = comparable(reviewed);
    if (current === approved) {
      coverages.push({ event, coverage: 'current' });
    } else {
      coverages.push({ event, coverage: 'outdated', reason: 'Content changed since the approved revision' });
      diagnostics.push(
        diagnostic('warning', 'APPROVAL_OUTDATED', 'Document changed since its approved revision', doc.path),
      );
    }
  }
  return { coverages, diagnostics };
}

function approvalEvents(doc: ArtifactDocument, diagnostics: Diagnostic[]): ApprovalEvent[] {
  const data = doc.frontmatter.data;
  if (!data) return [];
  const grind = data['grind'];
  if (!isRecord(grind) || !('approvals' in grind)) return [];
  const raw = grind['approvals'];
  if (!Array.isArray(raw)) {
    diagnostics.push(diagnostic('error', 'APPROVAL_INVALID', '`grind.approvals` must be a list', doc.path));
    return [];
  }
  const events: ApprovalEvent[] = [];
  raw.forEach((item, index) => {
    const label = `grind.approvals[${index}]`;
    const by = isRecord(item) ? getString(item, 'by') : null;
    const at = isRecord(item) ? getString(item, 'at') : null;
    const revision = isRecord(item) && isRecord(item['revision']) ? item['revision'] : null;
    const commit = revision ? getString(revision, 'commit') : null;
    const revisionPath = revision ? getString(revision, 'path') : null;
    const problems: string[] = [];
    if (by === null || !by.startsWith('human:')) problems.push('`by` must be "human:<identity>"');
    if (at === null || !isTimestampWithOffset(at)) problems.push('`at` must be an ISO 8601 timestamp with offset');
    if (revision && typeof revision['commit'] === 'number') {
      problems.push('`revision.commit` was parsed as a number; quote all-digit commit ids');
    } else if (commit === null || !COMMIT_ID.test(commit)) {
      problems.push('`revision.commit` must be a full commit id');
    }
    if (revisionPath === null) problems.push('`revision.path` must be a repository-relative path');
    if (problems.length > 0) {
      diagnostics.push(
        diagnostic('error', 'APPROVAL_INVALID', `${label}: ${problems.join('; ')}`, doc.path),
      );
      return;
    }
    events.push({
      by: by as string,
      at: at as string,
      revision: { commit: commit as string, path: revisionPath as string },
    });
  });
  return events;
}

/** Canonical form of a document with `grind.approvals` removed. */
function comparable(raw: string): string {
  const parsed = parseFrontmatter(raw);
  const data = structuredClone(parsed.data ?? {});
  const grind = data['grind'];
  if (isRecord(grind)) {
    delete grind['approvals'];
    if (Object.keys(grind).length === 0) delete data['grind'];
  }
  return JSON.stringify(sortKeys(data)) + '\n' + parsed.body;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}
