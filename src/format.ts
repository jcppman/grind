import type { ListResult, StartResult, StatusResult } from './commands.ts';
import type { Diagnostic } from './errors.ts';
import type { InitiativeInspection } from './inspect.ts';

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
    let seen: string;
    if (!observed.exists) seen = 'missing';
    else if (!observed.repository) seen = 'not a git checkout';
    else seen = observed.detached ? 'detached HEAD' : `on ${observed.branch}`;
    const changes = observed.changedFiles.length > 0 ? `, ${observed.changedFiles.length} changed file(s)` : '';
    const notes = observed.sidecar?.pendingNotes ? `, ${observed.sidecar.pendingNotes} pending note(s)` : '';
    const pointer = observed.sidecar ? `, pointer ${observed.sidecar.initiative ?? 'absent'}${observed.sidecar.verified ? ' (verified)' : ''}` : '';
    lines.push(...field(recorded.path, `recorded ${recorded.branch} (${recorded.checkout}); observed ${seen}${changes}${notes}${pointer}`, width));
  }
  if (inspection.diagnostics.length > 0) {
    lines.push('', 'Diagnostics');
    lines.push(...diagnosticsBlock(inspection.diagnostics, width));
  }
  return lines;
}

export function formatStatus(result: StatusResult, options: FormatOptions = {}): string {
  const width = outputWidth(options);
  const lines = formatInspection(result.inspection, width, options);
  lines.splice(1, 0, ...field('Resolved', `via ${result.resolution.source}${result.resolution.stalePointer ? ` (stale pointer ${result.resolution.stalePointer.pointed})` : ''}`, width));
  for (const operation of result.pendingOperations) {
    lines.push(...field('Pending', `${operation.kind} operation ${operation.id}: ${operation.step}`, width));
  }
  if (result.inspection.state?.status === 'closed' && !result.inspection.archived) {
    lines.push(...field('Archive', result.archiveEligibility.eligible ? 'eligible' : result.archiveEligibility.blockers.join('; '), width));
  }
  return lines.join('\n');
}

export function formatStart(result: StartResult, options: FormatOptions = {}): string {
  const width = outputWidth(options);
  const lines = formatInspection(result.inspection, width, options);
  const switchText = result.switched
    ? `Entered ${result.inspection.id}; switched ${result.switchedRepositories.join(', ')}.`
    : `Entered ${result.inspection.id}; no checkout was switched.`;
  lines.push('', ...wrap(switchText, width));
  for (const transfer of result.noteTransfers.filter((item) => item.parked > 0 || item.restored > 0)) {
    lines.push(...wrap(`${transfer.repository}: parked ${transfer.parked} note(s), restored ${transfer.restored}.`, width));
  }
  if (result.dependencyChanges.length > 0) {
    lines.push(...wrap(`Dependency files changed: ${result.dependencyChanges.join(', ')}`, width));
  }
  if (result.pendingNotes > 0) lines.push(...wrap(`${result.pendingNotes} review note(s) await handling before resuming.`, width));
  return lines.join('\n');
}
