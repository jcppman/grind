import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { statusCommand } from './commands.ts';
import {
  assertNoPendingOperation,
  newStartOperation,
  readPendingOperations,
  withLifecycleLocks,
  writeOperation,
} from './operations.ts';
import { commitState, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';
import { saveCommand } from './writes.ts';

test('operation journals are atomic, durable, and visible through status', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await commitState(ws);
  const app = await makeCheckout(ws, 'app', 'main');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const operation = newStartOperation('app/x', [
    { repository: 'app', checkout: app, sourceBranch: 'main', targetBranch: 'feature' },
  ]);
  const file = await writeOperation(workspace, operation);

  assert.deepEqual((await readPendingOperations(workspace)).map((item) => item.id), [operation.id]);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).target, 'app/x');
  const status = await statusCommand({ workspace, cwd: ws.root }, 'app/x');
  assert.deepEqual(status.pendingOperations.map((item) => item.id), [operation.id]);
});

test('pending operation blocks mutation of its initiative', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'app/x');
  await commitState(ws);
  const workspace = await loadWorkspace({ cwd: ws.root });
  await writeOperation(workspace, newStartOperation('app/x', []));
  await writeFile(path.join(dir, 'intent.md'), '---\ntype: Intent\ngrind:\n  root: true\n---\n\n# changed\n');

  await assert.rejects(assertNoPendingOperation(workspace, 'app/x'), { code: 'OPERATION_PENDING' });
  await assert.rejects(saveCommand({ workspace, cwd: ws.root }, 'app/x', 'blocked'), { code: 'OPERATION_PENDING' });
});

test('lifecycle locks cover state and repository common directories and release after failure', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const workspace = await loadWorkspace({ cwd: ws.root });

  await withLifecycleLocks(workspace, [app], 'outer', async () => {
    await assert.rejects(withLifecycleLocks(workspace, [app], 'inner', async () => {}), { code: 'STATE_LOCKED' });
  });
  await assert.rejects(withLifecycleLocks(workspace, [app], 'failure', async () => { throw new Error('boom'); }), /boom/);
  await withLifecycleLocks(workspace, [app], 'after', async () => {});
});

test('repository lock contention preserves an old lock for operator reconciliation', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const commonText = await git(app, 'rev-parse', '--git-common-dir');
  const common = path.resolve(app, commonText);
  const lock = path.join(common, 'grind-repository.lock');
  await mkdir(lock);
  const owner = { operationId: 'abandoned', pid: 999999, host: 'another-host', createdAt: '2000-01-01T00:00:00.000Z' };
  await writeFile(path.join(lock, 'owner.json'), `${JSON.stringify(owner)}\n`);

  await assert.rejects(withLifecycleLocks(workspace, [app], 'blocked', async () => {}), (error: { code: string; details: { owner: string } }) => {
    assert.equal(error.code, 'REPOSITORY_LOCKED');
    assert.deepEqual(JSON.parse(error.details.owner), owner);
    return true;
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')), owner);
  await rm(lock, { recursive: true });
  await withLifecycleLocks(workspace, [app], 'after-reconciliation', async () => {});
});
