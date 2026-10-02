import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { inspectInitiative } from './inspect.ts';
import { closedLedger, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

const entry = (id: string, dir: string) => ({ id, dir, archived: false });

test('observed state follows wherever the recorded branch is checked out', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', {
    ledger: openLedger([
      { path: 'app', branch: 'feature' },
      { path: 'lib', branch: 'topic', checkout: 'wt/ignored' },
      { path: 'idle', branch: 'later' },
      { path: 'missing', branch: 'main' },
      { path: 'plain', branch: 'main' },
    ]),
  });
  const app = await makeCheckout(ws, 'app', 'feature');
  await writeFile(path.join(app, 'dirty.txt'), 'x');
  const lib = await makeCheckout(ws, 'lib', 'main');
  const libWorktree = path.join(ws.root, '.worktrees', 'lib', 'x');
  await git(lib, 'worktree', 'add', '-q', '-b', 'topic', libWorktree);
  await makeCheckout(ws, 'idle', 'main');
  await mkdir(path.join(ws.root, 'plain'));

  const workspace = await loadWorkspace({ cwd: ws.root });
  const inspection = await inspectInitiative(workspace, entry('app/x', dir));
  const byPath = Object.fromEntries(inspection.repositories.map((r) => [r.recorded.path, r.observed]));
  assert.equal(byPath['app']?.path, app);
  assert.equal(byPath['app']?.kind, 'canonical');
  assert.deepEqual(byPath['app']?.changedFiles, ['?? dirty.txt']);
  assert.equal(byPath['lib']?.path, libWorktree);
  assert.equal(byPath['lib']?.kind, 'grind');
  assert.equal(byPath['lib']?.canonical, lib);
  assert.equal(byPath['idle']?.path, null);
  assert.equal(byPath['idle']?.repository, true);
  assert.equal(byPath['idle']?.standardPath, path.join(ws.root, '.worktrees', 'idle', 'x'));
  assert.equal(byPath['plain']?.repository, false);
  assert.deepEqual(inspection.diagnostics.map((d) => d.code).sort(), ['CHECKOUT_MISSING', 'CHECKOUT_NOT_REPOSITORY']);
});

test('app-managed and other worktrees are distinguished from Grind worktrees', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }, { path: 'lib', branch: 'topic' }]) });
  const app = await makeCheckout(ws, 'app', 'main');
  await git(app, 'worktree', 'add', '-q', '-b', 'feature', path.join(app, '.claude', 'worktrees', 'busy'));
  const lib = await makeCheckout(ws, 'lib', 'main');
  await git(lib, 'worktree', 'add', '-q', '-b', 'topic', path.join(ws.root, 'lib-topic'));
  const workspace = await loadWorkspace({ cwd: ws.root });
  const inspection = await inspectInitiative(workspace, entry('app/x', dir));
  assert.deepEqual(inspection.repositories.map((r) => r.observed.kind), ['app', 'other']);
});

test('closed and legacy ledgers are summarized', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const workspace = await loadWorkspace({ cwd: ws.root });
  const closed = await writeInitiative(ws, 'app/closed', { ledger: closedLedger() });
  const closedInspection = await inspectInitiative(workspace, entry('app/closed', closed));
  assert.equal(closedInspection.state?.status, 'closed');
  assert.deepEqual(closedInspection.artifacts.map((a) => a.type), [null, 'Intent', 'Initiative Ledger']);

  const legacy = await writeInitiative(ws, 'app/legacy', { ledger: '# Ledger\n\nStatus: open\n' });
  const legacyInspection = await inspectInitiative(workspace, entry('app/legacy', legacy));
  assert.equal(legacyInspection.legacy, true);
  assert.equal(legacyInspection.state, null);
});
