import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendSidecarNotes, parkNotesInLedger, restoreNotesFromLedger, splitSidecarNotes } from './notes.ts';
import { parseSidecar, renderSidecar } from './sidecar.ts';

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
