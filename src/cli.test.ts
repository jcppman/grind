import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
    workspace: '/w',
  });
  assert.throws(() => parseArgs(['--workspace']), { code: 'USAGE' });
  assert.throws(() => parseArgs(['--bogus']), { code: 'USAGE' });
});

test('deferred commands report UNSUPPORTED_OPERATION through the JSON envelope', async () => {
  const result = await runCli('close', '--json');
  assert.equal(result.code, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'UNSUPPORTED_OPERATION');
  assert.match(envelope.error.message, /milestone 2/);
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

import { readFile } from 'node:fs/promises';
import { makeCheckout, makeTempWorkspace, openLedger, writeInitiative, writeSidecar, git } from './test-helpers.ts';

async function snapshot(ws: { root: string; stateGitRoot: string }, checkout: string): Promise<string> {
  return [
    await git(ws.stateGitRoot, 'status', '--porcelain'),
    await git(checkout, 'status', '--porcelain'),
    await git(checkout, 'symbolic-ref', '--short', 'HEAD'),
    await readFile(path.join(ws.root, 'grind-state', 'initiatives', 'app', 'x', 'ledger.md'), 'utf8'),
  ].join('\n---\n');
}

test('list, status, and start work from different entry directories and leave state unchanged', async () => {
  const ws = await makeTempWorkspace();
  try {
    const dir = await writeInitiative(ws, 'app/x', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
    const app = await makeCheckout(ws, 'app', 'feature');
    await writeSidecar(app, 'app/x');
    const before = await snapshot(ws, app);

    const list = await execFileAsync(process.execPath, [CLI, 'list', '--json', '--workspace', ws.root], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(list.stdout).data.initiatives.map((i: { id: string }) => i.id), ['app/x']);

    const fromCheckout = await execFileAsync(process.execPath, [CLI, 'status', '--json'], { cwd: app, encoding: 'utf8' });
    const status = JSON.parse(fromCheckout.stdout);
    assert.equal(status.ok, true);
    assert.equal(status.data.inspection.id, 'app/x');
    assert.equal(status.data.resolution.source, 'sidecar');

    const fromFolder = await execFileAsync(process.execPath, [CLI, 'status'], { cwd: dir, encoding: 'utf8' });
    assert.match(fromFolder.stdout, /app\/x {2}\[open\]/);
    assert.match(fromFolder.stdout, /Resolved via folder/);

    const start = await execFileAsync(process.execPath, [CLI, 'start', 'app/x', '--json', '--workspace', ws.root], { cwd: ws.stateGitRoot, encoding: 'utf8' });
    assert.equal(JSON.parse(start.stdout).data.switched, false);

    const unresolved = await runCli('status', '--workspace', ws.root, '--json');
    assert.equal(unresolved.code, 1);
    assert.equal(JSON.parse(unresolved.stdout).error.code, 'INITIATIVE_UNRESOLVED');

    assert.equal(await snapshot(ws, app), before);
  } finally {
    await ws.cleanup();
  }
});
