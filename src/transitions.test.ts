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

test('manual verification gates delivery but permits deliberate abandonment', () => {
  const input = { outcome: 'delivered' as const, result: 'done', date: '2026-10-27', updatedAt: '2026-10-27T00:00:00Z' };
  const pending = openLedger().replace('status: open', 'status: open\n  need_verify: true');
  for (const raw of [pending, pending.replace('need_verify: true', 'need_verify: true\n  verified: false')]) {
    assert.throws(() => closeLedger(raw, input), { code: 'VERIFICATION_REQUIRED' });
  }
  const verified = pending.replace('need_verify: true', 'need_verify: true\n  verified: true');
  assert.equal(validateLedger(parseFrontmatter(closeLedger(verified, input)), 'ledger.md').state?.verified, true);
  assert.equal(validateLedger(parseFrontmatter(closeLedger(pending, { ...input, outcome: 'abandoned' })), 'ledger.md').state?.closed?.outcome, 'abandoned');
  assert.throws(() => closeLedger(pending.replace('need_verify: true', 'need_verify: "true"'), input), { code: 'ARTIFACT_INVALID' });
});
