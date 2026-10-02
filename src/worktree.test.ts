import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parseFrontmatter } from './frontmatter.ts';
import { validateLedger } from './ledger.ts';
import { addNote, listNotes } from './notes.ts';
import { commitState, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative, type TempWorkspace } from './test-helpers.ts';
import { loadWorkspace, type Workspace } from './workspace.ts';
import { switchCommand, worktreeCommand } from './worktree.ts';

async function setup(t: { after: (fn: () => Promise<void>) => void }): Promise<{ ws: TempWorkspace; workspace: Workspace }> {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  return { ws, workspace: await loadWorkspace({ cwd: ws.root }) };
}

/** A checkout whose origin is a bare repository with `main` as its default branch. */
async function makeCloned(ws: TempWorkspace, relativePath: string): Promise<string> {
  const remote = path.join(ws.root, '.remotes', `${relativePath.replaceAll('/', '-')}.git`);
  await mkdir(remote, { recursive: true });
  await git(remote, 'init', '-q', '--bare', '-b', 'main');
  const checkout = await makeCheckout(ws, relativePath);
  await git(checkout, 'remote', 'add', 'origin', remote);
  await git(checkout, 'push', '-q', 'origin', 'main');
  await git(checkout, 'fetch', '-q', 'origin');
  await git(checkout, 'remote', 'set-head', 'origin', 'main');
  return checkout;
}

async function commitFile(dir: string, file: string, content: string): Promise<void> {
  await writeFile(path.join(dir, file), content);
  await git(dir, 'add', file);
  await git(dir, 'commit', '-q', '-m', file);
}

const ledgerOf = async (dir: string) => validateLedger(parseFrontmatter(await readFile(path.join(dir, 'ledger.md'), 'utf8')), 'ledger.md');

test('worktree creates the standard worktree for an existing branch and is idempotent', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'audio/app');
  await git(app, 'branch', 'feature');
  await writeInitiative(ws, 'audio/app/feature-work', { ledger: openLedger([{ path: 'audio/app', branch: 'feature' }]) });
  const context = { workspace, cwd: ws.root };

  const created = await worktreeCommand(context, 'feature-work');
  const expected = path.join(ws.root, '.worktrees', 'audio', 'app', 'feature-work');
  assert.equal(created.path, expected);
  assert.equal(created.created, true);
  assert.equal(created.branchOrigin, 'local');
  assert.equal(await git(expected, 'branch', '--show-current'), 'feature');
  assert.equal(await git(app, 'branch', '--show-current'), 'main');

  const again = await worktreeCommand(context, 'audio/app/feature-work');
  assert.deepEqual([again.path, again.created, again.kind], [expected, false, 'grind']);
});

test('worktree reports an existing worktree wherever it is and refuses the canonical checkout', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'held');
  const elsewhere = path.join(ws.root, 'app-elsewhere');
  await git(app, 'worktree', 'add', '-q', '-b', 'side', elsewhere);
  await writeInitiative(ws, 'held', { ledger: openLedger([{ path: 'app', branch: 'held' }]) });
  await writeInitiative(ws, 'side', { ledger: openLedger([{ path: 'app', branch: 'side' }]) });
  const context = { workspace, cwd: ws.root };

  await assert.rejects(worktreeCommand(context, 'held'), { code: 'CHECKOUT_HELD' });
  const side = await worktreeCommand(context, 'side');
  assert.deepEqual([side.path, side.kind, side.created], [elsewhere, 'other', false]);
});

test('worktree creates missing branches from the remote branch or the remote default without tracking the default', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCloned(ws, 'app');
  await git(app, 'checkout', '-q', '-b', 'pushed');
  await commitFile(app, 'pushed.txt', 'pushed\n');
  await git(app, 'push', '-q', 'origin', 'pushed');
  await git(app, 'checkout', '-q', 'main');
  await git(app, 'branch', '-q', '-D', 'pushed');
  await writeInitiative(ws, 'pushed', { ledger: openLedger([{ path: 'app', branch: 'pushed' }]) });
  await writeInitiative(ws, 'fresh', { ledger: openLedger([{ path: 'app', branch: 'fresh' }]) });
  const context = { workspace, cwd: ws.root };

  const pushed = await worktreeCommand(context, 'pushed');
  assert.equal(pushed.branchOrigin, 'remote');
  assert.equal(await git(pushed.path, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/pushed');
  const fresh = await worktreeCommand(context, 'fresh');
  assert.equal(fresh.branchOrigin, 'remote-default');
  assert.equal(await git(fresh.path, 'rev-parse', 'HEAD'), await git(app, 'rev-parse', 'origin/main'));
  await assert.rejects(git(fresh.path, 'rev-parse', '--abbrev-ref', '@{upstream}'));
});

test('worktree records a branch named after the init when the repository is not tracked yet', async (t) => {
  const { ws, workspace } = await setup(t);
  await makeCloned(ws, 'app');
  await makeCheckout(ws, 'lib');
  const dir = await writeInitiative(ws, 'group/new-thing', { ledger: openLedger() });
  await commitState(ws);
  const context = { workspace, cwd: ws.root };

  await assert.rejects(worktreeCommand(context, 'new-thing'), { code: 'USAGE' });
  const result = await worktreeCommand({ workspace, cwd: path.join(ws.root, 'lib') }, 'new-thing', { repository: '../app' });
  assert.equal(result.recorded, true);
  assert.equal(result.branch, 'new-thing');
  assert.equal(result.path, path.join(ws.root, '.worktrees', 'app', 'new-thing'));
  const ledger = await ledgerOf(dir);
  assert.deepEqual(ledger.diagnostics, []);
  assert.deepEqual(ledger.state?.repositories, [{ path: 'app', branch: 'new-thing', pull_request: null }]);
  assert.match(await readFile(path.join(dir, 'ledger.md'), 'utf8'), /^# Initiative Ledger$/m);

  await worktreeCommand(context, 'new-thing', { repository: 'lib' });
  await assert.rejects(worktreeCommand(context, 'new-thing'), { code: 'USAGE' });
  assert.equal((await worktreeCommand(context, 'new-thing', { repository: 'app' })).recorded, false);
});

test('worktree refuses a standard path that already holds something else', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');
  await writeInitiative(ws, 'work', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await mkdir(path.join(ws.root, '.worktrees', 'app', 'work'), { recursive: true });
  await assert.rejects(worktreeCommand({ workspace, cwd: ws.root }, 'work'), { code: 'USAGE' });
});

test('worktree mirrors directory instructions under the worktree root without replacing files', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'org/team/app');
  await git(app, 'branch', 'feature');
  await writeFile(path.join(ws.root, 'CLAUDE.md'), 'root\n');
  await writeFile(path.join(ws.root, 'org', 'CLAUDE.md'), 'org\n');
  await writeFile(path.join(ws.root, 'org', 'AGENTS.md'), 'org agents\n');
  await writeFile(path.join(ws.root, 'org', 'team', 'AGENTS.md'), 'team\n');
  await writeInitiative(ws, 'work', { ledger: openLedger([{ path: 'org/team/app', branch: 'feature' }]) });
  const root = path.join(ws.root, '.worktrees');
  await mkdir(path.join(root, 'org', 'team'), { recursive: true });
  await writeFile(path.join(root, 'org', 'team', 'AGENTS.md'), 'local copy\n');
  await symlink(path.join(ws.root, 'CLAUDE.md'), path.join(root, 'org', 'AGENTS.md'));

  const first = await worktreeCommand({ workspace, cwd: ws.root }, 'work');
  const status = Object.fromEntries(first.instructionLinks.map((link) => [path.relative(root, link.link), link.status]));
  assert.deepEqual(status, { 'org/CLAUDE.md': 'created', 'org/AGENTS.md': 'replaced', 'org/team/AGENTS.md': 'blocked' });
  assert.equal(await readlink(path.join(root, 'org', 'CLAUDE.md')), path.join('..', '..', 'org', 'CLAUDE.md'));
  assert.equal(await readFile(path.join(root, 'org', 'AGENTS.md'), 'utf8'), 'org agents\n');
  assert.equal(await readFile(path.join(root, 'org', 'team', 'AGENTS.md'), 'utf8'), 'local copy\n');
  assert.ok(first.warnings.some((warning) => warning.includes('team/AGENTS.md')));
  assert.equal(await lstat(path.join(root, 'CLAUDE.md')).catch(() => null), null);

  const second = await worktreeCommand({ workspace, cwd: ws.root }, 'work');
  assert.deepEqual(second.instructionLinks.map((link) => link.status), ['exists', 'exists', 'blocked']);
});

async function changeEverything(dir: string, tag: string): Promise<void> {
  await writeFile(path.join(dir, 'staged.txt'), `staged ${tag}\n`);
  await git(dir, 'add', 'staged.txt');
  await writeFile(path.join(dir, 'README.md'), `unstaged ${tag}\n`);
  await writeFile(path.join(dir, `untracked-${tag}.txt`), `untracked ${tag}\n`);
}

async function assertChanges(dir: string, tag: string): Promise<void> {
  assert.equal(await git(dir, 'diff', '--cached', '--name-only'), 'staged.txt');
  assert.equal(await git(dir, 'diff', '--name-only'), 'README.md');
  assert.equal(await readFile(path.join(dir, 'README.md'), 'utf8'), `unstaged ${tag}\n`);
  assert.equal(await readFile(path.join(dir, `untracked-${tag}.txt`), 'utf8'), `untracked ${tag}\n`);
}

test('switch swaps foreground and background work with staged, unstaged, and untracked changes intact', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'x-branch');
  const yDir = path.join(ws.root, '.worktrees', 'app', 'y');
  await git(app, 'worktree', 'add', '-q', '-b', 'y-branch', yDir);
  await commitFile(yDir, 'y.txt', 'y\n');
  await writeInitiative(ws, 'x', { ledger: openLedger([{ path: 'app', branch: 'x-branch' }]) });
  await writeInitiative(ws, 'y', { ledger: openLedger([{ path: 'app', branch: 'y-branch' }]) });
  const context = { workspace, cwd: app };
  await addNote({ workspace, cwd: yDir }, { file: 'y.txt', start: 1, end: 1, comment: 'Check y' });
  await changeEverything(app, 'x');
  await changeEverything(yDir, 'y');

  await assert.rejects(switchCommand(context, 'y'), { code: 'SWITCH_BLOCKED' });
  assert.equal(await git(app, 'branch', '--show-current'), 'x-branch');
  await assertChanges(app, 'x');

  const result = await switchCommand(context, 'y', { force: true });
  assert.equal(result.switched, true);
  assert.deepEqual(result.takenFrom, { path: yDir, kind: 'grind', released: 'detached' });
  assert.equal(await git(yDir, 'branch', '--show-current'), '');
  const xDir = path.join(ws.root, '.worktrees', 'app', 'x');
  assert.deepEqual(result.previous, { branch: 'x-branch', initiative: 'x', path: xDir });
  assert.equal(await git(app, 'branch', '--show-current'), 'y-branch');
  await assertChanges(app, 'y');
  assert.equal(await git(xDir, 'branch', '--show-current'), 'x-branch');
  await assertChanges(xDir, 'x');
  assert.equal(await git(app, 'stash', 'list'), '');
  assert.equal((await listNotes(context, 'y')).notes[0]?.file, path.join(app, 'y.txt'));

  const back = await switchCommand({ workspace, cwd: xDir }, 'x', { force: true });
  assert.equal(back.previous?.path, yDir);
  assert.equal(await git(app, 'branch', '--show-current'), 'x-branch');
  await assertChanges(app, 'x');
  await assertChanges(yDir, 'y');
  assert.equal((await listNotes(context, 'y')).notes[0]?.file, path.join(yDir, 'y.txt'));
  assert.equal((await switchCommand(context, 'x')).switched, false);
});

test('switch refuses unowned changes and in-progress operations without changing anything', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'mine');
  await git(app, 'branch', 'target');
  await writeInitiative(ws, 'target', { ledger: openLedger([{ path: 'app', branch: 'target' }]) });
  const context = { workspace, cwd: app };
  await writeFile(path.join(app, 'README.md'), 'my own edit\n');
  await assert.rejects(switchCommand(context, 'target'), (error: { code: string; message: string }) => {
    assert.equal(error.code, 'SWITCH_BLOCKED');
    assert.match(error.message, /no init owns/);
    return true;
  });
  await git(app, 'checkout', '-q', '--', 'README.md');
  await writeFile(path.join(app, '.git', 'MERGE_HEAD'), `${await git(app, 'rev-parse', 'HEAD')}\n`);
  await assert.rejects(switchCommand(context, 'target'), { code: 'SWITCH_BLOCKED' });
  assert.equal(await git(app, 'branch', '--show-current'), 'mine');
  assert.equal(await git(app, 'stash', 'list'), '');
});

test('switch leaves a clean unowned branch in place and creates a missing target from the remote default', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCloned(ws, 'app');
  await git(app, 'checkout', '-q', '-b', 'scratch');
  await writeInitiative(ws, 'brand-new', { ledger: openLedger([{ path: 'app', branch: 'brand-new' }]) });
  const result = await switchCommand({ workspace, cwd: app }, 'brand-new');
  assert.equal(result.branchOrigin, 'remote-default');
  assert.deepEqual(result.previous, { branch: 'scratch', initiative: null, path: null });
  assert.equal(await git(app, 'branch', '--show-current'), 'brand-new');
  assert.match(await git(app, 'branch', '--list', 'scratch'), /scratch/);
});

test('switch blocks while a process works in the target worktree and detaches app worktrees in place', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app');
  const appTree = path.join(app, '.claude', 'worktrees', 'session');
  await git(app, 'worktree', 'add', '-q', '-b', 'agent-branch', appTree);
  await writeInitiative(ws, 'agent', { ledger: openLedger([{ path: 'app', branch: 'agent-branch' }]) });
  const context = { workspace, cwd: app };

  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: appTree, stdio: 'ignore' });
  t.after(() => { child.kill(); });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await assert.rejects(switchCommand(context, 'agent', { force: true }), (error: { code: string; details: { pids: number[] } }) => {
    assert.equal(error.code, 'SWITCH_BLOCKED');
    assert.ok(error.details.pids.includes(child.pid as number));
    return true;
  });
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));

  const result = await switchCommand(context, 'agent', { force: true });
  assert.deepEqual(result.takenFrom, { path: appTree, kind: 'app', released: 'detached' });
  assert.equal(await git(app, 'branch', '--show-current'), 'agent-branch');
  assert.equal(await git(appTree, 'branch', '--show-current'), '');
});

test('switch stashes an owned checkout around a nested app worktree without touching it', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'mine');
  await git(app, 'branch', 'target');
  const nested = path.join(app, '.claude', 'worktrees', 'other');
  await git(app, 'worktree', 'add', '-q', '-b', 'side', nested);
  await writeFile(path.join(nested, 'side.txt'), 'agent work\n');
  await writeInitiative(ws, 'mine', { ledger: openLedger([{ path: 'app', branch: 'mine' }]) });
  await writeInitiative(ws, 'target', { ledger: openLedger([{ path: 'app', branch: 'target' }]) });
  await writeFile(path.join(app, 'README.md'), 'mine\n');
  await switchCommand({ workspace, cwd: app }, 'target');
  assert.equal(await readFile(path.join(ws.root, '.worktrees', 'app', 'mine', 'README.md'), 'utf8'), 'mine\n');
  assert.equal(await readFile(path.join(nested, 'side.txt'), 'utf8'), 'agent work\n');
  assert.equal(await git(nested, 'branch', '--show-current'), 'side');
});

test('a blocked switch leaves an untracked repository unrecorded', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'loose');
  const dir = await writeInitiative(ws, 'fresh', { ledger: openLedger() });
  await writeFile(path.join(app, 'README.md'), 'unowned\n');
  await assert.rejects(switchCommand({ workspace, cwd: app }, 'fresh'), { code: 'SWITCH_BLOCKED' });
  assert.deepEqual((await ledgerOf(dir)).state?.repositories, []);
  await git(app, 'checkout', '--', 'README.md');
  assert.equal((await switchCommand({ workspace, cwd: app }, 'fresh')).recorded, true);
  assert.deepEqual((await ledgerOf(dir)).state?.repositories, [{ path: 'app', branch: 'fresh', pull_request: null }]);
});

test('recorded repository paths resolve from the workspace root, not the current directory', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');
  const decoy = await makeCheckout(ws, 'web/app');
  await writeInitiative(ws, 'work', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const result = await worktreeCommand({ workspace, cwd: path.join(ws.root, 'web') }, 'work');
  assert.equal(result.repository, 'app');
  assert.equal((await git(decoy, 'worktree', 'list')).split('\n').length, 1);
});

test('switch keeps ignored files of the worktree it takes a branch from and reuses it later', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'main');
  await commitFile(app, '.gitignore', '.env\n');
  await git(app, 'branch', 'feature');
  await writeInitiative(ws, 'mainline', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  await writeInitiative(ws, 'feature-work', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const context = { workspace, cwd: ws.root };
  const tree = (await worktreeCommand(context, 'feature-work')).path;
  await writeFile(path.join(tree, '.env'), 'SECRET=1\n');

  await switchCommand({ workspace, cwd: app }, 'feature-work', { force: true });
  assert.equal(await readFile(path.join(tree, '.env'), 'utf8'), 'SECRET=1\n');
  await switchCommand({ workspace, cwd: app }, 'mainline', { force: true });
  assert.equal(await git(tree, 'branch', '--show-current'), 'feature');
  assert.equal(await readFile(path.join(tree, '.env'), 'utf8'), 'SECRET=1\n');
  assert.equal((await worktreeCommand(context, 'feature-work')).path, tree);
});

test('a deleted worktree is not reported as the working path and is recreated', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app');
  await git(app, 'branch', 'feature');
  await writeInitiative(ws, 'work', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const context = { workspace, cwd: ws.root };
  const first = await worktreeCommand(context, 'work');
  await rm(first.path, { recursive: true, force: true });
  const again = await worktreeCommand(context, 'work');
  assert.deepEqual([again.path, again.created], [first.path, true]);
  assert.equal(await git(again.path, 'branch', '--show-current'), 'feature');

  await rm(again.path, { recursive: true, force: true });
  const switched = await switchCommand({ workspace, cwd: app }, 'work');
  assert.equal(switched.takenFrom, null);
  assert.equal(await git(app, 'branch', '--show-current'), 'feature');
});

test('switch never takes over an existing stash when nothing could be stashed', async (t) => {
  const { ws, workspace } = await setup(t);
  const sub = await makeCheckout(ws, 'sub-source');
  const app = await makeCheckout(ws, 'app', 'owned');
  await git(app, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sub');
  await git(app, 'commit', '-q', '-m', 'submodule');
  await git(app, 'branch', 'target');
  await writeFile(path.join(app, 'README.md'), 'older user work\n');
  await git(app, 'stash', 'push', '-q', '-m', 'unrelated user stash');
  await writeFile(path.join(app, 'sub', 'dirty.txt'), 'untracked in submodule\n');
  await writeInitiative(ws, 'owned', { ledger: openLedger([{ path: 'app', branch: 'owned' }]) });
  await writeInitiative(ws, 'target', { ledger: openLedger([{ path: 'app', branch: 'target' }]) });

  await switchCommand({ workspace, cwd: app }, 'target');
  assert.match(await git(app, 'stash', 'list'), /unrelated user stash/);
  assert.equal(await readFile(path.join(ws.root, '.worktrees', 'app', 'owned', 'README.md'), 'utf8'), '# app\n');
});

test('recovery restores in place when the switch stops before the canonical checkout moves', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'x-branch');
  const yDir = path.join(ws.root, '.worktrees', 'app', 'y');
  await git(app, 'worktree', 'add', '-q', '-b', 'y-branch', yDir);
  await writeInitiative(ws, 'x', { ledger: openLedger([{ path: 'app', branch: 'x-branch' }]) });
  await writeInitiative(ws, 'y', { ledger: openLedger([{ path: 'app', branch: 'y-branch' }]) });
  await writeFile(path.join(app, 'README.md'), 'in progress\n');
  await writeFile(path.join(yDir, 'README.md'), 'agent work on y\n');
  await writeFile(path.join(app, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  let stashes: Array<{ branch: string; commit: string; recovery: string[] }> = [];
  await assert.rejects(switchCommand({ workspace, cwd: app }, 'y', { force: true }), (error: { code: string; details: { stashes: typeof stashes } }) => {
    assert.equal(error.code, 'SWITCH_INCOMPLETE');
    stashes = error.details.stashes;
    return true;
  });
  assert.equal(await git(app, 'branch', '--show-current'), 'x-branch');
  assert.equal(await git(yDir, 'branch', '--show-current'), '');
  const x = stashes.find((stash) => stash.branch === 'x-branch')!;
  const y = stashes.find((stash) => stash.branch === 'y-branch')!;
  assert.deepEqual(x.recovery, [`git -C '${app}' stash apply --index ${x.commit}`]);
  assert.deepEqual(y.recovery, [`git -C '${yDir}' checkout y-branch`, `git -C '${yDir}' stash apply --index ${y.commit}`]);

  await rm(path.join(app, '.git', 'hooks', 'post-checkout'));
  for (const stash of [x, y]) {
    for (const command of stash.recovery) {
      const [, dir, args] = /^git -C '([^']+)' (.+)$/.exec(command)!;
      await git(dir!, ...args!.split(' '));
    }
  }
  assert.equal(await readFile(path.join(app, 'README.md'), 'utf8'), 'in progress\n');
  assert.equal(await git(yDir, 'branch', '--show-current'), 'y-branch');
  assert.equal(await readFile(path.join(yDir, 'README.md'), 'utf8'), 'agent work on y\n');
});

test('a failed switch reports the saved stash and how to restore it', async (t) => {
  const { ws, workspace } = await setup(t);
  const app = await makeCheckout(ws, 'app', 'x-branch');
  await git(app, 'branch', 'y-branch');
  await writeInitiative(ws, 'x', { ledger: openLedger([{ path: 'app', branch: 'x-branch' }]) });
  await writeInitiative(ws, 'y', { ledger: openLedger([{ path: 'app', branch: 'y-branch' }]) });
  await writeFile(path.join(app, 'README.md'), 'in progress\n');
  const hook = path.join(app, '.git', 'hooks', 'post-checkout');
  await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  await assert.rejects(switchCommand({ workspace, cwd: app }, 'y'), (error: { code: string; message: string; details: { stashes: Array<{ commit: string; recovery: string[] }> } }) => {
    assert.equal(error.code, 'SWITCH_INCOMPLETE');
    assert.equal(error.details.stashes.length, 1);
    assert.match(error.message, /grind switch: x \(x-branch\)/);
    assert.match(error.details.stashes[0]!.recovery.join('\n'), new RegExp(`stash apply --index ${error.details.stashes[0]!.commit}`));
    assert.match(error.details.stashes[0]!.recovery[0]!, /worktree add '.*[\\/]\.worktrees[\\/]app[\\/]x' x-branch$/);
    return true;
  });
  assert.match(await git(app, 'stash', 'list'), /grind switch: x \(x-branch\)/);
});
