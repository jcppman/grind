import type { ListResult, StartResult, StatusResult } from './commands.ts';
import type { Diagnostic } from './errors.ts';
import type { InitiativeInspection } from './inspect.ts';

function diagnosticsBlock(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => `  ${d.severity === 'error' ? 'error' : 'warn '} ${d.code}: ${d.message}`);
}

export function formatList(result: ListResult): string {
  const lines: string[] = [];
  if (result.initiatives.length === 0) lines.push('No initiatives found.');
  for (const item of result.initiatives) {
    lines.push(`${item.id}  [${item.status ?? 'malformed'}]  updated ${item.updated_at ?? '?'}`);
    if (item.current_task) lines.push(`  task: ${item.current_task}`);
    if (item.next_action) lines.push(`  next: ${item.next_action}`);
    if (item.result) lines.push(`  result: ${item.result}`);
    lines.push(...diagnosticsBlock(item.diagnostics));
  }
  lines.push(...diagnosticsBlock(result.diagnostics));
  return lines.join('\n');
}

function formatInspection(inspection: InitiativeInspection): string[] {
  const lines: string[] = [];
  const state = inspection.state;
  lines.push(`${inspection.id}  [${state?.status ?? (inspection.legacy ? 'legacy' : 'malformed')}]${inspection.archived ? ' archived' : ''}`);
  lines.push(`  folder: ${inspection.dir}`);
  if (state) {
    if (state.status === 'open') {
      lines.push(`  phase: ${state.phase}`, `  task: ${state.current_task}`, `  next: ${state.next_action}`);
    } else {
      lines.push(`  closed: ${state.closed?.date} (${state.closed?.outcome})`, `  result: ${state.result}`);
    }
    lines.push(`  updated: ${state.updated_at}`);
  }
  lines.push('  artifacts:');
  for (const artifact of inspection.artifacts) {
    lines.push(`    ${artifact.path}  ${artifact.type ?? artifact.role}`);
  }
  if (inspection.repositories.length > 0) lines.push('  repositories:');
  for (const repo of inspection.repositories) {
    const { recorded, observed } = repo;
    let seen: string;
    if (!observed.exists) seen = 'missing';
    else if (!observed.repository) seen = 'not a git checkout';
    else seen = observed.detached ? 'detached HEAD' : `on ${observed.branch}`;
    const changes = observed.changedFiles.length > 0 ? `, ${observed.changedFiles.length} changed file(s)` : '';
    const notes = observed.sidecar?.pendingNotes ? `, ${observed.sidecar.pendingNotes} pending note(s)` : '';
    const pointer = observed.sidecar ? `, pointer ${observed.sidecar.initiative ?? 'absent'}${observed.sidecar.verified ? ' (verified)' : ''}` : '';
    lines.push(`    ${recorded.path}  recorded ${recorded.branch} (${recorded.checkout})  observed ${seen}${changes}${notes}${pointer}`);
  }
  lines.push(...diagnosticsBlock(inspection.diagnostics));
  return lines;
}

export function formatStatus(result: StatusResult): string {
  const lines = formatInspection(result.inspection);
  lines.splice(1, 0, `  resolved via ${result.resolution.source}${result.resolution.stalePointer ? ` (stale pointer ${result.resolution.stalePointer.pointed})` : ''}`);
  for (const operation of result.pendingOperations) {
    lines.push(`  pending ${operation.kind} operation ${operation.id}: ${operation.step}`);
  }
  return lines.join('\n');
}

export function formatStart(result: StartResult): string {
  const lines = formatInspection(result.inspection);
  lines.push(`Entered ${result.inspection.id}; no checkout was switched.`);
  if (result.pendingNotes > 0) lines.push(`${result.pendingNotes} review note(s) await handling before resuming.`);
  return lines.join('\n');
}
