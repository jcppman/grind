import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { listCommand, statusCommand } from './commands.ts';
import { formatStatus } from './format.ts';
import { closedLedger, git, makeCheckout, makeSymlink, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

test('list keeps malformed entries and reports listing problems', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'app/good', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  await writeInitiative(ws, 'app/bad', { ledger: openLedger().replace('status: open', 'status: weird') });
  await writeInitiative(ws, 'app/done', { ledger: closedLedger() });
  await writeInitiative(ws, '_archive/app/old');
  await makeSymlink(ws.root, path.join(ws.initiativesDir, 'link'));
  const workspace = await loadWorkspace({ cwd: ws.root });
  const result = await listCommand({ workspace, cwd: ws.root });
  assert.deepEqual(
    result.initiatives.map((i) => [i.id, i.status, i.diagnostics.map((d) => d.code)]),
    [
      ['app/bad', null, ['INVALID_STATUS']],
      ['app/done', 'closed', []],
      ['app/good', 'open', []],
    ],
  );
  assert.equal(result.initiatives.find((i) => i.id === 'app/good')?.next_action, 'Keep doing it');
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['SYMLINK_NOT_ALLOWED']);
});

test('list filters by parent or exact scope and ledger status', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'audio/rytho/open', { ledger: openLedger() });
  await writeInitiative(ws, 'audio/rytho/closed', { ledger: closedLedger() });
  await writeInitiative(ws, 'audio/other', { ledger: openLedger() });
  await writeInitiative(ws, 'video/rytho', { ledger: closedLedger() });
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: ws.root };

  assert.deepEqual((await listCommand(context, { scope: 'audio' })).initiatives.map((i) => i.id), [
    'audio/other',
    'audio/rytho/closed',
    'audio/rytho/open',
  ]);
  assert.deepEqual((await listCommand(context, { scope: 'audio/rytho', status: 'open' })).initiatives.map((i) => i.id), [
    'audio/rytho/open',
  ]);
  assert.deepEqual((await listCommand(context, { scope: 'audio/other', status: 'open' })).initiatives.map((i) => i.id), [
    'audio/other',
  ]);
  assert.deepEqual((await listCommand(context, { scope: 'audio', status: 'closed' })).initiatives.map((i) => i.id), [
    'audio/rytho/closed',
  ]);
});

test('status inside a repository names the branch owner and where its other inits live', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await writeInitiative(ws, 'app/y', { ledger: openLedger([{ path: 'app', branch: 'other' }]) });
  await writeInitiative(ws, 'app/z', { ledger: openLedger([{ path: 'app', branch: 'later' }]) });
  await writeInitiative(ws, 'app/done', { ledger: closedLedger([{ path: 'app', branch: 'old' }]) });
  const app = await makeCheckout(ws, 'app', 'feature');
  const other = path.join(ws.root, '.worktrees', 'app', 'y');
  await git(app, 'worktree', 'add', '-q', '-b', 'other', other);
  const workspace = await loadWorkspace({ cwd: ws.root });

  const fromCanonical = await statusCommand({ workspace, cwd: app });
  assert.equal(fromCanonical.kind, 'repository');
  if (fromCanonical.kind !== 'repository') return;
  assert.equal(fromCanonical.owner?.id, 'app/x');
  assert.equal(fromCanonical.checkout.kind, 'canonical');
  assert.deepEqual(fromCanonical.initiatives.map((item) => [item.id, item.path, item.kind]), [['app/y', other, 'grind'], ['app/z', null, null]]);
  assert.match(formatStatus(fromCanonical, { color: false }), /app\/y\s+other: worktree\s/);

  const fromWorktree = await statusCommand({ workspace, cwd: path.join(other) });
  assert.equal(fromWorktree.kind === 'repository' && fromWorktree.owner?.id, 'app/y');

  const explicit = await statusCommand({ workspace, cwd: app }, 'app/x');
  assert.equal(explicit.kind, 'initiative');
});
