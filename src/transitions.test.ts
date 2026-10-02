import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrontmatter } from './frontmatter.ts';
import { validateLedger } from './ledger.ts';
import { openLedger } from './test-helpers.ts';
import { closeLedger } from './transitions.ts';

test('close preserves the open checkpoint for a later reopen and records history', () => {
  const open = openLedger([{ path: 'app', branch: 'feature' }], { frontmatter: 'custom: keep\n' });
  const closed = closeLedger(open, {
    outcome: 'delivered',
    result: 'Released in v1',
    date: '2026-09-18',
    updatedAt: '2026-09-18T16:00:00+09:00',
  });
  const closedFrontmatter = parseFrontmatter(closed);
  assert.deepEqual(validateLedger(closedFrontmatter, 'ledger.md').diagnostics, []);
  assert.equal(closedFrontmatter.data?.['custom'], 'keep');
  assert.match(closed, /### Closed 2026-09-18/);

  assert.deepEqual((closedFrontmatter.data?.['grind'] as Record<string, unknown>)['resume'], {
    phase: 'implementation',
    current_task: 'Do the thing',
    next_action: 'Keep doing it',
  });
});
