import assert from 'node:assert/strict';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { initiativeStatus } from './commands.ts';
import { archiveCommand, closeCommand } from './lifecycle-commands.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { validateLedger } from './ledger.ts';
import { readPendingOperations } from './operations.ts';
import { addNote, readNotes } from './notes.ts';
import { commitState, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

test('close refuses unresolved notes as handled, keeps them when parked, and persists history', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app', 'work');
  const dir = await writeInitiative(ws, 'app/work', { ledger: openLedger([{ path: 'app', branch: 'work' }]) });
  await commitState(ws, 'initiative');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: ws.root };
  await addNote({ workspace, cwd: app }, { file: 'README.md', start: 1, end: 1, comment: 'Revisit' });

  await assert.rejects(closeCommand(context, 'app/work', { outcome: 'delivered', result: 'release/v1', notes: 'handled', date: '2026-06-01' }), { code: 'PENDING_NOTES' });
  const closed = await closeCommand(context, 'app/work', { outcome: 'delivered', result: 'release/v1', notes: 'parked', date: '2026-06-01' });
  assert.equal(closed.status, 'closed');
  assert.equal(await git(ws.stateGitRoot, 'log', '-1', '--pretty=%s'), 'Close app/work');
  assert.equal(await git(ws.stateGitRoot, 'status', '--porcelain'), '');
  assert.deepEqual((await readNotes(dir)).map((note) => note.body), ['Revisit']);
  const raw = await readFile(path.join(dir, 'ledger.md'), 'utf8');
  assert.match(raw, /### Closed 2026-06-01/);
  assert.deepEqual(validateLedger(parseFrontmatter(raw), 'ledger.md').diagnostics, []);
  assert.deepEqual(await readPendingOperations(workspace), []);
  assert.match((await initiativeStatus(context, 'app/work')).archiveEligibility.blockers.join('\n'), /unresolved notes/);
});

test('archive blocks the 60-day boundary and checked-out owned branches, then preserves scoped history', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = path.join(ws.root, 'app');
  await git(ws.root, 'init', '-q', '-b', 'main', 'app');
  await git(app, 'config', 'user.name', 'Grind Test');
  await git(app, 'config', 'user.email', 'grind@example.invalid');
  await writeFile(path.join(app, 'README.md'), '# app\n');
  await git(app, 'add', 'README.md');
  await git(app, 'commit', '-q', '-m', 'init');
  const date = new Date().toISOString().slice(0, 10);
  const dir = await writeInitiative(ws, 'app/old', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  await commitState(ws, 'initiative');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: ws.root };
  await closeCommand(context, 'app/old', { outcome: 'abandoned', result: 'superseded', notes: 'handled', date });
  await assert.rejects(archiveCommand(context, 'app/old'), { code: 'ARCHIVE_BLOCKED' });

  const old = new Date(Date.now() - 61 * 86_400_000).toISOString().slice(0, 10);
  const ledger = path.join(dir, 'ledger.md');
  await writeFile(ledger, (await readFile(ledger, 'utf8')).replace(`date: ${date}`, `date: ${old}`).replace(`date: "${date}"`, `date: "${old}"`));
  await commitState(ws, 'age correction');
  await assert.rejects(archiveCommand(context, 'app/old'), { code: 'ARCHIVE_BLOCKED' });
  assert.match((await initiativeStatus(context, 'app/old')).archiveEligibility.blockers.join('\n'), /checked out/);
  await git(app, 'checkout', '-q', '--detach');

  assert.equal((await initiativeStatus(context, 'app/old')).archiveEligibility.eligible, true);

  const archived = await archiveCommand(context, 'app/old');
  assert.equal(archived.archivedId, '_archive/app/old');
  assert.match(archived.dir, /_archive[\\/]app[\\/]old$/);
  assert.equal(await git(ws.stateGitRoot, 'log', '-1', '--pretty=%s'), 'Archive app/old');
});

test('close and archive resume after state commit failures', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'work', { ledger: openLedger() });
  await commitState(ws, 'initiative');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: ws.root };
  const hook = path.join(ws.stateGitRoot, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);

  await assert.rejects(closeCommand(context, 'work', { outcome: 'delivered', result: 'v1', notes: 'handled', date: '2026-01-01' }), { code: 'COMMIT_FAILED' });
  assert.equal((await readPendingOperations(workspace))[0]?.kind, 'close');
  await rm(hook);
  await closeCommand(context, 'work', { outcome: 'delivered', result: 'v1', notes: 'handled' });
  assert.deepEqual(await readPendingOperations(workspace), []);

  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  await assert.rejects(archiveCommand(context, 'work'), { code: 'COMMIT_FAILED' });
  assert.equal((await readPendingOperations(workspace))[0]?.kind, 'archive');
  await rm(hook);
  const result = await archiveCommand(context, 'work');
  assert.equal(result.archivedId, '_archive/work');
  assert.deepEqual(await readPendingOperations(workspace), []);
});
