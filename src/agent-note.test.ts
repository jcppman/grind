import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { addAgentNote } from './agent-note.ts';
import { withRepositoryLock } from './operations.ts';
import { readSidecar } from './sidecar.ts';
import { makeCheckout, makeTempWorkspace, writeSidecar } from './test-helpers.ts';

test('agent-note appends anchored ranges and preserves the initiative pointer', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const source = path.join(app, 'src.ts');
  await writeFile(source, 'first\nsecond\nthird\n');
  await writeSidecar(app, 'app/x');

  await addAgentNote({ file: source, start: 2, end: 3, comment: 'Check this range.' });
  await addAgentNote({ file: source, start: 2, end: 3, comment: 'Check this range.' });

  const sidecar = await readSidecar(app);
  assert.equal(sidecar?.initiative, 'app/x');
  assert.equal(sidecar?.notes.length, 2);
  assert.deepEqual(sidecar?.notes[0], {
    reference: '@src.ts#2-3',
    path: 'src.ts',
    start: 2,
    end: 3,
    anchor: 'second',
    body: 'Check this range.',
  });
  assert.equal((await readFile(path.join(app, '.grind.md'), 'utf8')).match(/## @src\.ts#2-3/g)?.length, 2);
});

test('agent-note validates ranges and malformed sidecars before writing', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const source = path.join(app, 'src.ts');
  await writeFile(source, 'one\ntwo\n');
  await assert.rejects(addAgentNote({ file: source, start: 0, end: 1, comment: 'bad' }), { code: 'NOTE_INVALID' });
  await assert.rejects(addAgentNote({ file: source, start: 1, end: 1, comment: 'text\n## @other.ts#1\nmore' }), { code: 'NOTE_INVALID' });
  await assert.rejects(addAgentNote({ file: source, start: 3, end: 3, comment: 'bad' }), { code: 'NOTE_INVALID' });
  await writeFile(path.join(app, '.grind.md'), '---\ninitiative: [\n---\n');
  const before = await readFile(path.join(app, '.grind.md'), 'utf8');
  await assert.rejects(addAgentNote({ file: source, start: 1, end: 1, comment: 'blocked' }), { code: 'NOTE_INVALID' });
  assert.equal(await readFile(path.join(app, '.grind.md'), 'utf8'), before);
});

test('agent-note reports repository lock contention without writing', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const source = path.join(app, 'src.ts');
  await writeFile(source, 'one\n');

  await withRepositoryLock(app, 'test', async () => {
    await assert.rejects(addAgentNote({ file: source, start: 1, end: 1, comment: 'blocked' }), {
      code: 'REPOSITORY_LOCKED',
    });
  });
  assert.equal(await readSidecar(app), null);
});
