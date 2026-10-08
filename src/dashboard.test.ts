import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { get } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { dashboardData, directoryCommand, serveDashboard } from './dashboard.ts';
import { closedLedger, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';
import { switchCommand } from './worktree.ts';

const exec = promisify(execFile);

test('directory commands preserve literal shell characters', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const windows = process.platform === 'win32';
  // Windows forbids control characters in names, and PowerShell treats [ ] as wildcards.
  const names = ["a space", "it's here", '$(touch INJECTED)`touch INJECTED`;$HOME', windows ? 'wild[card]' : 'line\nbreak'];
  for (const name of names) {
    const directory = path.join(ws.root, name);
    await mkdir(directory);
    const result = windows
      ? await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(`${directoryCommand(directory)}; (Get-Location).ProviderPath`, 'utf16le').toString('base64')])
      : await exec('/bin/sh', ['-c', `${directoryCommand(directory)} && pwd -P`]);
    assert.equal(result.stdout.replace(/\r\n$/, '\n'), directory + '\n');
  }
});

test('dashboard preserves recorded status and shows every checkout, archive, and malformed record without writes', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const worktree = path.join(ws.root, 'linked');
  await git(app, 'worktree', 'add', '-q', '-b', 'feature', worktree);
  const lib = await makeCheckout(ws, 'lib');
  const dir = await writeInitiative(ws, 'active', { ledger: openLedger([
    { path: 'app', branch: 'feature' },
    { path: 'lib', branch: 'idle' },
    { path: 'missing', branch: 'main' },
  ]) });
  await writeInitiative(ws, 'empty');
  await writeInitiative(ws, 'closed', { ledger: closedLedger() });
  await writeInitiative(ws, '_archive/old', { ledger: closedLedger() });
  await writeInitiative(ws, 'bad', { ledger: openLedger().replace('status: open', 'status: invalid') });
  const workspace = await loadWorkspace({ cwd: ws.root });
  const before = [await git(app, 'status', '--porcelain'), await git(ws.stateGitRoot, 'status', '--porcelain'), await readFile(path.join(dir, 'ledger.md'), 'utf8')];

  const data = await dashboardData(workspace);
  const active = data.initiatives.find(i => i.id === 'active')!;
  assert.equal(active.status, 'open');
  assert.equal(active.repositories.length, 3);
  assert.equal(active.repositories[0]?.directory, worktree);
  assert.equal(active.repositories[0]?.command, directoryCommand(worktree));
  assert.equal(active.repositories[0]?.location, 'other');
  assert.equal(active.repositories[1]?.directory, lib);
  assert.equal(active.repositories[1]?.location, null);
  assert.equal(active.repositories[1]?.command, null);
  assert.equal(active.repositories[2]?.available, false);
  assert.ok(active.diagnostics.some(d => d.code === 'CHECKOUT_MISSING'));
  assert.equal(data.initiatives.find(i => i.id === 'empty')?.repositories.length, 0);
  assert.equal(data.initiatives.find(i => i.id === 'closed')?.status, 'closed');
  assert.equal(data.initiatives.find(i => i.id === '_archive/old')?.archived, true);
  assert.equal(data.initiatives.find(i => i.id === '_archive/old')?.status, 'closed');
  assert.equal(data.initiatives.find(i => i.id === 'bad')?.status, null);
  assert.ok(data.initiatives.find(i => i.id === 'bad')?.diagnostics.length);
  assert.deepEqual([await git(app, 'status', '--porcelain'), await git(ws.stateGitRoot, 'status', '--porcelain'), await readFile(path.join(dir, 'ledger.md'), 'utf8')], before);
});

test('local server refreshes data and rejects unrelated paths, origins, and writes', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const workspace = await loadWorkspace({ cwd: ws.root });
  const dashboard = await serveDashboard(workspace);
  t.after(dashboard.close);
  const readData = async () => await (await fetch(dashboard.url + 'api')).json() as Awaited<ReturnType<typeof dashboardData>>;
  const page = await fetch(dashboard.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Initiatives/);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(await (await fetch(dashboard.url + 'app.js')).text(), /clipboard.writeText/);
  assert.deepEqual((await readData()).initiatives, []);
  const dir = await writeInitiative(ws, 'new');
  assert.equal((await readData()).initiatives[0]?.id, 'new');
  await writeFile(path.join(dir, 'ledger.md'), '---\ntype: Initiative Ledger\ngrind: broken\n---\n');
  assert.equal((await readData()).initiatives[0]?.status, null);
  assert.equal((await fetch(new URL('/api', dashboard.url))).status, 404);
  assert.equal((await fetch(dashboard.url + 'api', { method: 'POST' })).status, 405);
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(dashboard.url + 'api', { headers: { Host: 'attacker.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(dashboard.url + 'api', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('editor requests resolve init folders and reject untrusted requests and unknown targets', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const directory = await writeInitiative(ws, "nested/it's an init");
  const archived = await writeInitiative(ws, '_archive/old', { ledger: closedLedger() });
  const calls: unknown[] = [];
  const dashboard = await serveDashboard(await loadWorkspace({ cwd: ws.root }), async (editor, folder) => {
    calls.push([editor, folder]);
    if (editor === 'webstorm') throw new Error('Editor unavailable');
  });
  t.after(dashboard.close);
  const headers = { Origin: new URL(dashboard.url).origin, 'Content-Type': 'application/json' };
  const send = (body: unknown, requestHeaders = headers) => fetch(dashboard.url + 'open', {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
  });
  assert.equal((await send({ id: "nested/it's an init", editor: 'vscode' })).status, 200);
  assert.deepEqual(calls, [['vscode', directory]]);
  assert.equal((await send({ id: '_archive/old', editor: 'vscode' })).status, 200);
  assert.deepEqual(calls[1], ['vscode', archived]);
  for (const id of ['../outside', directory, 'missing']) {
    assert.equal((await send({ id, editor: 'vscode' })).status, 404);
  }
  for (const body of [null, {}, { id: '_archive/old', editor: 'sh' }]) {
    assert.equal((await send(body)).status, 400);
  }
  assert.equal((await send({ id: '_archive/old', editor: 'vscode' }, { ...headers, Origin: 'https://example.com' })).status, 403);
  assert.equal((await send({ id: '_archive/old', editor: 'vscode' }, { ...headers, Origin: '' })).status, 403);
  assert.equal(calls.length, 2);
  const failure = await send({ id: '_archive/old', editor: 'webstorm' });
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: 'Editor unavailable' });
});

test('switch requests bring an open init to the foreground and report refusals', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app', 'mine');
  await git(app, 'branch', 'feature');
  await writeInitiative(ws, 'work', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await writeInitiative(ws, 'done', { ledger: closedLedger([{ path: 'app', branch: 'feature' }]) });
  const workspace = await loadWorkspace({ cwd: ws.root });
  const forced: boolean[] = [];
  const dashboard = await serveDashboard(workspace, async () => {}, async (context, id, options) => {
    forced.push(options?.force ?? false);
    return switchCommand(context, id, options);
  });
  t.after(dashboard.close);
  const headers = { Origin: new URL(dashboard.url).origin, 'Content-Type': 'application/json' };
  const send = (body: unknown, requestHeaders = headers) => fetch(dashboard.url + 'switch', {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
  });

  assert.equal((await send({ id: 'work', repository: 'app' }, { ...headers, Origin: 'https://example.com' })).status, 403);
  assert.equal((await send({ id: 'done', repository: 'app' })).status, 404);
  assert.equal((await send({ id: 'work', repository: 'other' })).status, 404);
  assert.equal((await send({ id: 'work', repository: 'app', force: 'yes' })).status, 400);
  await writeFile(path.join(app, 'README.md'), 'unowned edit\n');
  const refused = await send({ id: 'work', repository: 'app' });
  assert.equal(refused.status, 409);
  assert.deepEqual(Object.keys(await refused.json() as object).sort(), ['canForce', 'code', 'error']);
  await git(app, 'checkout', '--', 'README.md');
  const switched = await send({ id: 'work', repository: './app/', force: true });
  assert.equal(switched.status, 200);
  assert.match((await switched.json() as { message: string }).message, /work \(feature\) is now in the foreground/);
  assert.equal(await git(app, 'branch', '--show-current'), 'feature');
  assert.deepEqual(forced, [false, true]);
});


test('dashboard opens only the currently resolved roadmap', async t => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const intent = '---\ntype: Intent\ngrind:\n  root: true\n  roadmap: product\n---\n# Outcome\n';
  const contents = '---\ntype: Roadmap\ngrind:\n  id: product\n---\n# Product\n';
  const file = path.join(ws.stateDir, "product's roadmap.md");
  await writeFile(file, contents);
  await writeInitiative(ws, 'linked', { intent });
  await writeInitiative(ws, 'unlinked');
  const workspace = await loadWorkspace({ cwd: ws.root });
  const calls: unknown[] = [];
  const dashboard = await serveDashboard(workspace, async (editor, target) => { calls.push([editor, target]); });
  t.after(dashboard.close);
  const send = (id: string, target: unknown = 'roadmap') => fetch(dashboard.url + 'open', {
    method: 'POST',
    headers: { Origin: new URL(dashboard.url).origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, target, editor: 'vscode' }),
  });
  const data = await dashboardData(workspace);
  assert.deepEqual(data.initiatives.find(i => i.id === 'linked')?.roadmap, { id: 'product', path: file });
  assert.equal(data.initiatives.find(i => i.id === 'unlinked')?.roadmap, null);
  assert.equal((await send('unlinked')).status, 404);
  assert.equal((await send('linked', file)).status, 400);
  const moved = path.join(ws.stateDir, 'renamed.md');
  await rename(file, moved);
  assert.equal((await send('linked')).status, 200);
  assert.deepEqual(calls, [['vscode', moved]]);
  await writeFile(file, contents);
  assert.equal((await send('linked')).status, 404);
  assert.equal((await dashboardData(workspace)).initiatives.find(i => i.id === 'linked')?.roadmap, null);
  await rm(file);
  await rm(moved);
  assert.equal((await send('linked')).status, 404);
  assert.equal((await dashboardData(workspace)).initiatives.find(i => i.id === 'linked')?.roadmap, null);
  assert.equal(calls.length, 1);
});
