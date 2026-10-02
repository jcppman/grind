import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { parseArgs } from './cli.ts';

const execFileAsync = promisify(execFile);
const CLI = path.join(import.meta.dirname, 'cli.ts');

async function runCli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

test('parseArgs separates command, positionals, and options', () => {
  assert.deepEqual(parseArgs(['status', 'app/x', '--json', '--workspace', '/w']), {
    command: 'status',
    positional: ['app/x'],
    json: true,
    help: false,
    open: false,
    closed: false,
    force: false,
    workspace: '/w',
  });
  assert.throws(() => parseArgs(['--workspace']), { code: 'USAGE' });
  assert.throws(() => parseArgs(['--bogus']), { code: 'USAGE' });
});

test('parseArgs accepts list scope and status filters', () => {
  assert.deepEqual(parseArgs(['list', 'audio/rytho', '--closed']), {
    command: 'list',
    positional: ['audio/rytho'],
    json: false,
    help: false,
    open: false,
    closed: true,
    force: false,
  });
});

test('deferred commands report UNSUPPORTED_OPERATION through the JSON envelope', async () => {
  const result = await runCli('init', '--json');
  assert.equal(result.code, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'UNSUPPORTED_OPERATION');
  assert.match(envelope.error.message, /future release/);
  assert.match(result.stderr, /not implemented/);
});

test('unknown commands are usage errors and help exits zero', async () => {
  const unknown = await runCli('frobnicate', '--json');
  assert.equal(unknown.code, 2);
  assert.equal(JSON.parse(unknown.stdout).error.code, 'USAGE');
  const help = await runCli('--help');
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: grind/);
});

test('list accepts a scope with an open or closed filter', async () => {
  const ws = await makeTempWorkspace();
  try {
    await writeInitiative(ws, 'audio/rytho/open', { ledger: openLedger() });
    await writeInitiative(ws, 'audio/rytho/closed', { ledger: closedLedger() });
    await writeInitiative(ws, 'audio/other/open', { ledger: openLedger() });

    const closed = await runCli('list', 'audio', '--closed', '--json', '--workspace', ws.root);
    assert.equal(closed.code, 0);
    assert.deepEqual(JSON.parse(closed.stdout).data.initiatives.map((i: { id: string }) => i.id), ['audio/rytho/closed']);

    const open = await runCli('list', 'audio/rytho', '--open', '--json', '--workspace', ws.root);
    assert.equal(open.code, 0);
    assert.deepEqual(JSON.parse(open.stdout).data.initiatives.map((i: { id: string }) => i.id), ['audio/rytho/open']);
  } finally {
    await ws.cleanup();
  }
});

test('a bare dash is only an argument of note commands', () => {
  assert.throws(() => parseArgs(['status', '-']), { code: 'USAGE' });
  assert.deepEqual(parseArgs(['note', 'add', 'f', '1', '-']).positional, ['add', 'f', '1', '-']);
});

test('list rejects conflicting status filters', async () => {
  const result = await runCli('list', '--open', '--closed', '--json');
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).error.code, 'USAGE');
});

import { readFile } from 'node:fs/promises';
import { closedLedger, makeCheckout, makeTempWorkspace, openLedger, writeInitiative, git } from './test-helpers.ts';

async function snapshot(ws: { root: string; stateGitRoot: string }, checkout: string): Promise<string> {
  return [
    await git(ws.stateGitRoot, 'status', '--porcelain'),
    await git(checkout, 'status', '--porcelain'),
    await git(checkout, 'symbolic-ref', '--short', 'HEAD'),
    await readFile(path.join(ws.root, 'grind-state', 'initiatives', 'app', 'x', 'ledger.md'), 'utf8'),
  ].join('\n---\n');
}

test('list and status work from different entry directories without writing', async () => {
  const ws = await makeTempWorkspace();
  try {
    const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
    const app = await makeCheckout(ws, 'app', 'feature');
    const before = await snapshot(ws, app);

    const list = await execFileAsync(process.execPath, [CLI, 'list', '--json', '--workspace', ws.root], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(list.stdout).data.initiatives.map((i: { id: string }) => i.id), ['app/x']);

    const fromCheckout = await execFileAsync(process.execPath, [CLI, 'status', '--json'], { cwd: app, encoding: 'utf8' });
    const status = JSON.parse(fromCheckout.stdout);
    assert.equal(status.ok, true);
    assert.equal(status.data.kind, 'repository');
    assert.equal(status.data.owner.id, 'app/x');
    assert.equal(status.data.checkout.kind, 'canonical');

    const fromFolder = await execFileAsync(process.execPath, [CLI, 'status'], { cwd: dir, encoding: 'utf8' });
    assert.match(fromFolder.stdout, /app\/x {2}\[open\]/);
    assert.match(fromFolder.stdout, /Resolved via folder/);

    assert.equal(await snapshot(ws, app), before);

    const start = await runCli('start', 'app/x', '--json', '--workspace', ws.root);
    assert.equal(JSON.parse(start.stdout).error.code, 'USAGE');

    const unresolved = await runCli('status', '--workspace', ws.root, '--json');
    assert.equal(unresolved.code, 1);
    assert.equal(JSON.parse(unresolved.stdout).error.code, 'INITIATIVE_UNRESOLVED');

    assert.equal(await snapshot(ws, app), before);
  } finally {
    await ws.cleanup();
  }
});

test('note add reads a comment from stdin and worktree prints the working path', async () => {
  const ws = await makeTempWorkspace();
  try {
    const app = await makeCheckout(ws, 'app', 'main');
    await git(app, 'branch', 'feature');
    await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
    const worktree = execFileSync(process.execPath, [CLI, 'worktree', 'x'], { cwd: ws.root, encoding: 'utf8' }).trim();
    assert.equal(worktree, path.join(ws.root, '.worktrees', 'app', 'x'));
    const added = JSON.parse(execFileSync(process.execPath, [CLI, 'note', 'add', 'README.md', '1', '-', '--json'], { cwd: worktree, encoding: 'utf8', input: 'From stdin\n' }));
    assert.equal(added.data.reference, '@app:README.md#1');
    const listed = execFileSync(process.execPath, [CLI, 'note', 'list'], { cwd: worktree, encoding: 'utf8' });
    assert.match(listed, /n1 @app:README\.md#1\n> # app\nFrom stdin/);
    const repository = JSON.parse(execFileSync(process.execPath, [CLI, 'switch', '--json'], { cwd: app, encoding: 'utf8' }));
    assert.deepEqual(repository.data.initiatives.map((item: { id: string; path: string }) => [item.id, item.path]), [['app/x', worktree]]);
  } finally {
    await ws.cleanup();
  }
});
