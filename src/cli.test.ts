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
  const result = await runCli('status', '--json');
  assert.equal(result.code, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'UNSUPPORTED_OPERATION');
  assert.match(envelope.error.message, /1b/);
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
