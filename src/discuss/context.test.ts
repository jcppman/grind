import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from '../test-helpers.ts';
import { loadWorkspace } from '../workspace.ts';
import { buildSnapshot, compareSnapshots, resolveOwningInit } from './context.ts';

test('init ownership comes from an explicit ID, else the folder or checkout, and is never guessed', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'apps/alpha', { ledger: openLedger([{ path: 'repo', branch: 'feature' }]) });
  await writeInitiative(ws, 'apps/beta', { ledger: openLedger([{ path: 'repo', branch: 'feature' }]) });
  await writeInitiative(ws, 'other/alpha');
  const workspace = await loadWorkspace({ cwd: ws.root });
  assert.deepEqual(await resolveOwningInit({ workspace, cwd: ws.root, init: 'apps/alpha' }), { id: 'apps/alpha', workspace: ws.root, source: 'explicit' });
  assert.equal((await resolveOwningInit({ workspace, cwd: dir }))!.source, 'folder');
  assert.equal(await resolveOwningInit({ workspace, cwd: ws.root }), null, 'no owning init is explicit, not guessed');
  assert.equal(await resolveOwningInit({ workspace, cwd: ws.root, noInit: true }), null);
  await assert.rejects(resolveOwningInit({ workspace, cwd: ws.root, init: 'alpha' }), (error: any) => error.code === 'INITIATIVE_AMBIGUOUS');
  const checkout = await makeCheckout(ws, 'repo');
  await git(checkout, 'checkout', '-q', '-b', 'feature');
  await assert.rejects(resolveOwningInit({ workspace, cwd: checkout }), (error: any) => error.code === 'INITIATIVE_AMBIGUOUS', 'two inits own the branch');
  await assert.rejects(resolveOwningInit({ workspace: null, cwd: ws.root, init: 'apps/alpha' }), /without a Grind workspace/);
});

test('the snapshot carries the init context, ignores ledger updated_at, and flags substantive edits', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'alpha', {
    index: '# Alpha\n\n- [Intent](intent.md)\n- [Ledger](ledger.md)\n- [Plan](plan.md)\n',
    ledger: openLedger([{ path: 'repo', branch: 'elsewhere' }]),
    files: { 'plan.md': '---\ntype: Implementation Plan\n---\n# Plan\n\nStep one.\n' },
  });
  await writeFile(path.join(ws.root, 'AGENTS.md'), 'Workspace rule.\n');
  await makeCheckout(ws, 'repo');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const init = await resolveOwningInit({ workspace, cwd: ws.root, init: 'alpha' });
  const first = await buildSnapshot({ workspace, cwd: ws.root, init, targets: [path.join(dir, 'plan.md')] });
  assert.deepEqual(first.manifest.artifacts.map((item) => [item.label, path.basename(item.path), item.target]), [
    ['intent', 'intent.md', false], ['ledger', 'ledger.md', false], ['plan', 'plan.md', true], ['instructions', 'AGENTS.md', false],
  ]);
  assert.match(first.manifest.omissions.join('\n'), /repo \(elsewhere\) is not checked out/);
  assert.match(first.bundle, /## Owning init: alpha/);
  assert.match(first.bundle, /Workspace rule\./);
  assert.ok(first.manifest.readableRoots.includes(dir));

  const ledger = path.join(dir, 'ledger.md');
  await writeFile(ledger, (await readFile(ledger, 'utf8')).replace('2026-09-13T10:00:00+09:00', '2026-10-01T00:00:00Z'));
  const touched = await buildSnapshot({ workspace, cwd: ws.root, init, targets: [path.join(dir, 'plan.md')] });
  assert.deepEqual(compareSnapshots(first.manifest, touched.manifest), { kind: 'metadata', changed: [ledger] });

  await writeFile(path.join(dir, 'plan.md'), '---\ntype: Implementation Plan\n---\n# Plan\n\nSomeone else edited the target.\n');
  const target = await buildSnapshot({ workspace, cwd: ws.root, init, targets: [path.join(dir, 'plan.md')] });
  assert.equal(compareSnapshots(touched.manifest, target.manifest).kind, 'none', 'target drift is a write conflict, not context drift');

  await writeFile(ledger, (await readFile(ledger, 'utf8')).replace('current_task: Do the thing', 'current_task: Do another thing'));
  const changed = await buildSnapshot({ workspace, cwd: ws.root, init, targets: [path.join(dir, 'plan.md')] });
  assert.equal(compareSnapshots(touched.manifest, changed.manifest).kind, 'substantive');
  assert.notEqual(changed.id, first.id);
});

test('incomplete required init context blocks the discussion; no init is stated explicitly', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'broken', { index: '# Broken\n\n- [Intent](intent.md)\n- [Ledger](ledger.md)\n- [Spec](spec.md)\n' });
  const workspace = await loadWorkspace({ cwd: ws.root });
  await assert.rejects(buildSnapshot({ workspace, cwd: ws.root, init: { id: 'broken', workspace: ws.root, source: 'explicit' }, targets: [] }), /context is incomplete/);
  const general = await buildSnapshot({ workspace: null, cwd: ws.root, init: null, targets: [] });
  assert.match(general.bundle, /NO owning Grind init/);
  assert.deepEqual(general.manifest.artifacts, []);
});
