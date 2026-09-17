import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { readInitiative } from './artifacts.ts';
import { createCommand, saveCommand, withStateLock } from './writes.ts';
import { loadWorkspace } from './workspace.ts';
import { commitState, git, makeTempWorkspace, writeInitiative } from './test-helpers.ts';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const ws = await makeTempWorkspace({ stateLayout: 'subdir' });
  t.after(ws.cleanup);
  await git(ws.stateGitRoot, 'config', 'user.name', 'Test Human');
  await git(ws.stateGitRoot, 'config', 'user.email', 'test@example.invalid');
  return { ws, context: { cwd: ws.root, workspace: await loadWorkspace({ cwd: ws.root }) } };
}

test('create makes readable templates with and without scope, without committing', async (t) => {
  const { ws, context } = await setup(t);
  const head = await git(ws.stateGitRoot, 'rev-parse', 'HEAD');
  const bare = await createCommand(context, 'outcome');
  assert.equal(bare.id, 'outcome');
  assert.deepEqual((await readInitiative(bare.dir)).diagnostics, []);
  await mkdir(path.join(ws.root, 'apps', 'one'), { recursive: true });
  const scoped = await createCommand(context, 'other', 'apps/one');
  assert.equal(scoped.id, 'apps/one/other');
  assert.deepEqual((await readInitiative(scoped.dir)).ledgerState?.state?.repositories, []);
  assert.equal(await git(ws.stateGitRoot, 'rev-parse', 'HEAD'), head);
  assert.equal(await git(ws.stateGitRoot, 'diff', '--cached', '--name-only'), '');
});

test('create refuses collisions, nesting, escaping, nested workspaces and symlinks', async (t) => {
  const { ws, context } = await setup(t);
  const created = await createCommand(context, 'app');
  const before = await readFile(path.join(created.dir, 'intent.md'), 'utf8');
  await assert.rejects(createCommand(context, 'app'), { code: 'INITIATIVE_EXISTS' });
  await mkdir(path.join(ws.root, 'app'));
  await assert.rejects(createCommand(context, 'nested', 'app'), { code: 'INITIATIVE_EXISTS' });
  await assert.rejects(createCommand(context, '../escape'), { code: 'USAGE' });
  await assert.rejects(createCommand(context, 'x', '../escape'), { code: 'PATH_ESCAPE' });
  await writeFile(path.join(ws.root, 'app', 'grind-workspace.json'), '{}');
  await assert.rejects(createCommand(context, 'x', 'app'), { code: 'PATH_ESCAPE' });
  await mkdir(path.join(ws.root, 'linked'));
  await symlink(path.join(ws.root, 'missing'), path.join(ws.initiativesDir, 'linked'));
  await assert.rejects(createCommand(context, 'x', 'linked'), { code: 'PATH_ESCAPE' });
  assert.equal(await readFile(path.join(created.dir, 'intent.md'), 'utf8'), before);
});

test('shared lock excludes writers and releases after handled failures', async (t) => {
  const { context } = await setup(t);
  await withStateLock(context.workspace, async () => {
    await assert.rejects(createCommand(context, 'blocked'), { code: 'STATE_LOCKED' });
  });
  await assert.rejects(withStateLock(context.workspace, async () => { throw new Error('failure'); }), /failure/);
  await createCommand(context, 'after');
});

test('save includes selected additions, modifications, deletions; preserves unrelated files; no-op succeeds', async (t) => {
  const { ws, context } = await setup(t);
  const dir = await writeInitiative(ws, 'one', { files: { 'old.txt': 'old' } });
  await writeInitiative(ws, 'two');
  await commitState(ws);
  await writeFile(path.join(dir, 'new.txt'), 'new');
  await rm(path.join(dir, 'old.txt'));
  await writeFile(path.join(dir, 'intent.md'), '---\ntype: Initiative Intent\n---\n\n# updated\n');
  await writeFile(path.join(ws.stateGitRoot, 'unrelated.txt'), 'preserve');
  await writeFile(path.join(ws.initiativesDir, 'two', 'extra.txt'), 'preserve too');
  const saved = await saveCommand(context, 'one', 'save one');
  assert.equal(saved.saved, true);
  assert.deepEqual((await git(ws.stateGitRoot, 'show', '--pretty=', '--name-only', 'HEAD')).split('\n').sort(), ['grind-state/initiatives/one/intent.md', 'grind-state/initiatives/one/new.txt', 'grind-state/initiatives/one/old.txt']);
  assert.match(await git(ws.stateGitRoot, 'status', '--porcelain'), /unrelated/);
  assert.equal(await readFile(path.join(ws.initiativesDir, 'two', 'extra.txt'), 'utf8'), 'preserve too');
  assert.equal((await saveCommand(context, 'one', 'no-op')).saved, false);
});

test('save refuses staged work and malformed artifacts without changing the index', async (t) => {
  const { ws, context } = await setup(t);
  const dir = await writeInitiative(ws, 'one');
  await commitState(ws);
  await writeFile(path.join(ws.stateGitRoot, 'unrelated.txt'), 'preserve');
  await git(ws.stateGitRoot, 'add', 'unrelated.txt');
  const staged = await git(ws.stateGitRoot, 'diff', '--cached');
  await assert.rejects(saveCommand(context, 'one', 'blocked'), { code: 'INDEX_NOT_CLEAN' });
  assert.equal(await git(ws.stateGitRoot, 'diff', '--cached'), staged);
  await git(ws.stateGitRoot, 'reset');
  await writeFile(path.join(dir, 'ledger.md'), 'bad');
  await assert.rejects(saveCommand(context, 'one', 'invalid'), { code: 'ARTIFACT_INVALID' });
  assert.equal(await git(ws.stateGitRoot, 'diff', '--cached'), '');
});

test('failed commit keeps prepared files and staged changes and releases the lock', async (t) => {
  const { ws, context } = await setup(t);
  await createCommand(context, 'one');
  const hook = path.join(ws.stateGitRoot, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  await assert.rejects(saveCommand(context, 'one', 'fail'), { code: 'COMMIT_FAILED' });
  assert.match(await git(ws.stateGitRoot, 'diff', '--cached', '--name-only'), /intent.md/);
  await createCommand(context, 'after-failure');
  await assert.rejects(saveCommand(context, 'one', 'retry'), { code: 'INDEX_NOT_CLEAN' });
});

test('lock spans linked state worktrees', async (t) => {
  const { ws, context } = await setup(t);
  const linked = path.join(ws.root, 'linked-state');
  await git(ws.stateGitRoot, 'worktree', 'add', '-b', 'linked', linked);
  await withStateLock(context.workspace, async () => {
    await assert.rejects(withStateLock({ ...context.workspace, stateGitRoot: linked }, async () => {}), { code: 'STATE_LOCKED' });
  });
});

test('creation failure releases lock and preserves existing scope contents', async (t) => {
  const { ws, context } = await setup(t);
  await mkdir(path.join(ws.root, 'app'));
  await mkdir(ws.initiativesDir);
  await writeFile(path.join(ws.initiativesDir, 'app'), 'existing file');
  await assert.rejects(createCommand(context, 'child', 'app'));
  assert.equal(await readFile(path.join(ws.initiativesDir, 'app'), 'utf8'), 'existing file');
  await createCommand(context, 'after');
});

test('save rejects nested Git repositories before staging', async (t) => {
  const { ws, context } = await setup(t);
  const dir = await writeInitiative(ws, 'one');
  await mkdir(path.join(dir, 'nested'));
  await git(path.join(dir, 'nested'), 'init', '-q');
  await assert.rejects(saveCommand(context, 'one', 'invalid'), { code: 'ARTIFACT_INVALID' });
  assert.equal(await git(ws.stateGitRoot, 'diff', '--cached'), '');
});
