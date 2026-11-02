import assert from 'node:assert/strict';
import { mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { listCommand, initiativeStatus } from './commands.ts';
import { contextCommand, formatContext } from './context.ts';
import { readRoadmaps } from './roadmaps.ts';
import { makeTempWorkspace, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

const roadmap = '---\ntype: Roadmap\ngrind:\n  id: rytho\n---\n# Vision\nPrioritize useful outcomes.\n';
const intent = '---\ntype: Intent\ngrind:\n  root: true\n  roadmap: rytho\n---\n# Outcome\n';

test('roadmap IDs resolve across directories and renames, with deduplicated planning context', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const file = path.join(ws.stateDir, 'vision.md');
  await writeFile(file, roadmap);
  await writeInitiative(ws, 'app/work', {
    intent,
    index: '---\ngrind:\n  roadmap: rytho\n---\n# Index\n',
    files: { 'design.md': '---\ntype: Specification\ngrind:\n  roadmap: rytho\n---\n' },
  });
  const input = { workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root };
  const result = await contextCommand(input, 'app/work');
  assert.equal(result.complete, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.roadmap, { id: 'rytho', path: file });
  assert.equal(result.roadmaps.length, 1);
  assert.equal(result.constraints.length, 0);
  assert.match(formatContext(result), /Roadmaps \(planning context\)/);
  assert.match(result.roadmaps[0]!.body, /Prioritize/);
  const moved = path.join(ws.stateDir, 'renamed.md');
  await rename(file, moved);
  assert.deepEqual((await listCommand(input)).initiatives[0]!.roadmap, { id: 'rytho', path: moved });
  assert.deepEqual((await initiativeStatus(input, 'app/work')).inspection.roadmap, { id: 'rytho', path: moved });
});

test('roadmaps on supporting documents do not create or inherit init associations', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeFile(path.join(ws.stateDir, 'roadmap.md'), roadmap);
  await writeInitiative(ws, 'app/work', { index: '---\ngrind:\n  roadmap: rytho\n---\n# Index\n' });
  await writeFile(path.join(ws.initiativesDir, 'app', 'index.md'), '---\ngrind:\n  roadmap: missing\n---\n');
  const input = { workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root };
  const result = await contextCommand(input, 'app/work');
  assert.equal(result.complete, true);
  assert.equal(result.roadmap, null);
  assert.equal(result.roadmaps.length, 1);
  assert.equal((await listCommand(input)).initiatives[0]!.roadmap, null);
});

test('missing, malformed and ambiguous references never select a roadmap', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'work', { intent });
  const input = { workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root };
  const missing = await contextCommand(input, 'work');
  assert.equal(missing.complete, false);
  assert.ok(missing.diagnostics.some(d => d.code === 'ROADMAP_NOT_FOUND'));
  await writeFile(path.join(ws.stateDir, 'roadmap.md'), roadmap);
  await mkdir(path.join(ws.initiativesDir, '_archive'), { recursive: true });
  await writeFile(path.join(ws.initiativesDir, '_archive', 'other.md'), roadmap);
  const duplicate = await contextCommand(input, 'work');
  assert.equal(duplicate.roadmap, null);
  assert.equal(duplicate.roadmaps.length, 0);
  assert.ok((await listCommand(input)).diagnostics.some(d => d.code === 'ROADMAP_ID_DUPLICATE'));
  assert.ok(duplicate.diagnostics.some(d => d.code === 'ROADMAP_AMBIGUOUS'));
  for (const value of ['null', '[]', '42', '""', '" rytho "']) {
    await writeFile(path.join(dir, 'intent.md'), intent.replace('roadmap: rytho', `roadmap: ${value}`));
    const result = await contextCommand(input, 'work');
    assert.ok(result.diagnostics.some(d => d.code === 'ROADMAP_REFERENCE_INVALID'), value);
    assert.equal(result.roadmap, null);
  }
});

test('catalog validates IDs, ignores symlinks and git internals, and accepts arbitrary filenames', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeFile(path.join(ws.root, 'outside.md'), roadmap);
  await symlink(path.join(ws.root, 'outside.md'), path.join(ws.stateDir, 'linked.md'));
  await writeFile(path.join(ws.stateDir, '.git', 'hidden.md'), roadmap);
  for (const [i, value] of ['null', '[]', '42', '""', '" rytho "'].entries()) {
    await writeFile(path.join(ws.stateDir, `invalid-${i}.md`), roadmap.replace('id: rytho', `id: ${value}`));
  }
  await writeFile(path.join(ws.stateDir, 'anything.md'), roadmap);
  const catalog = await readRoadmaps(ws.stateDir);
  assert.equal(catalog.documents.get('rytho')!.length, 1);
  assert.equal(catalog.diagnostics.length, 5);
  assert.ok(catalog.diagnostics.every(d => d.code === 'ROADMAP_ID_INVALID'));
});


test('unrelated invalid roadmaps are workspace diagnostics without blocking an init', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeInitiative(ws, 'work');
  await writeFile(path.join(ws.stateDir, 'bad.md'), '---\ntype: Roadmap\n---\n');
  const input = { workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root };
  assert.equal((await contextCommand(input, 'work')).complete, true);
  const listing = await listCommand(input);
  assert.ok(listing.diagnostics.some(d => d.code === 'ROADMAP_ID_INVALID'));
  assert.equal(listing.initiatives[0]!.diagnostics.length, 0);
});
