import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { inspectInitiative, startBlockers } from './inspect.ts';
import { closedLedger, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative, writeSidecar } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

const entry = (id: string, dir: string) => ({ id, dir, archived: false });

test('observed checkout state is compared with recorded tracking', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', {
    ledger: openLedger([
      { path: 'app', branch: 'feature' },
      { path: 'missing', branch: 'main' },
      { path: 'plain', branch: 'main' },
      { path: 'other', branch: 'main', checkout: 'wt/other' },
    ]),
  });
  const app = await makeCheckout(ws, 'app', 'feature');
  await writeFile(path.join(app, 'dirty.txt'), 'x');
  await writeFile(path.join(app, 'moved.md'), 'placeholder');
  await git(app, 'add', 'moved.md');
  await git(app, 'commit', '-q', '-m', 'add');
  await git(app, 'mv', '-f', 'moved.md', '.grind.md');
  await writeSidecar(app, 'app/x', '## @README.md#1\n\nnote\n');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(ws.root, 'plain'));
  const other = await makeCheckout(ws, 'wt/other', 'main');
  await git(other, 'checkout', '-q', '--detach');

  const workspace = await loadWorkspace({ cwd: ws.root });
  const inspection = await inspectInitiative(workspace, entry('app/x', dir));
  const byPath = Object.fromEntries(inspection.repositories.map((r) => [r.recorded.path, r]));
  assert.equal(byPath['app']?.onRecordedBranch, true);
  assert.deepEqual(byPath['app']?.observed.changedFiles, ['?? dirty.txt']);
  assert.deepEqual(byPath['app']?.observed.sidecar, { initiative: 'app/x', verified: true, pendingNotes: 1 });
  assert.equal(byPath['missing']?.observed.exists, false);
  assert.equal(byPath['plain']?.observed.repository, false);
  assert.equal(byPath['other']?.observed.detached, true);
  assert.equal(byPath['other']?.observed.path, path.join(ws.root, 'wt', 'other'));
  assert.deepEqual(
    inspection.diagnostics.map((d) => d.code).sort(),
    ['CHECKOUT_MISSING', 'CHECKOUT_NOT_REPOSITORY', 'DETACHED_HEAD', 'PENDING_NOTES'],
  );
  assert.deepEqual(startBlockers(inspection).length, 3);
});

test('branch mismatch and foreign pointer are reported, and block start', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const app = await makeCheckout(ws, 'app', 'elsewhere');
  await writeSidecar(app, 'app/y');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const inspection = await inspectInitiative(workspace, entry('app/x', dir));
  assert.deepEqual(inspection.diagnostics.map((d) => d.code).sort(), ['BRANCH_MISMATCH', 'POINTER_MISMATCH']);
  assert.equal(inspection.repositories[0]?.observed.sidecar?.verified, false);
  assert.deepEqual(startBlockers(inspection), ['app is on elsewhere, not feature']);
});

test('clean matching checkouts have no blockers; closed and legacy ledgers are summarized', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const workspace = await loadWorkspace({ cwd: ws.root });
  const ok = await writeInitiative(ws, 'app/ok', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  await makeCheckout(ws, 'app', 'main');
  assert.deepEqual(startBlockers(await inspectInitiative(workspace, entry('app/ok', ok))), []);

  const closed = await writeInitiative(ws, 'app/closed', { ledger: closedLedger() });
  const closedInspection = await inspectInitiative(workspace, entry('app/closed', closed));
  assert.equal(closedInspection.state?.status, 'closed');
  assert.deepEqual(closedInspection.artifacts.map((a) => a.type), [null, 'Initiative Intent', 'Initiative Ledger']);
  assert.deepEqual(startBlockers(closedInspection), []);

  const legacy = await writeInitiative(ws, 'app/legacy', { ledger: '# Ledger\n\nStatus: open\n' });
  const legacyInspection = await inspectInitiative(workspace, entry('app/legacy', legacy));
  assert.equal(legacyInspection.legacy, true);
  assert.equal(legacyInspection.state, null);
  assert.ok(startBlockers(legacyInspection).includes('ledger state is malformed or legacy'));
});
