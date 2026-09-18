import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startCommand } from './commands.ts';
import { listParkedNoteBatches, parkNotesInLedger, splitSidecarNotes } from './notes.ts';
import { newStartOperation, readPendingOperations, writeOperation } from './operations.ts';
import { parseSidecar } from './sidecar.ts';
import { commitState, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative, writeSidecar } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

const sourceNote = '## @README.md#1\n> # app\n\nsource note\n';
const targetNote = '## @README.md#1\n> # app\n\ntarget note\n';

async function setupSwitch(t: { after: (fn: () => Promise<void>) => void }) {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const sourceDir = await writeInitiative(ws, 'app/source', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  const targetDir = await writeInitiative(ws, 'app/target', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  const targetLedger = path.join(targetDir, 'ledger.md');
  await writeFile(targetLedger, parkNotesInLedger(await readFile(targetLedger, 'utf8'), 'app', 'prior-target', targetNote));
  await commitState(ws, 'initiatives');
  await git(ws.stateGitRoot, 'config', 'user.name', 'Grind Test');
  await git(ws.stateGitRoot, 'config', 'user.email', 'grind@example.invalid');
  const app = await makeCheckout(ws, 'app');
  await git(app, 'checkout', '-q', '-b', 'feature');
  await writeFile(path.join(app, 'package-lock.json'), '{"lockfileVersion": 3}\n');
  await git(app, 'add', 'package-lock.json');
  await git(app, 'commit', '-q', '-m', 'feature dependencies');
  await git(app, 'checkout', '-q', 'main');
  const gitDir = await git(app, 'rev-parse', '--git-dir');
  await writeFile(path.resolve(app, gitDir, 'info', 'exclude'), '.grind.md\n');
  await writeSidecar(app, 'app/source', sourceNote);
  const workspace = await loadWorkspace({ cwd: ws.root });
  return { ws, app, sourceDir, targetDir, targetLedger, workspace, context: { workspace, cwd: ws.root } };
}

test('start switches branches, transfers notes, repairs the pointer, commits state, and removes its journal', async (t) => {
  const setup = await setupSwitch(t);

  const result = await startCommand(setup.context, 'app/target');

  assert.equal(result.switched, true);
  assert.deepEqual(result.switchedRepositories, ['app']);
  assert.deepEqual(result.noteTransfers, [{ repository: 'app', parked: 1, restored: 1 }]);
  assert.deepEqual(result.dependencyChanges, ['app:package-lock.json']);
  assert.equal(await git(setup.app, 'symbolic-ref', '--short', 'HEAD'), 'feature');
  const sidecar = parseSidecar(await readFile(path.join(setup.app, '.grind.md'), 'utf8'), '.grind.md');
  assert.equal(sidecar.initiative, 'app/target');
  assert.equal(sidecar.notes.length, 1);
  assert.equal(sidecar.notes[0]?.body, 'target note');
  const sourceLedger = await readFile(path.join(setup.sourceDir, 'ledger.md'), 'utf8');
  assert.equal(listParkedNoteBatches(sourceLedger, 'app').length, 1);
  assert.equal(splitSidecarNotes(await readFile(path.join(setup.app, '.grind.md'), 'utf8')).payload, targetNote);
  assert.equal(listParkedNoteBatches(await readFile(setup.targetLedger, 'utf8'), 'app').length, 0);
  assert.deepEqual(await readPendingOperations(setup.workspace), []);
  assert.equal(await git(setup.ws.stateGitRoot, 'log', '-1', '--pretty=%s'), 'grind: switch to app/target');
});

test('start reconciles checkout success that happened before its journal update', async (t) => {
  const setup = await setupSwitch(t);
  const sidecarPath = path.join(setup.app, '.grind.md');
  const split = splitSidecarNotes(await readFile(sidecarPath, 'utf8'), sidecarPath);
  await writeFile(path.join(setup.sourceDir, 'ledger.md'), parkNotesInLedger(await readFile(path.join(setup.sourceDir, 'ledger.md'), 'utf8'), 'app', 'interrupted', split.payload));
  await writeFile(sidecarPath, split.withoutNotes);
  let operation = newStartOperation('app/target', [{
    repository: 'app',
    checkout: setup.app,
    sourceBranch: 'main',
    targetBranch: 'feature',
    sourceInitiative: 'app/source',
    targetSource: 'local',
    switchState: 'checkout-planned',
    notePayload: split.payload,
    noteState: 'removed',
  }]);
  operation = { ...operation, id: 'interrupted', step: 'switch:app:checkout-planned' };
  await writeOperation(setup.workspace, operation);
  await git(setup.app, 'checkout', '-q', 'feature');

  const result = await startCommand(setup.context, 'app/target');

  assert.equal(result.switched, true);
  assert.equal(await git(setup.app, 'symbolic-ref', '--short', 'HEAD'), 'feature');
  assert.equal(parseSidecar(await readFile(sidecarPath, 'utf8'), sidecarPath).initiative, 'app/target');
  assert.deepEqual(await readPendingOperations(setup.workspace), []);
});

test('failed state commit preserves the journal and resumes without duplicating restored notes', async (t) => {
  const setup = await setupSwitch(t);
  const hook = path.join(setup.ws.stateGitRoot, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);

  await assert.rejects(startCommand(setup.context, 'app/target'), { code: 'COMMIT_FAILED' });
  assert.equal(await git(setup.app, 'symbolic-ref', '--short', 'HEAD'), 'feature');
  assert.equal((await readPendingOperations(setup.workspace)).length, 1);
  assert.match(await git(setup.ws.stateGitRoot, 'diff', '--cached', '--name-only'), /ledger\.md/);
  assert.equal(parseSidecar(await readFile(path.join(setup.app, '.grind.md'), 'utf8'), '.grind.md').notes.length, 1);

  await rm(hook);
  const resumed = await startCommand(setup.context, 'app/target');
  assert.equal(resumed.switched, true);
  assert.deepEqual(await readPendingOperations(setup.workspace), []);
  assert.equal(parseSidecar(await readFile(path.join(setup.app, '.grind.md'), 'utf8'), '.grind.md').notes.length, 1);
});

async function setupRemoteSwitch(
  t: { after: (fn: () => Promise<void>) => void },
  targetBranch: string,
  publishTarget: boolean,
) {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'app/source', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  await writeInitiative(ws, 'app/target', { ledger: openLedger([{ path: 'app', branch: targetBranch }]) });
  await commitState(ws, 'initiatives');
  const app = await makeCheckout(ws, 'app');
  const remote = await mkdtemp(path.join(tmpdir(), 'grind-switch-remote-'));
  t.after(() => rm(remote, { recursive: true, force: true }));
  await git(remote, 'init', '--bare', '-q');
  await git(app, 'remote', 'add', 'origin', remote);
  await git(app, 'push', '-q', '-u', 'origin', 'main');
  if (publishTarget) {
    await git(app, 'branch', targetBranch);
    await git(app, 'push', '-q', 'origin', targetBranch);
    await git(app, 'branch', '-D', targetBranch);
  }
  await git(app, 'remote', 'set-head', 'origin', 'main');
  const gitDir = await git(app, 'rev-parse', '--git-dir');
  await writeFile(path.resolve(app, gitDir, 'info', 'exclude'), '.grind.md\n');
  await writeSidecar(app, 'app/source');
  const workspace = await loadWorkspace({ cwd: ws.root });
  return { ws, app, workspace, context: { workspace, cwd: ws.root } };
}

test('start creates a tracking branch when the target exists only on the remote', async (t) => {
  const setup = await setupRemoteSwitch(t, 'feature', true);

  const result = await startCommand(setup.context, 'app/target');

  assert.equal(result.switched, true);
  assert.equal(await git(setup.app, 'symbolic-ref', '--short', 'HEAD'), 'feature');
  assert.equal(await git(setup.app, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'), 'origin/feature');
});

test('start creates a new target branch from the fetched remote default', async (t) => {
  const setup = await setupRemoteSwitch(t, 'new-work', false);
  const defaultCommit = await git(setup.app, 'rev-parse', 'origin/main');

  await startCommand(setup.context, 'app/target');

  assert.equal(await git(setup.app, 'symbolic-ref', '--short', 'HEAD'), 'new-work');
  assert.equal(await git(setup.app, 'rev-parse', 'HEAD'), defaultCommit);
});

test('fetch failure leaves the worktree untouched and clears a journal with no durable checkout work', async (t) => {
  const setup = await setupSwitch(t);
  await git(setup.app, 'remote', 'add', 'broken', path.join(setup.ws.root, 'missing-remote'));

  await assert.rejects(startCommand(setup.context, 'app/target'), { code: 'GIT_ERROR' });

  assert.equal(await git(setup.app, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.deepEqual(await readPendingOperations(setup.workspace), []);
  assert.equal(parseSidecar(await readFile(path.join(setup.app, '.grind.md'), 'utf8'), '.grind.md').initiative, 'app/source');
});

test('start resumes forward after the second of multiple repository switches fails', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const sourceDir = await writeInitiative(ws, 'source', {
    ledger: openLedger([
      { path: 'one', branch: 'main' },
      { path: 'two', branch: 'main' },
    ]),
  });
  await writeInitiative(ws, 'target', {
    ledger: openLedger([
      { path: 'one', branch: 'feature-one' },
      { path: 'two', branch: 'feature-two' },
    ]),
  });
  await commitState(ws, 'initiatives');
  await git(ws.stateGitRoot, 'config', 'user.name', 'Grind Test');
  await git(ws.stateGitRoot, 'config', 'user.email', 'grind@example.invalid');
  const one = await makeCheckout(ws, 'one');
  const two = await makeCheckout(ws, 'two');
  await git(one, 'branch', 'feature-one');
  await git(two, 'branch', 'feature-two');
  for (const [index, checkout] of [one, two].entries()) {
    const gitDir = await git(checkout, 'rev-parse', '--git-dir');
    await writeFile(path.resolve(checkout, gitDir, 'info', 'exclude'), '.grind.md\n');
    await writeSidecar(checkout, 'source', `## @README.md#1\n> # app\n\nnote ${index + 1}\n`);
  }
  const firstGitDir = await git(one, 'rev-parse', '--git-dir');
  const hook = path.resolve(one, firstGitDir, 'hooks', 'post-checkout');
  await writeFile(hook, `#!/bin/sh\ngit -C '${two}' branch -D feature-two >/dev/null\n`);
  await chmod(hook, 0o755);
  const workspace = await loadWorkspace({ cwd: ws.root });
  const context = { workspace, cwd: ws.root };

  await assert.rejects(startCommand(context, 'target'), { code: 'GIT_ERROR' });
  assert.equal(await git(one, 'symbolic-ref', '--short', 'HEAD'), 'feature-one');
  assert.equal(await git(two, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal((await readPendingOperations(workspace)).length, 1);

  await rm(hook);
  await git(two, 'branch', 'feature-two');
  const resumed = await startCommand(context, 'target');
  assert.deepEqual(resumed.switchedRepositories.sort(), ['one', 'two']);
  assert.equal(await git(one, 'symbolic-ref', '--short', 'HEAD'), 'feature-one');
  assert.equal(await git(two, 'symbolic-ref', '--short', 'HEAD'), 'feature-two');
  assert.deepEqual(await readPendingOperations(workspace), []);
  const parked = listParkedNoteBatches(await readFile(path.join(sourceDir, 'ledger.md'), 'utf8'), 'one')
    .concat(listParkedNoteBatches(await readFile(path.join(sourceDir, 'ledger.md'), 'utf8'), 'two'));
  assert.equal(parked.length, 2);
});

test('recovery stops when an external branch movement disagrees with the journal', async (t) => {
  const setup = await setupSwitch(t);
  const sidecarPath = path.join(setup.app, '.grind.md');
  const split = splitSidecarNotes(await readFile(sidecarPath, 'utf8'), sidecarPath);
  await writeFile(path.join(setup.sourceDir, 'ledger.md'), parkNotesInLedger(await readFile(path.join(setup.sourceDir, 'ledger.md'), 'utf8'), 'app', 'external.0', split.payload));
  await writeFile(sidecarPath, split.withoutNotes);
  let operation = newStartOperation('app/target', [{
    repository: 'app',
    checkout: setup.app,
    sourceBranch: 'main',
    targetBranch: 'feature',
    sourceInitiative: 'app/source',
    targetSource: 'local',
    switchState: 'checkout-planned',
    notePayload: split.payload,
    noteState: 'removed',
  }]);
  operation = { ...operation, id: 'external', step: 'switch:app:checkout-planned' };
  await writeOperation(setup.workspace, operation);
  await git(setup.app, 'checkout', '-q', '-b', 'unexpected');

  await assert.rejects(startCommand(setup.context, 'app/target'), { code: 'START_BLOCKED' });
  assert.equal(await git(setup.app, 'symbolic-ref', '--short', 'HEAD'), 'unexpected');
  assert.equal((await readPendingOperations(setup.workspace)).length, 1);
});
