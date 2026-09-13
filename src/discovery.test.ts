import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { listInitiatives } from './discovery.ts';
import { makeSymlink, makeTempWorkspace, writeInitiative } from './test-helpers.ts';

test('leaf rule: intent.md marks an initiative; scope folders and nested indexes do not', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'givery/tcm-signin', {
    files: { 'milestones/01/index.md': '# m1\n', 'milestones/01/spec.md': '---\ntype: Specification\n---\n' },
  });
  await writeInitiative(ws, 'givery/dock-web/some-fix');
  await writeInitiative(ws, '_archive/givery/old', { ledger: null });
  await mkdir(path.join(ws.initiativesDir, 'givery', 'tcm-signin', 'worktrees', 'repo'), { recursive: true });
  await writeFile(path.join(ws.initiativesDir, 'givery', 'tcm-signin', 'worktrees', 'repo', 'intent.md'), 'x');
  await mkdir(path.join(ws.initiativesDir, 'empty-scope'), { recursive: true });

  const entries = await listInitiatives(ws.initiativesDir);
  assert.deepEqual(
    entries.map((e) => [e.id, e.archived]),
    [
      ['_archive/givery/old', true],
      ['givery/dock-web/some-fix', false],
      ['givery/tcm-signin', false],
    ],
  );
});

test('symlinked initiative folders are listed, not silently dropped', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const real = await writeInitiative(ws, 'app/real');
  await makeSymlink(real, path.join(ws.initiativesDir, 'app', 'alias'));
  const entries = await listInitiatives(ws.initiativesDir);
  assert.deepEqual(entries.map((e) => e.id), ['app/alias', 'app/real']);
});

test('missing initiatives directory lists nothing', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  assert.deepEqual(await listInitiatives(ws.initiativesDir), []);
});
