import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { readInitiative } from './artifacts.ts';
import { addNote, listNotes, readNotes, resolveNote } from './notes.ts';
import { git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

test('notes go to the init owning the file branch, in any checkout, with repository-qualified references', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'audio/app', 'main');
  const worktree = path.join(ws.root, '.worktrees', 'audio', 'app', 'nav');
  await git(app, 'worktree', 'add', '-q', '-b', 'nav', worktree);
  await writeFile(path.join(worktree, 'nav.ts'), 'one\ntwo\nthree\n');
  const dir = await writeInitiative(ws, 'audio/nav', { ledger: openLedger([{ path: 'audio/app', branch: 'nav' }]) });
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: worktree };

  const first = await addNote(context, { file: 'nav.ts', start: 2, end: 3, comment: 'Rename this' });
  assert.deepEqual([first.id, first.initiative, first.reference], ['n1', 'audio/nav', '@audio/app:nav.ts#2-3']);
  const second = await addNote({ workspace, cwd: ws.root }, { file: path.join(worktree, 'nav.ts'), start: 1, end: 1, comment: 'Multi\nline\n\nbody' });
  assert.equal(second.id, 'n2');
  assert.equal(await readFile(path.join(dir, 'notes.md'), 'utf8'), [
    '---', 'type: Review Notes', '---', '', '# Review notes', '',
    '## n1 @audio/app:nav.ts#2-3', '> two', '', 'Rename this', '',
    '## n2 @audio/app:nav.ts#1', '> one', '', 'Multi', 'line', '', 'body', '',
  ].join('\n'));
  assert.deepEqual((await readInitiative(dir)).diagnostics, []);

  const listed = await listNotes({ workspace, cwd: ws.root }, 'nav');
  assert.deepEqual(listed.notes.map((note) => [note.id, note.repository, note.path, note.start, note.end, note.anchor, note.body, note.file]), [
    ['n1', 'audio/app', 'nav.ts', 2, 3, 'two', 'Rename this', path.join(worktree, 'nav.ts')],
    ['n2', 'audio/app', 'nav.ts', 1, 1, 'one', 'Multi\nline\n\nbody', path.join(worktree, 'nav.ts')],
  ]);

  await resolveNote(context, 'n1');
  assert.deepEqual((await readNotes(dir)).map((note) => note.id), ['n2']);
  assert.equal((await addNote(context, { file: 'nav.ts', start: 1, end: 1, comment: 'Again' })).id, 'n3');
  await assert.rejects(resolveNote(context, 'n1'), { code: 'NOTE_INVALID' });
});

test('notes on unowned branches need an explicit init, and invalid input changes nothing', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app', 'loose');
  const dir = await writeInitiative(ws, 'target', { ledger: openLedger() });
  await writeInitiative(ws, 'other', { ledger: openLedger() });
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: app };

  await assert.rejects(addNote(context, { file: 'README.md', start: 1, end: 1, comment: 'x' }), { code: 'INITIATIVE_UNRESOLVED' });
  await assert.rejects(addNote(context, { file: 'README.md', start: 1, end: 2, comment: 'x', initiative: 'target' }), { code: 'NOTE_INVALID' });
  await assert.rejects(addNote(context, { file: 'README.md', start: 1, end: 1, comment: 'ok\n## n9 @app:README.md#1', initiative: 'target' }), { code: 'NOTE_INVALID' });
  await assert.rejects(addNote(context, { file: 'README.md', start: 1, end: 1, comment: '   ', initiative: 'target' }), { code: 'NOTE_INVALID' });
  await assert.rejects(addNote(context, { file: 'missing.md', start: 1, end: 1, comment: 'x', initiative: 'target' }), { code: 'NOTE_INVALID' });
  assert.deepEqual(await readNotes(dir), []);

  const added = await addNote(context, { file: 'README.md', start: 1, end: 1, comment: '### Sub-heading is fine\nx', initiative: 'targ' });
  assert.equal(added.initiative, 'target');
  assert.equal((await readNotes(dir))[0]?.body, '### Sub-heading is fine\nx');
});

test('notes after other sections and with hand edits are parsed by their headings', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'work', {
    files: { 'notes.md': '---\ntype: Review Notes\n---\n\n# Review notes\n\nPreamble.\n\n## n4 @app:src/a b.ts#7\nNo anchor here.\n\n## Agent remarks\nNot a note.\n' },
  });
  const notes = await readNotes(dir);
  assert.deepEqual(notes.map((note) => [note.id, note.path, note.start, note.anchor, note.body]), [['n4', 'src/a b.ts', 7, null, 'No anchor here.']]);
  const workspace = await loadWorkspace({ cwd: ws.root });
  await resolveNote({ workspace, cwd: ws.root }, 'n4', 'work');
  assert.equal(await readFile(path.join(dir, 'notes.md'), 'utf8'), '---\ntype: Review Notes\n---\n\n# Review notes\n\nPreamble.\n\n## Agent remarks\nNot a note.\n');
});
