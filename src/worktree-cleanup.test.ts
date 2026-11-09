import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { closeCommand } from './lifecycle-commands.ts';
import { commitState, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative, type TempWorkspace } from './test-helpers.ts';
import { pruneWorktreesCommand, worktreeRemovalCheck } from './worktree-cleanup.ts';
import { loadWorkspace, type Workspace } from './workspace.ts';
import { pathExists } from './paths.ts';

const FUTURE = () => Date.now() + 40 * 86_400_000;

async function setup(t: { after: (fn: () => Promise<void>) => void }): Promise<{ ws: TempWorkspace; workspace: Workspace; app: string }> {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const remote = path.join(ws.root, '.remotes', 'app.git');
  await mkdir(remote, { recursive: true });
  await git(remote, 'init', '-q', '--bare', '-b', 'main');
  const app = await makeCheckout(ws, 'app');
  await git(app, 'remote', 'add', 'origin', remote);
  await git(app, 'push', '-q', 'origin', 'main');
  await git(app, 'fetch', '-q', 'origin');
  await git(app, 'remote', 'set-head', 'origin', 'main');
  return { ws, workspace: await loadWorkspace({ cwd: ws.root }), app };
}

async function addWorktree(ws: TempWorkspace, app: string, name: string, options: { commit?: boolean; push?: boolean } = {}): Promise<string> {
  const dir = path.join(ws.root, '.worktrees', 'app', name);
  await git(app, 'worktree', 'add', '-q', '-b', name, dir, 'origin/main');
  if (options.commit === true) {
    await writeFile(path.join(dir, `${name}.txt`), name);
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-q', '-m', name);
  }
  if (options.push === true) await git(dir, 'push', '-q', '-u', 'origin', name);
  return dir;
}

test('removal check accepts only clean, pushed worktrees under the worktree root', async (t) => {
  const { ws, workspace, app } = await setup(t);
  const clean = await addWorktree(ws, app, 'clean', { commit: true, push: true });
  assert.deepEqual(await worktreeRemovalCheck(workspace, clean), { removable: true, reasons: [] });

  const dirty = await addWorktree(ws, app, 'dirty');
  await writeFile(path.join(dirty, 'README.md'), 'changed\n');
  assert.match((await worktreeRemovalCheck(workspace, dirty)).reasons.join(), /uncommitted/);

  const untracked = await addWorktree(ws, app, 'untracked');
  await writeFile(path.join(untracked, 'new.txt'), 'x');
  assert.equal((await worktreeRemovalCheck(workspace, untracked)).removable, false);

  const ignored = await addWorktree(ws, app, 'ignored');
  await writeFile(path.join(app, '.git', 'info', 'exclude'), 'node_modules/\n');
  await mkdir(path.join(ignored, 'node_modules'));
  await writeFile(path.join(ignored, 'node_modules', 'x.js'), 'x');
  assert.equal((await worktreeRemovalCheck(workspace, ignored)).removable, true);

  const unpushed = await addWorktree(ws, app, 'unpushed', { commit: true });
  assert.match((await worktreeRemovalCheck(workspace, unpushed)).reasons.join(), /not on any remote/);

  assert.match((await worktreeRemovalCheck(workspace, app)).reasons.join(), /under|linked/);

  const outside = path.join(ws.root, 'elsewhere');
  await git(app, 'worktree', 'add', '-q', '-b', 'outside', outside, 'origin/main');
  assert.match((await worktreeRemovalCheck(workspace, outside)).reasons.join(), /not under/);
});

test('removal check refuses a worktree with an operation in progress or a live process inside', async (t) => {
  const { ws, workspace, app } = await setup(t);
  const merging = await addWorktree(ws, app, 'merging');
  await writeFile(path.join(app, '.git', 'worktrees', 'merging', 'MERGE_HEAD'), (await git(merging, 'rev-parse', 'HEAD')) + '\n');
  assert.match((await worktreeRemovalCheck(workspace, merging)).reasons.join(), /MERGE_HEAD/);

  const busy = await addWorktree(ws, app, 'busy');
  const child = spawn('sleep', ['30'], { cwd: busy, stdio: 'ignore' });
  t.after(() => child.kill());
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match((await worktreeRemovalCheck(workspace, busy)).reasons.join(), /process/);
  child.kill();
});

test('prune selects merged, gone-upstream, and idle worktrees but not recent, owned, or linked-out ones', async (t) => {
  const { ws, workspace, app } = await setup(t);
  const merged = await addWorktree(ws, app, 'merged', { commit: true, push: true });
  await git(app, 'merge', '-q', '--ff-only', 'merged');
  await git(app, 'push', '-q', 'origin', 'main');
  await git(app, 'fetch', '-q', 'origin');

  const squashed = await addWorktree(ws, app, 'squashed', { commit: true, push: true });
  await git(app, 'merge', '-q', '--squash', 'squashed');
  await git(app, 'commit', '-q', '-m', 'squash');
  await git(app, 'push', '-q', 'origin', 'main');
  await git(app, 'push', '-q', 'origin', '--delete', 'squashed');
  await git(app, 'fetch', '-q', '--prune', 'origin');

  const idle = await addWorktree(ws, app, 'idle', { commit: true, push: true });
  const owned = await addWorktree(ws, app, 'owned', { commit: true, push: true });
  await writeInitiative(ws, 'app/owned', { ledger: openLedger([{ path: 'app', branch: 'owned' }]) });
  const outsideTarget = await makeCheckout(ws, 'other');
  await git(outsideTarget, 'worktree', 'add', '-q', '-b', 'linked', path.join(ws.root, 'escaped'));
  await mkdir(path.join(ws.root, '.worktrees', 'links'), { recursive: true });
  await symlink(path.join(ws.root, 'escaped'), path.join(ws.root, '.worktrees', 'links', 'escape'));

  const soon = await pruneWorktreesCommand(workspace, { dryRun: true });
  assert.deepEqual(soon.candidates, [], 'every worktree was just created');

  const later = await pruneWorktreesCommand(workspace, { dryRun: true, now: FUTURE(), idleDays: 14 });
  const reasons = Object.fromEntries(later.candidates.map((item) => [path.basename(item.path), item.reason]));
  assert.match(reasons['merged']!, /merged into origin\/main/);
  assert.match(reasons['squashed']!, /upstream branch was deleted/);
  assert.match(reasons['idle']!, /idle for/);
  assert.equal(reasons['owned'], undefined);
  assert.match(later.skipped.find((item) => item.path === owned)!.reasons.join(), /open init/);
  assert.equal([...later.candidates, ...later.skipped].some((item) => item.path.includes('escaped') || item.path.includes('links')), false);
  assert.ok(later.totalKb > 0);
  assert.equal(await pathExists(merged), true);

  const notYetIdle = await pruneWorktreesCommand(workspace, { dryRun: true, now: Date.now() + 5 * 86_400_000 });
  assert.deepEqual(notYetIdle.candidates.map((item) => path.basename(item.path)).sort(), ['merged', 'squashed']);

  const removal = await pruneWorktreesCommand(workspace, { dryRun: false, now: FUTURE() });
  assert.deepEqual(removal.failed, []);
  assert.equal(removal.removed.length, 3);
  for (const dir of [merged, squashed, idle]) assert.equal(await pathExists(dir), false);
  assert.equal(await pathExists(owned), true);
  assert.equal(await git(app, 'rev-parse', '--verify', 'squashed'), await git(app, 'rev-parse', 'squashed'));
});

test('close --remove-worktrees removes clean worktrees and keeps dirty ones without failing the close', async (t) => {
  const { ws, workspace, app } = await setup(t);
  const clean = await addWorktree(ws, app, 'clean-work', { commit: true, push: true });
  const dirty = await addWorktree(ws, app, 'dirty-work', { commit: true, push: true });
  await writeFile(path.join(dirty, 'wip.txt'), 'wip');
  await writeInitiative(ws, 'app/clean-work', { ledger: openLedger([{ path: 'app', branch: 'clean-work' }]) });
  await writeInitiative(ws, 'app/dirty-work', { ledger: openLedger([{ path: 'app', branch: 'dirty-work' }]) });
  await commitState(ws, 'initiatives');
  const context = { workspace, cwd: ws.root };
  const base = { outcome: 'abandoned' as const, result: 'superseded', notes: 'handled' as const, date: '2026-06-01' };

  const kept = await closeCommand(context, 'app/dirty-work', { ...base, removeWorktrees: true });
  assert.equal(kept.status, 'closed');
  assert.deepEqual(kept.worktrees?.removed, []);
  assert.match(kept.worktrees?.skipped[0]?.reasons.join() ?? '', /uncommitted/);
  assert.equal(await pathExists(dirty), true);

  const removed = await closeCommand(context, 'app/clean-work', { ...base, removeWorktrees: true });
  assert.deepEqual(removed.worktrees?.removed.map((item) => item.path), [clean]);
  assert.equal(await pathExists(clean), false);
  assert.equal(await git(app, 'branch', '--list', 'clean-work'), 'clean-work');

  await writeInitiative(ws, 'app/plain', { ledger: openLedger([{ path: 'app', branch: 'merged-x' }]) });
  await commitState(ws, 'plain');
  assert.equal((await closeCommand(context, 'app/plain', base)).worktrees, undefined);
});
