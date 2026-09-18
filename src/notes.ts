import { GrindError } from './errors.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { parseSidecar, renderSidecar } from './sidecar.ts';

const NOTE_START = /^## @.+?#\d+(?:-\d+)?\s*$/m;

export interface SplitNotes {
  withoutNotes: string;
  payload: string;
}

/** Separates exact note bytes from a sidecar without interpreting individual notes. */
export function splitSidecarNotes(raw: string, sidecarPath = '.grind.md'): SplitNotes {
  const sidecar = parseSidecar(raw, sidecarPath);
  if (sidecar.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new GrindError('NOTE_INVALID', `Repair malformed ${sidecarPath} before transferring notes`, {
      diagnostics: sidecar.diagnostics,
    });
  }
  const match = NOTE_START.exec(sidecar.body);
  if (match === null) return { withoutNotes: raw, payload: '' };
  const bodyPrefix = sidecar.body.slice(0, match.index);
  const payload = sidecar.body.slice(match.index);
  return { withoutNotes: renderSidecar(raw, sidecar.initiative, bodyPrefix), payload };
}

export function appendSidecarNotes(raw: string, initiative: string | null, payload: string): string {
  if (payload === '') return renderSidecar(raw, initiative);
  const sidecar = parseSidecar(raw, '.grind.md');
  if (sidecar.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new GrindError('NOTE_INVALID', 'Repair malformed .grind.md before restoring notes', {
      diagnostics: sidecar.diagnostics,
    });
  }
  const separator = sidecar.body === '' ? '' : sidecar.body.endsWith('\n\n') ? '' : sidecar.body.endsWith('\n') ? '\n' : '\n\n';
  return renderSidecar(raw, initiative, `${sidecar.body}${separator}${payload}`);
}

function bodyPrefix(raw: string): { prefix: string; body: string } {
  const parsed = parseFrontmatter(raw);
  if (parsed.error !== undefined) throw new GrindError('ARTIFACT_INVALID', parsed.error);
  return { prefix: raw.slice(0, raw.length - parsed.body.length), body: parsed.body };
}

function markers(operationId: string): { start: string; end: string } {
  if (!/^[A-Za-z0-9._-]+$/.test(operationId)) throw new GrindError('OPERATION_INVALID', 'Operation id is not safe for a note marker');
  return {
    start: `<!-- grind-note-batch:${operationId} -->`,
    end: `<!-- /grind-note-batch:${operationId} -->`,
  };
}

/** Adds one exact note batch to a ledger. Repeating the same operation is a no-op. */
export function parkNotesInLedger(raw: string, repository: string, operationId: string, payload: string): string {
  if (payload === '') return raw;
  if (/\r|\n/.test(repository)) throw new GrindError('NOTE_INVALID', 'Repository path cannot contain a newline');
  const { prefix, body } = bodyPrefix(raw);
  const marker = markers(operationId);
  if (body.includes(marker.start)) return raw;
  const parkedHeading = body.includes('\n## Parked notes\n') || body.startsWith('## Parked notes\n') ? '' : '\n## Parked notes\n';
  const separator = body === '' || body.endsWith('\n') ? '' : '\n';
  const batch = `${parkedHeading}\n### ${repository}\n${marker.start}\n${payload}${marker.end}\n`;
  return `${prefix}${body}${separator}${batch}`;
}

/** Removes and returns one exact parked batch. Repeating removal returns no payload. */
export function restoreNotesFromLedger(raw: string, operationId: string): { ledger: string; payload: string } {
  const { prefix, body } = bodyPrefix(raw);
  const marker = markers(operationId);
  const start = body.indexOf(marker.start);
  if (start === -1) return { ledger: raw, payload: '' };
  const payloadStart = start + marker.start.length + (body[start + marker.start.length] === '\n' ? 1 : 0);
  const end = body.indexOf(marker.end, payloadStart);
  if (end === -1) throw new GrindError('ARTIFACT_INVALID', `Parked note batch ${operationId} has no closing marker`);
  const payload = body.slice(payloadStart, end);
  const removalEnd = end + marker.end.length + (body[end + marker.end.length] === '\n' ? 1 : 0);
  return { ledger: `${prefix}${body.slice(0, start)}${body.slice(removalEnd)}`, payload };
}
