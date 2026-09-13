import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrontmatter } from './frontmatter.ts';
import { validateLedger } from './ledger.ts';
import { closedLedger, openLedger } from './test-helpers.ts';

const validate = (raw: string) => validateLedger(parseFrontmatter(raw), 'ledger.md');
const codes = (raw: string) => validate(raw).diagnostics.map((d) => d.code);

test('valid open ledger with an empty repository list', () => {
  const result = validate(openLedger());
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.state?.status, 'open');
  assert.deepEqual(result.state?.repositories, []);
});

test('valid open ledger parses repository entries', () => {
  const result = validate(openLedger([{ path: 'grind', branch: 'main', pull_request: '"https://x/1"' }]));
  assert.deepEqual(result.state?.repositories, [
    { path: 'grind', branch: 'main', checkout: 'clone', pull_request: 'https://x/1' },
  ]);
});

test('valid closed ledger', () => {
  const result = validate(closedLedger());
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.state?.closed, { date: '2026-09-01', outcome: 'delivered' });
  assert.equal(result.state?.phase, null);
});

test('open ledger with closure fields is rejected', () => {
  assert.ok(codes(openLedger([], { frontmatter: '  result: done\n' })).includes('OPEN_WITH_CLOSURE'));
});

test('closed ledger with open fields is rejected', () => {
  const raw = closedLedger().replace('  result: Shipped in v1\n', '  result: Shipped in v1\n  phase: implementation\n');
  assert.ok(codes(raw).includes('CLOSED_WITH_OPEN_FIELDS'));
});

test('missing open fields are each reported', () => {
  const raw = openLedger().replace('  phase: implementation\n', '').replace('  next_action: Keep doing it\n', '');
  const result = codes(raw);
  assert.equal(result.filter((c) => c === 'MISSING_OPEN_FIELD').length, 2);
});

test('timestamp without offset is rejected', () => {
  const raw = openLedger().replace('"2026-09-13T10:00:00+09:00"', '"2026-09-13T10:00:00"');
  assert.ok(codes(raw).includes('INVALID_TIMESTAMP'));
});

test('invalid status is rejected', () => {
  assert.ok(codes(openLedger().replace('status: open', 'status: active')).includes('INVALID_STATUS'));
});

test('duplicate repository paths are rejected', () => {
  const raw = openLedger([
    { path: 'grind', branch: 'a' },
    { path: './grind/', branch: 'b' },
  ]);
  assert.ok(codes(raw).includes('DUPLICATE_REPOSITORY'));
});

test('repository path escaping the workspace is rejected', () => {
  assert.ok(codes(openLedger([{ path: '../other', branch: 'main' }])).includes('INVALID_REPOSITORY_PATH'));
  assert.ok(codes(openLedger([{ path: '/abs', branch: 'main' }])).includes('INVALID_REPOSITORY_PATH'));
});

test('worktree checkout escaping the workspace is rejected', () => {
  const raw = openLedger([{ path: 'grind', branch: 'main', checkout: '../../elsewhere' }]);
  assert.ok(codes(raw).includes('INVALID_REPOSITORY_CHECKOUT'));
  const ok = validate(openLedger([{ path: 'grind', branch: 'main', checkout: 'wt/grind-bootstrap' }]));
  assert.deepEqual(ok.diagnostics, []);
});

test('worktree checkout inside the state directory is rejected', () => {
  const raw = openLedger([{ path: 'grind', branch: 'main', checkout: './yyu-dev/grind-state/wt' }]);
  const result = validateLedger(parseFrontmatter(raw), 'ledger.md', { statePathFromWorkspace: 'yyu-dev/grind-state' });
  assert.ok(result.diagnostics.some((d) => d.code === 'CHECKOUT_IN_STATE'));
  const sibling = openLedger([{ path: 'grind', branch: 'main', checkout: 'yyu-dev/grind-state-wt' }]);
  assert.deepEqual(validateLedger(parseFrontmatter(sibling), 'ledger.md', { statePathFromWorkspace: 'yyu-dev/grind-state' }).diagnostics, []);
});

test('branch with whitespace or control characters is rejected', () => {
  assert.ok(codes(openLedger([{ path: 'grind', branch: '"main "' }])).includes('INVALID_REPOSITORY_BRANCH'));
  assert.ok(codes(openLedger([{ path: 'grind', branch: '"feat\\tx"' }])).includes('INVALID_REPOSITORY_BRANCH'));
  assert.deepEqual(codes(openLedger([{ path: 'grind', branch: 'feat/x-1' }])), []);
});


test('repositories must be a list', () => {
  const raw = openLedger().replace('  repositories: []\n', '  repositories: none\n');
  assert.ok(codes(raw).includes('INVALID_REPOSITORIES'));
});

test('legacy frontmatter-free record is a warning, not an error', () => {
  const result = validate('# Initiative Ledger\n\nStatus: open\nPhase: design\n\n## Tracking\n');
  assert.equal(result.legacy, true);
  assert.equal(result.state, null);
  assert.deepEqual(result.diagnostics.map((d) => [d.severity, d.code]), [['warning', 'LEGACY_RECORD']]);
});

test('legacy fields alongside grind frontmatter conflict', () => {
  const result = validate(openLedger([], { body: '\nStatus: closed\n' }));
  assert.ok(result.diagnostics.some((d) => d.code === 'LEGACY_CONFLICT' && d.severity === 'error'));
  assert.equal(result.state, null);
});

test('frontmatter without a grind block is an error', () => {
  assert.ok(codes('---\ntype: Initiative Ledger\n---\n').includes('MISSING_GRIND_STATE'));
});
