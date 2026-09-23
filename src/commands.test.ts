import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { listCommand, startCommand, statusCommand } from './commands.ts';
import { closedLedger, git, makeCheckout, makeSymlink, makeTempWorkspace, openLedger, writeInitiative, writeSidecar } from './test-helpers.ts';
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

test('status resolves from a checkout and merges resolution diagnostics', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app', 'feature');
  await writeSidecar(app, 'app/gone');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const result = await statusCommand({ workspace, cwd: path.join(app) });
  assert.equal(result.inspection.id, 'app/x');
  assert.equal(result.resolution.source, 'branch');
  assert.equal(result.resolution.stalePointer?.pointed, 'app/gone');
  assert.ok(result.inspection.diagnostics.some((d) => d.code === 'STALE_POINTER'));
  assert.ok(result.inspection.diagnostics.some((d) => d.code === 'POINTER_MISMATCH'));
});

test('start enters a clean open initiative and never switches', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app', 'feature');
  await writeSidecar(app, 'app/x', '## @README.md#1\n\nlook\n');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const result = await startCommand({ workspace, cwd: ws.root }, 'app/x');
  assert.equal(result.switched, false);
  assert.equal(result.pendingNotes, 1);
  assert.equal(await git(app, 'symbolic-ref', '--short', 'HEAD'), 'feature');
});

test('start refuses closed, archived, unsafe mismatched, and missing checkouts without changing anything', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'app/closed', { ledger: closedLedger([{ path: 'app', branch: 'main' }]) });
  await writeInitiative(ws, '_archive/app/old');
  await writeInitiative(ws, 'app/mismatch', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await writeInitiative(ws, 'app/missing', { ledger: openLedger([{ path: 'nowhere', branch: 'main' }]) });
  const app = await makeCheckout(ws, 'app', 'main');
  await git(app, 'branch', 'feature');
  await writeFile(path.join(app, 'README.md'), 'unfinished work\n');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: ws.root };
  await assert.rejects(startCommand(context, 'app/closed'), { code: 'ARTIFACT_INVALID' });
  await assert.rejects(startCommand(context, '_archive/app/old'), { code: 'TRANSITION_UNSUPPORTED' });
  await assert.rejects(startCommand(context, 'app/mismatch'), (error: { code: string; details: { blockers: string[] } }) => {
    assert.equal(error.code, 'START_BLOCKED');
    return true;
  });
  await assert.rejects(startCommand(context, 'app/missing'), { code: 'START_BLOCKED' });
  assert.equal(await git(app, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(await git(app, 'status', '--porcelain'), 'M README.md');
});
