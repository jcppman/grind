import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { resolveInitiative } from './resolve.ts';
import { closedLedger, git, makeCheckout, makeSymlink, makeTempWorkspace, openLedger, writeInitiative, writeSidecar, type TempWorkspace } from './test-helpers.ts';
import { loadWorkspace, type Workspace } from './workspace.ts';

async function setup(t: { after: (fn: () => Promise<void>) => void }): Promise<{ ws: TempWorkspace; workspace: Workspace }> {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  await writeInitiative(ws, 'app/feature', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await writeInitiative(ws, 'app/other', { ledger: openLedger([{ path: 'app', branch: 'other' }]) });
  return { ws, workspace: await loadWorkspace({ cwd: ws.root }) };
}

test('explicit identifier is an exact path relative to initiatives/', async (t) => {
  const { ws, workspace } = await setup(t);
  const result = await resolveInitiative({ workspace, cwd: ws.root, identifier: 'app/feature' });
  assert.equal(result.source, 'argument');
  assert.equal(result.initiative.id, 'app/feature');
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: 'feature' }), { code: 'INITIATIVE_NOT_FOUND' });
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: 'app' }), { code: 'INITIATIVE_NOT_FOUND' });
});

test('identifiers that traverse or escape are rejected', async (t) => {
  const { ws, workspace } = await setup(t);
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: '../README.md' }), { code: 'PATH_ESCAPE' });
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: '/tmp' }), { code: 'PATH_ESCAPE' });
  const outside = await writeInitiative(ws, '../escaped');
  await makeSymlink(outside, path.join(ws.initiativesDir, 'link'));
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: 'link' }), { code: 'PATH_ESCAPE' });
  await makeSymlink(path.join(ws.initiativesDir, 'app', 'feature'), path.join(ws.initiativesDir, 'app', 'alias'));
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: 'app/alias' }), { code: 'PATH_ESCAPE' });
});

test('enclosing folder resolves from nested milestone directories', async (t) => {
  const { ws, workspace } = await setup(t);
  const nested = path.join(ws.initiativesDir, 'app', 'feature', 'milestones', '01');
  await mkdir(nested, { recursive: true });
  const result = await resolveInitiative({ workspace, cwd: nested });
  assert.equal(result.source, 'folder');
  assert.equal(result.initiative.id, 'app/feature');
  await assert.rejects(resolveInitiative({ workspace, cwd: path.join(ws.initiativesDir, 'app') }), { code: 'INITIATIVE_UNRESOLVED' });
});

test('verified sidecar pointer selects the initiative', async (t) => {
  const { ws, workspace } = await setup(t);
  const checkout = await makeCheckout(ws, 'app', 'feature');
  await writeSidecar(checkout, 'app/feature', '## @README.md#1\n\nnote\n');
  const result = await resolveInitiative({ workspace, cwd: path.join(checkout) });
  assert.equal(result.source, 'sidecar');
  assert.equal(result.initiative.id, 'app/feature');
  assert.equal(result.checkout?.repositoryPath, 'app');
  assert.equal(result.checkout?.sidecar?.notes.length, 1);
  assert.equal(result.stalePointer, null);
});

test('stale pointer yields to the branch owner and is reported', async (t) => {
  const { ws, workspace } = await setup(t);
  const checkout = await makeCheckout(ws, 'app', 'other');
  await writeSidecar(checkout, 'app/feature');
  const result = await resolveInitiative({ workspace, cwd: checkout });
  assert.equal(result.source, 'branch');
  assert.equal(result.initiative.id, 'app/other');
  assert.equal(result.stalePointer?.pointed, 'app/feature');
  assert.ok(result.diagnostics.some((d) => d.code === 'STALE_POINTER'));
});

test('missing sidecar still resolves from a tracked branch', async (t) => {
  const { ws, workspace } = await setup(t);
  const checkout = await makeCheckout(ws, 'app', 'feature');
  const result = await resolveInitiative({ workspace, cwd: path.join(checkout) });
  assert.equal(result.source, 'branch');
  assert.equal(result.initiative.id, 'app/feature');
});

test('several owners of one branch are ambiguous; archived owners are ignored', async (t) => {
  const { ws, workspace } = await setup(t);
  await writeInitiative(ws, 'app/dup', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const checkout = await makeCheckout(ws, 'app', 'feature');
  await assert.rejects(resolveInitiative({ workspace, cwd: checkout }), (error: { code: string; details: { candidates: string[] } }) => {
    assert.equal(error.code, 'INITIATIVE_AMBIGUOUS');
    assert.deepEqual(error.details.candidates, ['app/dup', 'app/feature']);
    return true;
  });
  await writeInitiative(ws, '_archive/app/old', { ledger: openLedger([{ path: 'app', branch: 'solo' }]) });
  await git(checkout, 'checkout', '-q', '-b', 'solo');
  await assert.rejects(resolveInitiative({ workspace, cwd: checkout }), { code: 'INITIATIVE_UNRESOLVED' });
});

test('untracked branch, detached HEAD, and checkouts outside the workspace do not resolve', async (t) => {
  const { ws, workspace } = await setup(t);
  const checkout = await makeCheckout(ws, 'app', 'nobody');
  await assert.rejects(resolveInitiative({ workspace, cwd: checkout }), { code: 'INITIATIVE_UNRESOLVED' });
  await git(checkout, 'checkout', '-q', '--detach');
  await assert.rejects(resolveInitiative({ workspace, cwd: checkout }), { code: 'INITIATIVE_UNRESOLVED' });
  const elsewhere = await makeTempWorkspace();
  t.after(() => elsewhere.cleanup());
  const foreign = await makeCheckout(elsewhere, 'app', 'feature');
  await assert.rejects(resolveInitiative({ workspace, cwd: foreign }), { code: 'INITIATIVE_UNRESOLVED' });
});

test('a checkout inside a nested workspace is not claimed by the outer one', async (t) => {
  const { ws, workspace } = await setup(t);
  const inner = await makeTempWorkspace();
  t.after(() => inner.cleanup());
  const nestedRoot = path.join(ws.root, 'nested');
  await mkdir(nestedRoot);
  await makeCheckout(ws, 'nested/app', 'feature');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(nestedRoot, 'grind-workspace.json'), '{"stateRepository":"./state"}');
  await assert.rejects(resolveInitiative({ workspace, cwd: path.join(nestedRoot, 'app') }), (error: { code: string; details: { nestedWorkspace: string } }) => {
    assert.equal(error.code, 'INITIATIVE_UNRESOLVED');
    assert.equal(error.details.nestedWorkspace, nestedRoot);
    return true;
  });
});

test('milestone intent resolves to its initiative and is not an explicit initiative', async (t) => {
  const { ws, workspace } = await setup(t);
  const nested = await writeInitiative(ws, 'app/feature/milestones/01', { intent: '---\ntype: Intent\n---\n' });
  const result = await resolveInitiative({ workspace, cwd: nested });
  assert.equal(result.initiative.id, 'app/feature');
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: 'app/feature/milestones/01' }), { code: 'INITIATIVE_NOT_FOUND' });
});

test('a root nested inside another initiative cannot be selected', async (t) => {
  const { ws, workspace } = await setup(t);
  const nested = await writeInitiative(ws, 'app/feature/nested');
  await assert.rejects(resolveInitiative({ workspace, cwd: nested }), { code: 'ARTIFACT_INVALID' });
  await assert.rejects(resolveInitiative({ workspace, cwd: ws.root, identifier: 'app/feature/nested' }), { code: 'ARTIFACT_INVALID' });
});

test('closed tracking does not compete with an open branch owner', async (t) => {
  const { ws, workspace } = await setup(t);
  await writeInitiative(ws, 'app/closed', { ledger: closedLedger([{ path: 'app', branch: 'feature' }]) });
  const checkout = await makeCheckout(ws, 'app', 'feature');
  const result = await resolveInitiative({ workspace, cwd: checkout });
  assert.equal(result.initiative.id, 'app/feature');
  assert.equal((await resolveInitiative({ workspace, cwd: checkout, identifier: 'app/closed' })).initiative.id, 'app/closed');
});

test('closed tracking alone does not implicitly claim a branch', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'app/closed', { ledger: closedLedger([{ path: 'app', branch: 'feature' }]) });
  const checkout = await makeCheckout(ws, 'app', 'feature');
  const workspace = await loadWorkspace({ cwd: ws.root });
  await assert.rejects(resolveInitiative({ workspace, cwd: checkout }), { code: 'INITIATIVE_UNRESOLVED' });
});
