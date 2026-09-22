import assert from 'node:assert/strict';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { sessionContext, presentHookContext } from './context-hook.ts';
import { contextCommand } from './context.ts';
import { loadWorkspace } from './workspace.ts';
import { makeTempWorkspace, writeInitiative, closedLedger, git, makeCheckout, openLedger, writeSidecar } from './test-helpers.ts';

test('hook opt-in is checked before state repository access, and invalid values are actionable', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const config = path.join(ws.root, 'grind-workspace.json');
  for (const value of [undefined, false]) {
    await writeFile(config, JSON.stringify({ stateRepository: './missing', contextOnSessionStart: value }));
    assert.equal(await sessionContext({ cwd: ws.root }, '/plugin'), null);
  }
  await writeFile(config, JSON.stringify({ stateRepository: './missing', contextOnSessionStart: 'true' }));
  assert.match((await sessionContext({ cwd: ws.root }, '/plugin'))!, /contextOnSessionStart must be a boolean/);
  await writeFile(config, JSON.stringify({ stateRepository: './missing', contextOnSessionStart: true }));
  assert.match((await sessionContext({ cwd: ws.root }, '/plugin'))!, /STATE_REPOSITORY_INVALID/);
});

test('full hook output is all-or-notice at byte boundary, with closed status and quoted command', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'closed', { ledger: closedLedger() });
  const context = await contextCommand({ workspace: await loadWorkspace({ cwd: dir }), cwd: dir });
  const full = presentHookContext(context, "/plugin's folder", 100000);
  assert.match(full, /Purpose and constraints/);
  assert.match(full, /does not select/);
  assert.equal(presentHookContext(context, "/plugin's folder", Buffer.byteLength(full)), full);
  const notice = presentHookContext(context, "/plugin's folder", Buffer.byteLength(full) - 1);
  assert.match(notice, /closed init/);
  assert.doesNotMatch(notice, /Purpose and constraints|Do the thing|Current checkpoint/);
  assert.match(notice, /if needed/);
  assert.match(notice, /'"'"'/);
});

test('enabled hook loads folder context, stays quiet without association, and changes no files', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeFile(path.join(ws.root, 'grind-workspace.json'), JSON.stringify({ stateRepository: './grind-state', contextOnSessionStart: true }));
  const dir = await writeInitiative(ws, 'work');
  const before = await git(ws.stateGitRoot, 'status', '--porcelain');
  const files = await readdir(dir);
  const ledger = await readFile(path.join(dir, 'ledger.md'), 'utf8');
  assert.match((await sessionContext({ cwd: dir }, '/plugin'))!, /Init context: work/);
  assert.equal(await sessionContext({ cwd: ws.root }, '/plugin'), null);
  assert.equal(await git(ws.stateGitRoot, 'status', '--porcelain'), before);
  assert.deepEqual(await readdir(dir), files);
  assert.equal(await readFile(path.join(dir, 'ledger.md'), 'utf8'), ledger);
});


test('hook reports ambiguity, stale pointers, and detached pointers instead of treating them as absent', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeFile(path.join(ws.root, 'grind-workspace.json'), JSON.stringify({ stateRepository: './grind-state', contextOnSessionStart: true }));
  const app = await makeCheckout(ws, 'app');
  for (const id of ['one', 'two']) await writeInitiative(ws, id, { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  assert.match((await sessionContext({ cwd: app }, '/plugin'))!, /INITIATIVE_AMBIGUOUS/);
  await writeSidecar(app, 'gone');
  assert.match((await sessionContext({ cwd: app }, '/plugin'))!, /INITIATIVE_AMBIGUOUS/);
  await writeSidecar(app, 'one');
  await git(app, 'checkout', '--detach', '-q');
  assert.match((await sessionContext({ cwd: app }, '/plugin'))!, /INITIATIVE_UNRESOLVED/);
});
