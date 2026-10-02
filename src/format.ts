import type { CheckoutKind } from './checkouts.ts';
import type { ListResult, StatusResult } from './commands.ts';
import type { Diagnostic } from './errors.ts';
import type { InitiativeInspection } from './inspect.ts';
import type { ListedNote } from './notes.ts';
import type { RepositoryInitiative, RepositoryStatus, SwitchResult, WorktreeResult } from './worktree.ts';

const DEFAULT_WIDTH = 100;
const MIN_WIDTH = 48;
const LABEL_WIDTH = 9;

export interface FormatOptions {
  width?: number;
  color?: boolean;
}

const ANSI = {
  bold: '\u001B[1m',
  cyan: '\u001B[36m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  red: '\u001B[31m',
  reset: '\u001B[0m',
};

function useColor(options: FormatOptions): boolean {
  return options.color ?? Boolean(process.stdout.isTTY && process.env['NO_COLOR'] === undefined);
}

function initiativeHeading(id: string, status: string, options: FormatOptions): string {
  if (!useColor(options)) return `${id}  [${status}]`;
  const statusColor = status === 'open' ? ANSI.green : status === 'closed' ? ANSI.cyan : status === 'malformed' ? ANSI.red : ANSI.yellow;
  return `${ANSI.bold}${ANSI.cyan}${id}${ANSI.reset}  ${statusColor}[${status}]${ANSI.reset}`;
}

function outputWidth(options: FormatOptions): number {
  const detected = options.width ?? process.stdout.columns ?? DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(detected, DEFAULT_WIDTH));
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words.shift() as string;
    for (const word of words) {
      if (line.length + word.length + 1 <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function field(label: string, value: string, width: number, indent = '  '): string[] {
  if (label.length >= LABEL_WIDTH) {
    const valueIndent = `${indent}  `;
    return [
      `${indent}${label}`,
      ...wrap(value, Math.max(1, width - valueIndent.length)).map((line) => `${valueIndent}${line}`),
    ];
  }
  const prefix = `${indent}${label.padEnd(LABEL_WIDTH)}`;
  const continuation = ' '.repeat(prefix.length);
  return wrap(value, Math.max(1, width - prefix.length)).map((line, index) => `${index === 0 ? prefix : continuation}${line}`);
}

function readableTimestamp(value: string | null): string {
  if (value === null) return '?';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : value;
}

function diagnosticsBlock(diagnostics: readonly Diagnostic[], width: number, indent = '  '): string[] {
  return diagnostics.flatMap((diagnostic) =>
    field(diagnostic.severity === 'error' ? 'Error' : 'Warning', `${diagnostic.code}: ${diagnostic.message}`, width, indent),
  );
}

function listSummary(result: ListResult): string {
  const counts = new Map<string, number>();
  for (const item of result.initiatives) {
    const status = item.status ?? 'malformed';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const total = result.initiatives.length;
  if (counts.size === 1) {
    const [status, count] = counts.entries().next().value as [string, number];
    return `${count} ${status} initiative${count === 1 ? '' : 's'}`;
  }
  const breakdown = [...counts].map(([status, count]) => `${count} ${status}`).join(', ');
  return `${total} initiatives (${breakdown})`;
}

export function formatList(result: ListResult, options: FormatOptions = {}): string {
  const width = outputWidth(options);
  const lines: string[] = [];
  if (result.initiatives.length === 0) return 'No initiatives found.';
  const summary = listSummary(result);
  lines.push(useColor(options) ? `${ANSI.bold}${summary}${ANSI.reset}` : summary);
  for (const item of result.initiatives) {
    lines.push('', initiativeHeading(item.id, item.status ?? 'malformed', options));
    if (item.roadmap) lines.push(...field('Roadmap', item.roadmap.id, width));
    if (item.current_task) lines.push(...field('Task', item.current_task, width));
    if (item.next_action) lines.push(...field('Next', item.next_action, width));
    if (item.result) lines.push(...field('Result', item.result, width));
    lines.push(...field('Updated', readableTimestamp(item.updated_at), width));
    lines.push(...diagnosticsBlock(item.diagnostics, width));
  }
  if (result.diagnostics.length > 0) {
    lines.push('', 'Workspace diagnostics');
    lines.push(...diagnosticsBlock(result.diagnostics, width));
  }
  return lines.join('\n');
}

function formatInspection(inspection: InitiativeInspection, width: number, options: FormatOptions): string[] {
  const lines: string[] = [];
  const state = inspection.state;
  const status = state?.status ?? (inspection.legacy ? 'legacy' : 'malformed');
  lines.push(`${initiativeHeading(inspection.id, status, options)}${inspection.archived ? ' archived' : ''}`);
  lines.push(...field('Folder', inspection.dir, width));
  if (inspection.roadmap) lines.push(...field('Roadmap', `${inspection.roadmap.id} (${inspection.roadmap.path})`, width));
  if (state) {
    if (state.status === 'open') {
      lines.push(...field('Phase', state.phase ?? '?', width));
      lines.push(...field('Task', state.current_task ?? '?', width));
      lines.push(...field('Next', state.next_action ?? '?', width));
    } else {
      lines.push(...field('Closed', `${state.closed?.date} (${state.closed?.outcome})`, width));
      lines.push(...field('Result', state.result ?? '?', width));
    }
    lines.push(...field('Updated', readableTimestamp(state.updated_at), width));
  }
  lines.push('', 'Artifacts');
  for (const artifact of inspection.artifacts) {
    lines.push(`    ${artifact.path}  ${artifact.type ?? artifact.role}`);
  }
  if (inspection.repositories.length > 0) lines.push('', 'Repositories');
  for (const repo of inspection.repositories) {
    const { recorded, observed } = repo;
    const seen = !observed.repository ? 'repository unavailable' : location(observed.path, observed.kind);
    const changes = observed.changedFiles.length > 0 ? `, ${observed.changedFiles.length} changed file(s)` : '';
    lines.push(...field(recorded.path, `${recorded.branch}: ${seen}${changes}`, width));
  }
  if (inspection.diagnostics.length > 0) {
    lines.push('', 'Diagnostics');
    lines.push(...diagnosticsBlock(inspection.diagnostics, width));
  }
  return lines;
}

function location(dir: string | null, kind: CheckoutKind | null): string {
  if (dir === null) return 'not checked out';
  const labels: Record<CheckoutKind, string> = { canonical: 'canonical checkout', grind: 'worktree', app: 'app worktree', other: 'worktree' };
  return `${labels[kind ?? 'other']} ${dir}`;
}

function repositoryInitiative(item: RepositoryInitiative, width: number): string[] {
  return [
    ...field(item.id, `${item.branch}: ${location(item.path, item.kind)}`, width),
    ...(item.current_task ? field('', item.current_task, width, '    ') : []),
  ];
}

function formatRepositoryStatus(result: RepositoryStatus, width: number, options: FormatOptions): string[] {
  const lines = [useColor(options) ? `${ANSI.bold}${result.repository}${ANSI.reset}` : result.repository];
  lines.push(...field('Checkout', `${result.checkout.path} (${result.checkout.kind}) on ${result.checkout.branch ?? 'detached HEAD'}`, width));
  if (result.owner) {
    lines.push(...field('Init', result.owner.id, width));
    if (result.owner.current_task) lines.push(...field('Task', result.owner.current_task, width));
    if (result.owner.next_action) lines.push(...field('Next', result.owner.next_action, width));
  } else {
    lines.push(...field('Init', result.owners.length > 1 ? `ambiguous: ${result.owners.join(', ')}` : 'none owns this branch', width));
  }
  if (result.initiatives.length > 0) {
    lines.push('', 'Other inits in this repository');
    for (const item of result.initiatives) lines.push(...repositoryInitiative(item, width));
  }
  return lines;
}

export function formatStatus(result: StatusResult, options: FormatOptions = {}): string {
  const width = outputWidth(options);
  if (result.kind === 'repository') return formatRepositoryStatus(result, width, options).join('\n');
  const lines = formatInspection(result.inspection, width, options);
  lines.splice(1, 0, ...field('Resolved', `via ${result.resolution.source}`, width));
  for (const operation of result.pendingOperations) {
    lines.push(...field('Pending', `${operation.kind} operation ${operation.id}: ${operation.step}`, width));
  }
  if (result.inspection.state?.status === 'closed' && !result.inspection.archived) {
    lines.push(...field('Archive', result.archiveEligibility.eligible ? 'eligible' : result.archiveEligibility.blockers.join('; '), width));
  }
  return lines.join('\n');
}

/** What `worktree` did, apart from the path it prints. */
export function formatWorktree(result: WorktreeResult): string {
  const lines: string[] = [];
  if (result.created) lines.push(`Created a worktree for ${result.initiative} on ${result.branch} (${result.branchOrigin} branch).`);
  if (result.recorded) lines.push(`Recorded ${result.repository} on ${result.branch} in the ledger of ${result.initiative}; save it.`);
  for (const link of result.instructionLinks.filter((item) => item.status === 'created' || item.status === 'replaced')) {
    lines.push(`Linked ${link.link} -> ${link.target}`);
  }
  lines.push(...result.warnings.map((warning) => `Warning: ${warning}`));
  return lines.join('\n');
}

export function formatSwitch(result: SwitchResult): string {
  if (!result.switched) return `${result.initiative} is already in the foreground at ${result.canonical}.`;
  const lines = [`${result.initiative} (${result.branch}) is now in the foreground at ${result.canonical}.`];
  if (result.takenFrom) lines.push(`Taken from ${result.takenFrom.path}, which is left in place with a detached HEAD.`);
  const previous = result.previous;
  if (previous?.path) lines.push(`${previous.initiative} (${previous.branch}) moved to the background at ${previous.path}.`);
  else if (previous?.branch) lines.push(`${previous.branch} is no longer checked out; no init owns it alone, so no worktree was created.`);
  if (result.recorded) lines.push(`Recorded ${result.repository} on ${result.branch} in the ledger of ${result.initiative}; save it.`);
  lines.push(...result.warnings.map((warning) => `Note: ${warning}`));
  return lines.join('\n');
}

export function formatRepositoryInitiatives(result: RepositoryStatus, options: FormatOptions = {}): string {
  const width = outputWidth(options);
  const all = [...(result.owner ? [result.owner] : []), ...result.initiatives];
  if (all.length === 0) return `No open init tracks ${result.repository}.`;
  return [`Inits tracking ${result.repository}`, ...all.flatMap((item) => repositoryInitiative(item, width))].join('\n');
}

export function formatNotes(result: { initiative: string; notes: ListedNote[] }): string {
  if (result.notes.length === 0) return `${result.initiative} has no review notes.`;
  return [
    `${result.notes.length} review note(s) for ${result.initiative}`,
    ...result.notes.flatMap((note) => [
      '',
      `${note.id} @${note.repository}:${note.path}#${note.start}${note.end === note.start ? '' : `-${note.end}`}`,
      ...(note.anchor === null ? [] : [`> ${note.anchor}`]),
      note.body,
    ]),
  ].join('\n');
}
