import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { appendSidecarNotes, listParkedNoteBatches, parkCheckoutNotes, parkNotesInLedger, restoreCheckoutNotes, restoreNotesFromLedger, splitSidecarNotes } from './notes.ts';
import { newStartOperation, readPendingOperations, writeOperation } from './operations.ts';
import { parseSidecar, renderSidecar } from './sidecar.ts';
import { makeCheckout, makeTempWorkspace, openLedger, writeInitiative, writeSidecar } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

const notes = `## @src/a.ts#2-3
> second

First note.

## @src/a.ts#2-3
> second

First note.`;

test('sidecar note payloads survive exact extraction and restoration', () => {
  const raw = `---
initiative: app/one
custom: keep
---

${notes}`;
  const split = splitSidecarNotes(raw);
  assert.equal(split.payload, notes);
  const without = parseSidecar(split.withoutNotes, '.grind.md');
  assert.equal(without.initiative, 'app/one');
  assert.equal(without.notes.length, 0);
  assert.match(split.withoutNotes, /custom: keep/);

  const restored = appendSidecarNotes(renderSidecar(split.withoutNotes, 'app/two'), 'app/two', split.payload);
  const parsed = parseSidecar(restored, '.grind.md');
  assert.equal(parsed.initiative, 'app/two');
  assert.equal(parsed.notes.length, 2);
  assert.equal(splitSidecarNotes(restored).payload, notes);
});

test('ledger parking is idempotent and restores exact bytes once', () => {
  const ledger = `---
type: Initiative Ledger
custom: keep
---

# Ledger

Unrelated text.
`;
  const parked = parkNotesInLedger(ledger, 'app', 'op-1', notes);
  assert.equal(parkNotesInLedger(parked, 'app', 'op-1', notes), parked);
  assert.match(parked, /custom: keep/);
  assert.match(parked, /Unrelated text/);

  const restored = restoreNotesFromLedger(parked, 'op-1');
  assert.equal(restored.payload, notes);
  assert.match(restored.ledger, /custom: keep/);
  assert.match(restored.ledger, /Unrelated text/);
  assert.deepEqual(restoreNotesFromLedger(restored.ledger, 'op-1'), { ledger: restored.ledger, payload: '' });
});

test('different operation ids preserve identical user-authored notes as distinct batches', () => {
  const ledger = '# Ledger\n';
  const first = parkNotesInLedger(ledger, 'app', 'op-1', notes);
  const second = parkNotesInLedger(first, 'app', 'op-2', notes);
  const restoredFirst = restoreNotesFromLedger(second, 'op-1');
  const restoredSecond = restoreNotesFromLedger(restoredFirst.ledger, 'op-2');
  assert.equal(restoredFirst.payload, notes);
  assert.equal(restoredSecond.payload, notes);
});

test('parking writes journal, ledger destination, and sidecar source in recoverable order', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const initiative = await writeInitiative(ws, 'app/source', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  const app = await makeCheckout(ws, 'app');
  await writeFile(path.join(app, 'src.ts'), 'first\nsecond\n');
  await writeSidecar(app, 'app/source', `${notes}\n`);
  const workspace = await loadWorkspace({ cwd: ws.root });
  const operation = newStartOperation('app/target', [
    { repository: 'app', checkout: app, sourceBranch: 'main', targetBranch: 'target', sourceInitiative: 'app/source' },
  ]);
  await writeOperation(workspace, operation);

  const completed = await parkCheckoutNotes(workspace, operation, 0, path.join(initiative, 'ledger.md'));

  assert.equal(completed.checkouts[0]?.noteState, 'removed');
  assert.equal(completed.checkouts[0]?.notePayload, `${notes}\n`);
  assert.equal((await readPendingOperations(workspace))[0]?.checkouts[0]?.noteState, 'removed');
  assert.equal(parseSidecar(await readFile(path.join(app, '.grind.md'), 'utf8'), '.grind.md').notes.length, 0);
  const restored = restoreNotesFromLedger(await readFile(path.join(initiative, 'ledger.md'), 'utf8'), `${operation.id}.0`);
  assert.equal(restored.payload, `${notes}\n`);
});

test('parking resumes after ledger write or sidecar removal without duplicating notes', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const initiative = await writeInitiative(ws, 'app/source', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  const app = await makeCheckout(ws, 'app');
  await writeSidecar(app, 'app/source', `${notes}\n`);
  const workspace = await loadWorkspace({ cwd: ws.root });
  const base = newStartOperation('app/target', [
    { repository: 'app', checkout: app, sourceBranch: 'main', targetBranch: 'target', notePayload: `${notes}\n`, noteState: 'captured' },
  ]);
  const ledgerPath = path.join(initiative, 'ledger.md');
  const ledger = await readFile(ledgerPath, 'utf8');
  await writeFile(ledgerPath, parkNotesInLedger(ledger, 'app', `${base.id}.0`, `${notes}\n`));

  const afterLedgerCrash = await parkCheckoutNotes(workspace, base, 0, ledgerPath);
  assert.equal(afterLedgerCrash.checkouts[0]?.noteState, 'removed');
  assert.equal((await readFile(ledgerPath, 'utf8').then((raw) => raw.match(new RegExp(`<!-- grind-note-batch:${base.id}\\.0 -->`, 'g'))?.length)), 1);

  const second = newStartOperation('app/target', [
    { repository: 'app', checkout: app, sourceBranch: 'main', targetBranch: 'target', notePayload: `${notes}\n`, noteState: 'parked' },
  ]);
  await writeFile(ledgerPath, parkNotesInLedger(await readFile(ledgerPath, 'utf8'), 'app', `${second.id}.0`, `${notes}\n`));
  const afterSidecarCrash = await parkCheckoutNotes(workspace, second, 0, ledgerPath);
  assert.equal(afterSidecarCrash.checkouts[0]?.noteState, 'removed');
});

test('restoration copies each parked batch once and removes ledger batches and temporary identities', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const target = await writeInitiative(ws, 'app/target', { ledger: openLedger([{ path: 'app', branch: 'target' }]) });
  const app = await makeCheckout(ws, 'app', 'target');
  await writeSidecar(app, 'app/target');
  const ledgerPath = path.join(target, 'ledger.md');
  let ledger = await readFile(ledgerPath, 'utf8');
  ledger = parkNotesInLedger(ledger, 'app', 'old-1', `${notes}\n`);
  ledger = parkNotesInLedger(ledger, 'other', 'other-1', '## @other.ts#1\n> x\n\nother\n');
  ledger = parkNotesInLedger(ledger, 'app', 'old-2', `${notes}\n`);
  await writeFile(ledgerPath, ledger);
  assert.deepEqual(listParkedNoteBatches(ledger, 'app').map((batch) => batch.operationId), ['old-1', 'old-2']);
  const workspace = await loadWorkspace({ cwd: ws.root });
  const operation = newStartOperation('app/target', [
    { repository: 'app', checkout: app, sourceBranch: 'main', targetBranch: 'target' },
  ]);

  const completed = await restoreCheckoutNotes(workspace, operation, 0, ledgerPath, 'app/target');

  assert.equal(completed.checkouts[0]?.restoreState, 'complete');
  const sidecarRaw = await readFile(path.join(app, '.grind.md'), 'utf8');
  assert.equal(parseSidecar(sidecarRaw, '.grind.md').notes.length, 4);
  assert.doesNotMatch(sidecarRaw, /grind_note_batches/);
  const finalLedger = await readFile(ledgerPath, 'utf8');
  assert.doesNotMatch(finalLedger, /old-1|old-2/);
  assert.match(finalLedger, /other-1/);
});

test('restoration resumes after destination copy and ledger removal without duplicate notes', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const target = await writeInitiative(ws, 'app/target', { ledger: openLedger([{ path: 'app', branch: 'target' }]) });
  const app = await makeCheckout(ws, 'app', 'target');
  const ledgerPath = path.join(target, 'ledger.md');
  const batch = { operationId: 'old-1', payload: `${notes}\n` };
  await writeFile(ledgerPath, parkNotesInLedger(await readFile(ledgerPath, 'utf8'), 'app', batch.operationId, batch.payload));
  const copiedSidecar = renderSidecar(appendSidecarNotes('', 'app/target', batch.payload), 'app/target', undefined, [batch.operationId]);
  await writeFile(path.join(app, '.grind.md'), copiedSidecar);
  const workspace = await loadWorkspace({ cwd: ws.root });
  const copied = newStartOperation('app/target', [
    { repository: 'app', checkout: app, sourceBranch: 'main', targetBranch: 'target', restoreBatches: [batch], restoreState: 'captured' },
  ]);

  const afterCopyCrash = await restoreCheckoutNotes(workspace, copied, 0, ledgerPath, 'app/target');
  assert.equal(parseSidecar(await readFile(path.join(app, '.grind.md'), 'utf8'), '.grind.md').notes.length, 2);
  assert.equal(afterCopyCrash.checkouts[0]?.restoreState, 'complete');

  const secondBatch = { operationId: 'old-2', payload: `${notes}\n` };
  const sidecarWithSecond = renderSidecar(
    appendSidecarNotes(await readFile(path.join(app, '.grind.md'), 'utf8'), 'app/target', secondBatch.payload),
    'app/target',
    undefined,
    [secondBatch.operationId],
  );
  await writeFile(path.join(app, '.grind.md'), sidecarWithSecond);
  const removed = newStartOperation('app/target', [
    { repository: 'app', checkout: app, sourceBranch: 'main', targetBranch: 'target', restoreBatches: [secondBatch], restoreState: 'copied' },
  ]);
  const afterLedgerCrash = await restoreCheckoutNotes(workspace, removed, 0, ledgerPath, 'app/target');
  assert.equal(afterLedgerCrash.checkouts[0]?.restoreState, 'complete');
  assert.equal(parseSidecar(await readFile(path.join(app, '.grind.md'), 'utf8'), '.grind.md').notes.length, 4);
});
