import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inspectInitiative } from './inspect.ts';
import { planStart, withLockedStartPlan } from './lifecycle.ts';
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

test('switch preflight distinguishes remote target branches from new branches based on remote default', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const remote = await mkdtemp(path.join(tmpdir(), 'grind-remote-'));
  t.after(() => rm(remote, { recursive: true, force: true }));
  await git(remote, 'init', '--bare', '-q');
  await git(app, 'remote', 'add', 'origin', remote);
  await git(app, 'push', '-q', '-u', 'origin', 'main');
  await git(app, 'branch', 'feature');
  await git(app, 'push', '-q', 'origin', 'feature');
  await git(app, 'branch', '-D', 'feature');
  await git(app, 'remote', 'set-head', 'origin', 'main');
  const remoteDir = await writeInitiative(ws, 'app/remote', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const newDir = await writeInitiative(ws, 'app/new', { ledger: openLedger([{ path: 'app', branch: 'new-work' }]) });

  assert.equal((await plan(ws, 'app/remote', remoteDir)).checkouts[0]?.targetSource, 'remote');
  assert.equal((await plan(ws, 'app/new', newDir)).checkouts[0]?.targetSource, 'remote-default');
});

test('switch preflight refuses in-progress Git operations and a tracked sidecar', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');
  await writeFile(path.join(app, '.grind.md'), '---\ninitiative: app/x\n---\n');
  await git(app, 'add', '.grind.md');
  await git(app, 'commit', '-q', '-m', 'track sidecar');
  const mergeHead = await git(app, 'rev-parse', '--git-path', 'MERGE_HEAD');
  await writeFile(path.resolve(app, mergeHead), '0000000000000000000000000000000000000000\n');

  const result = await plan(ws, 'app/x', dir);

  assert.match(result.blockers.join('\n'), /in-progress Git operation \(MERGE_HEAD\)/);
  assert.match(result.blockers.join('\n'), /tracks \.grind\.md/);
});

test('locked start plan revalidates checkout state after acquiring locks', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const inspection = await inspectInitiative(workspace, { id: 'app/x', dir, archived: false });
  await writeFile(path.join(app, 'late.txt'), 'changed after initial inspection');

  await assert.rejects(withLockedStartPlan(workspace, inspection, 'test', async () => {}), (error: { code: string; details: { blockers: string[] } }) => {
    assert.equal(error.code, 'START_BLOCKED');
    assert.match(error.details.blockers.join('\n'), /must switch but has 1 changed file/);
    return true;
  });
});

test('switch preflight catches an ignored file that would obstruct checkout', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app');
  await git(app, 'checkout', '-q', '-b', 'feature');
  await writeFile(path.join(app, 'blocked.txt'), 'tracked on feature');
  await git(app, 'add', 'blocked.txt');
  await git(app, 'commit', '-q', '-m', 'feature file');
  await git(app, 'checkout', '-q', 'main');
  const gitDir = await git(app, 'rev-parse', '--git-dir');
  await writeFile(path.resolve(app, gitDir, 'info', 'exclude'), 'blocked.txt\n');
  await writeFile(path.join(app, 'blocked.txt'), 'ignored local file');

  const result = await plan(ws, 'app/x', dir);

  assert.match(result.blockers.join('\n'), /cannot switch cleanly/);
  assert.equal(await readFile(path.join(app, 'blocked.txt'), 'utf8'), 'ignored local file');
  assert.equal(await git(app, 'symbolic-ref', '--short', 'HEAD'), 'main');
});
