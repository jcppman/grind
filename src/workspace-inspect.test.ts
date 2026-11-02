import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectWorkspace } from './workspace-inspect.ts';
import { makeTempWorkspace, writeInitiative, openLedger, makeCheckout, git } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

test('batch inspection keeps malformed inits and broken links without writing or remote access', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await makeCheckout(ws, 'app');
  await writeInitiative(ws, 'app/good', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  await writeInitiative(ws, 'app/bad', { ledger: openLedger().replace('status: open', 'status: invalid') });
  await appendFile(path.join(ws.initiativesDir, 'app/good/index.md'), '\n- [missing](missing.md)\n');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const before = await git(ws.stateGitRoot, 'status', '--porcelain');
  const result = await inspectWorkspace({ workspace, cwd: ws.root }, { scope: 'app' }, async () => { throw new Error('must not read remote'); });
  assert.equal(result.remoteError, null);
  assert.equal(result.initiatives.find(i => i.id === 'app/bad')?.complete, false);
  const good = result.initiatives.find(i => i.id === 'app/good');
  assert.ok(good && 'linkDiagnostics' in good && good.linkDiagnostics.some(d => d.path.endsWith('missing.md')));
  assert.equal(await git(ws.stateGitRoot, 'status', '--porcelain'), before);
});

test('remote identity failure is explicit while local evidence remains available', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeInitiative(ws, 'one');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const result = await inspectWorkspace({ workspace, cwd: ws.root }, { remote: true }, async () => { throw new Error('Wrong identity'); });
  assert.equal(result.remoteError, 'Wrong identity');
  assert.equal(result.initiatives[0]?.id, 'one');
});

test('inspect CLI emits batch JSON and deduplicates requested remote reads', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await makeCheckout(ws, 'app');
  const url = 'https://github.com/jcppman/example/pull/1';
  await writeInitiative(ws, 'app/one', { ledger: openLedger([{ path: 'app', branch: 'main', pull_request: url }]) });
  await writeInitiative(ws, 'app/two', { ledger: openLedger([{ path: 'app', branch: 'other', pull_request: url }]) });
  const workspace = await loadWorkspace({ cwd: ws.root });
  let reads = 0;
  const result = await inspectWorkspace({ workspace, cwd: ws.root }, { remote: true }, async () => async () => { reads++; return { state: 'OPEN' }; });
  assert.equal(reads, 1);
  assert.ok(result.initiatives.every(i => 'pullRequests' in i && i.pullRequests[0]?.status === 'observed'));
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync(process.execPath, [path.join(import.meta.dirname, 'cli.ts'), 'inspect', 'app', '--workspace', ws.root, '--json'], { encoding: 'utf8' });
  const batch = JSON.parse(output);
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.data.initiatives.map((i: { id: string }) => i.id), ['app/one', 'app/two']);
  assert.equal(batch.data.initiatives[0].pullRequests[0].status, 'not_requested');
});
