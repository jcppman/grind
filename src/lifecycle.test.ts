import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { inspectInitiative } from './inspect.ts';
import { planStart } from './lifecycle.ts';
import { git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

async function plan(
  ws: Awaited<ReturnType<typeof makeTempWorkspace>>,
  id: string,
  dir: string,
) {
  const workspace = await loadWorkspace({ cwd: ws.root });
  const inspection = await inspectInitiative(workspace, { id, dir, archived: false });
  return planStart(workspace, inspection);
}

test('switch preflight refuses dirty checkout without changing files or index', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');
  await writeFile(path.join(app, 'staged.txt'), 'staged');
  await git(app, 'add', 'staged.txt');
  await writeFile(path.join(app, 'untracked.txt'), 'untracked');
  const before = await git(app, 'status', '--porcelain');

  const result = await plan(ws, 'app/x', dir);

  assert.match(result.blockers.join('\n'), /must switch but has 2 changed file/);
  assert.equal(await git(app, 'status', '--porcelain'), before);
  assert.equal(await git(app, 'symbolic-ref', '--short', 'HEAD'), 'main');
});

test('matching dirty checkout is allowed because no branch change is needed', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app', 'feature');
  await writeFile(path.join(app, 'untracked.txt'), 'keep');

  const result = await plan(ws, 'app/x', dir);

  assert.deepEqual(result.blockers, []);
  assert.equal(result.checkouts[0]?.action, 'stay');
  assert.equal(result.checkouts[0]?.targetSource, 'current');
});

test('switch preflight refuses duplicate target ownership', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await writeInitiative(ws, 'app/y', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');

  const result = await plan(ws, 'app/x', dir);

  assert.match(result.blockers.join('\n'), /conflicting owners: app\/x, app\/y/);
});

test('switch preflight refuses target branch checked out in another worktree', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');
  const occupied = path.join(ws.root, 'occupied');
  await git(app, 'worktree', 'add', '-q', occupied, 'feature');

  const result = await plan(ws, 'app/x', dir);

  assert.match(result.blockers.join('\n'), /branch feature is checked out/);
});
