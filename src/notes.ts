import { GrindError } from './errors.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { atomicWriteFile, updateOperationCheckout, writeOperation, type OperationRecord } from './operations.ts';
import { parseSidecar, renderSidecar, restoredSidecarBatches } from './sidecar.ts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from './workspace.ts';

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

export interface ParkedNoteBatch {
  operationId: string;
  payload: string;
}

export function listParkedNoteBatches(raw: string, repository: string): ParkedNoteBatch[] {
  const { body } = bodyPrefix(raw);
  const batches: ParkedNoteBatch[] = [];
  let currentRepository: string | null = null;
  const lines = [...body.matchAll(/^### (.+)\s*$/gm)];
  for (let index = 0; index < lines.length; index += 1) {
    currentRepository = lines[index]?.[1] ?? null;
    if (currentRepository !== repository) continue;
    const sectionStart = (lines[index]?.index ?? 0) + (lines[index]?.[0].length ?? 0);
    const sectionEnd = lines[index + 1]?.index ?? body.length;
    const section = body.slice(sectionStart, sectionEnd);
    for (const match of section.matchAll(/<!-- grind-note-batch:([A-Za-z0-9._-]+) -->\n/g)) {
      const operationId = match[1] as string;
      const payloadStart = (match.index ?? 0) + match[0].length;
      const endMarker = `<!-- /grind-note-batch:${operationId} -->`;
      const payloadEnd = section.indexOf(endMarker, payloadStart);
      if (payloadEnd === -1) throw new GrindError('ARTIFACT_INVALID', `Parked note batch ${operationId} has no closing marker`);
      batches.push({ operationId, payload: section.slice(payloadStart, payloadEnd) });
    }
  }
  return batches;
}

/**
 * Durably parks one checkout's notes. The journal is advanced before and after
 * each destination/source write so a repeated call resumes without duplication.
 */
export async function parkCheckoutNotes(
  workspace: Workspace,
  operation: OperationRecord,
  checkoutIndex: number,
  sourceLedgerPath: string,
): Promise<OperationRecord> {
  let current = operation;
  let checkout = current.checkouts[checkoutIndex];
  if (checkout === undefined) throw new GrindError('OPERATION_INVALID', `Operation has no checkout at index ${checkoutIndex}`);
  const sidecarPath = path.join(checkout.checkout, '.grind.md');

  if (checkout.notePayload === undefined) {
    const sidecarRaw = await readFile(sidecarPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const payload = sidecarRaw === '' ? '' : splitSidecarNotes(sidecarRaw, sidecarPath).payload;
    current = updateOperationCheckout(current, checkoutIndex, { notePayload: payload, noteState: 'captured' }, `notes:${checkout.repository}:captured`);
    await writeOperation(workspace, current);
    checkout = current.checkouts[checkoutIndex] as OperationRecord['checkouts'][number];
  }

  const payload = checkout.notePayload as string;
  if (payload === '') {
    if (checkout.noteState !== 'removed') {
      current = updateOperationCheckout(current, checkoutIndex, { noteState: 'removed' }, `notes:${checkout.repository}:removed`);
      await writeOperation(workspace, current);
    }
    return current;
  }

  if (checkout.noteState === 'captured') {
    const ledgerRaw = await readFile(sourceLedgerPath, 'utf8');
    const parked = parkNotesInLedger(ledgerRaw, checkout.repository, `${current.id}.${checkoutIndex}`, payload);
    if (parked !== ledgerRaw) await atomicWriteFile(sourceLedgerPath, parked);
    current = updateOperationCheckout(current, checkoutIndex, { noteState: 'parked' }, `notes:${checkout.repository}:parked`);
    await writeOperation(workspace, current);
    checkout = current.checkouts[checkoutIndex] as OperationRecord['checkouts'][number];
  }

  if (checkout.noteState === 'parked') {
    const sidecarRaw = await readFile(sidecarPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (sidecarRaw !== '') {
      const split = splitSidecarNotes(sidecarRaw, sidecarPath);
      if (split.payload !== '' && split.payload !== payload) {
        throw new GrindError('NOTE_INVALID', `Notes in ${sidecarPath} changed after the operation captured them`);
      }
      if (split.payload !== '') await atomicWriteFile(sidecarPath, split.withoutNotes);
    }
    current = updateOperationCheckout(current, checkoutIndex, { noteState: 'removed' }, `notes:${checkout.repository}:removed`);
    await writeOperation(workspace, current);
  }
  return current;
}

/** Restores all parked batches for one target checkout with journal-backed deduplication. */
export async function restoreCheckoutNotes(
  workspace: Workspace,
  operation: OperationRecord,
  checkoutIndex: number,
  targetLedgerPath: string,
  targetInitiative: string,
): Promise<OperationRecord> {
  let current = operation;
  let checkout = current.checkouts[checkoutIndex];
  if (checkout === undefined) throw new GrindError('OPERATION_INVALID', `Operation has no checkout at index ${checkoutIndex}`);
  const sidecarPath = path.join(checkout.checkout, '.grind.md');

  if (checkout.restoreBatches === undefined) {
    const ledgerRaw = await readFile(targetLedgerPath, 'utf8');
    const batches = listParkedNoteBatches(ledgerRaw, checkout.repository);
    current = updateOperationCheckout(current, checkoutIndex, { restoreBatches: batches, restoreState: 'captured' }, `restore:${checkout.repository}:captured`);
    await writeOperation(workspace, current);
    checkout = current.checkouts[checkoutIndex] as OperationRecord['checkouts'][number];
  }

  const batches = checkout.restoreBatches as ParkedNoteBatch[];
  if (checkout.restoreState === 'captured') {
    const raw = await readFile(sidecarPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const existingIds = restoredSidecarBatches(raw);
    let next = renderSidecar(raw, targetInitiative);
    const ids = [...existingIds];
    for (const batch of batches) {
      if (ids.includes(batch.operationId)) continue;
      next = appendSidecarNotes(next, targetInitiative, batch.payload);
      ids.push(batch.operationId);
    }
    next = renderSidecar(next, targetInitiative, undefined, ids);
    if (next !== raw) await atomicWriteFile(sidecarPath, next);
    current = updateOperationCheckout(current, checkoutIndex, { restoreState: 'copied' }, `restore:${checkout.repository}:copied`);
    await writeOperation(workspace, current);
    checkout = current.checkouts[checkoutIndex] as OperationRecord['checkouts'][number];
  }

  if (checkout.restoreState === 'copied') {
    const ledgerRaw = await readFile(targetLedgerPath, 'utf8');
    let nextLedger = ledgerRaw;
    for (const batch of batches) {
      const restored = restoreNotesFromLedger(nextLedger, batch.operationId);
      if (restored.payload !== '' && restored.payload !== batch.payload) {
        throw new GrindError('NOTE_INVALID', `Parked note batch ${batch.operationId} changed after capture`);
      }
      nextLedger = restored.ledger;
    }
    if (nextLedger !== ledgerRaw) await atomicWriteFile(targetLedgerPath, nextLedger);
    current = updateOperationCheckout(current, checkoutIndex, { restoreState: 'removed' }, `restore:${checkout.repository}:removed`);
    await writeOperation(workspace, current);
    checkout = current.checkouts[checkoutIndex] as OperationRecord['checkouts'][number];
  }

  if (checkout.restoreState === 'removed') {
    const raw = await readFile(sidecarPath, 'utf8');
    const restoredIds = new Set(batches.map((batch) => batch.operationId));
    const remainingIds = restoredSidecarBatches(raw).filter((id) => !restoredIds.has(id));
    const cleaned = renderSidecar(raw, targetInitiative, undefined, remainingIds);
    if (cleaned !== raw) await atomicWriteFile(sidecarPath, cleaned);
    current = updateOperationCheckout(current, checkoutIndex, { restoreState: 'complete' }, `restore:${checkout.repository}:complete`);
    await writeOperation(workspace, current);
  }
  return current;
}
