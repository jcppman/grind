import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { listInitiatives } from './discovery.ts';
import { makeSymlink, makeTempWorkspace, writeInitiative } from './test-helpers.ts';

test('root markers identify initiatives; scope folders and nested indexes do not', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'givery/tcm-signin', {
    files: { 'milestones/01/index.md': '# m1\n', 'milestones/01/spec.md': '---\ntype: Specification\n---\n' },
  });
  await writeInitiative(ws, 'givery/dock-web/some-fix');
  await writeInitiative(ws, '_archive/givery/old', { ledger: null });
  await mkdir(path.join(ws.initiativesDir, 'empty-scope'), { recursive: true });
  await writeFile(path.join(ws.initiativesDir, 'givery', 'stray.md'), 'not an initiative');

  const { entries, diagnostics } = await listInitiatives(ws.initiativesDir);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    entries.map((e) => [e.id, e.archived]),
    [
      ['_archive/givery/old', true],
      ['givery/dock-web/some-fix', false],
      ['givery/tcm-signin', false],
    ],
  );
});

test('symbolic links are reported and not followed', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const real = await writeInitiative(ws, 'app/real');
  await makeSymlink(real, path.join(ws.initiativesDir, 'app', 'alias'));
  await makeSymlink(ws.root, path.join(ws.initiativesDir, 'escape'));
  const { entries, diagnostics } = await listInitiatives(ws.initiativesDir);
  assert.deepEqual(entries.map((e) => e.id), ['app/real']);
  assert.deepEqual(
    diagnostics.map((d) => [d.code, path.relative(ws.initiativesDir, d.path ?? '')]).sort(),
    [['SYMLINK_NOT_ALLOWED', 'app/alias'], ['SYMLINK_NOT_ALLOWED', 'escape']],
  );
});

test('missing initiatives directory lists nothing', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  assert.deepEqual(await listInitiatives(ws.initiativesDir), { entries: [], diagnostics: [] });
});

test('unmarked intents do not establish initiative boundaries', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'scope', { intent: '---\ntype: Intent\n---\n' });
  await writeInitiative(ws, 'scope/child');
  await writeInitiative(ws, 'false', { intent: '---\ntype: Intent\ngrind:\n  root: false\n---\n' });
  const result = await listInitiatives(ws.initiativesDir);
  assert.deepEqual(result.entries.map((entry) => entry.id), ['scope/child']);
  assert.deepEqual(result.diagnostics, []);
});

test('malformed root markers are reported instead of becoming initiatives', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'bad', { intent: '---\ntype: Intent\ngrind:\n  root: "true"\n---\n' });
  const result = await listInitiatives(ws.initiativesDir);
  assert.deepEqual(result.entries, []);
  assert.equal(result.diagnostics[0]?.code, 'ROOT_INVALID');
});

test('discovery never follows an intent symlink', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const real = await writeInitiative(ws, 'real');
  const alias = path.join(ws.initiativesDir, 'alias');
  await mkdir(alias);
  await makeSymlink(path.join(real, 'intent.md'), path.join(alias, 'intent.md'));
  const result = await listInitiatives(ws.initiativesDir);
  assert.deepEqual(result.entries.map((entry) => entry.id), ['real']);
  assert.ok(result.diagnostics.some((d) => d.path === path.join(alias, 'intent.md')));
});
