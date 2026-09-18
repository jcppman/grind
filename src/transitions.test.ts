import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrontmatter } from './frontmatter.ts';
import { validateLedger } from './ledger.ts';
import { openLedger } from './test-helpers.ts';
import { closeLedger, reopenLedger } from './transitions.ts';

test('close preserves the open checkpoint and reopen restores it with durable history', () => {
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

  const reopened = reopenLedger(closed, '2026-09-19T10:00:00+09:00');
  const validation = validateLedger(parseFrontmatter(reopened), 'ledger.md');
  assert.deepEqual(validation.diagnostics, []);
  assert.equal(validation.state?.phase, 'implementation');
  assert.equal(validation.state?.current_task, 'Do the thing');
  assert.equal(validation.state?.next_action, 'Keep doing it');
  assert.match(reopened, /### Reopened 2026-09-19/);
  assert.match(reopened, /Prior result: Released in v1/);
});
