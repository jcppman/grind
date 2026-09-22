import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { commitState, git, makeTempWorkspace, writeInitiative, closedLedger, makeCheckout, openLedger, writeSidecar } from '../src/test-helpers.ts';

const exec = promisify(execFile);

test('relocated plugin runs all commands with bundled dependencies and no global CLI', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'grind-package-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const install = path.join(temp, 'installed grind');
  await cp(path.resolve('build/grind'), install, { recursive: true });
  const pkg = JSON.parse(await readFile(path.join(install, 'package.json'), 'utf8'));
  const codexManifest = JSON.parse(await readFile(path.join(install, '.codex-plugin/plugin.json'), 'utf8'));
  const claudeManifest = JSON.parse(await readFile(path.join(install, '.claude-plugin/plugin.json'), 'utf8'));
  const marketplace = JSON.parse(await readFile(path.join(install, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(pkg.version, codexManifest.version);
  assert.equal(pkg.version, claudeManifest.version);
  assert.ok(marketplace.plugins.some((plugin) => plugin.name === 'grind' && plugin.source === './'));
  for (const skill of ['context', 'create', 'start', 'save', 'close']) {
    const text = await readFile(path.join(install, 'skills', skill, 'SKILL.md'), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      await readFile(path.resolve(install, 'skills', skill, target.split('#')[0]));
    }
  }
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await git(ws.stateGitRoot, 'config', 'user.name', 'Package Test');
  await git(ws.stateGitRoot, 'config', 'user.email', 'package@example.invalid');
  const cli = path.join(install, 'scripts/grind.mjs');
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args, '--workspace', ws.root, '--json'], { cwd: temp })).stdout);
  assert.equal((await run('create', 'cold')).data.id, 'cold');
  assert.equal((await run('start', 'cold')).data.switched, false);
  assert.equal((await run('save', 'cold', '--message', 'initial')).data.saved, true);
  assert.equal((await run('save', 'cold', '--message', 'no-op')).data.saved, false);
  assert.equal((await run('list')).data.initiatives.length, 1);
  const status = await run('status', 'cold');
  assert.equal(status.ok, true);
  await writeInitiative(ws, 'closed', { ledger: closedLedger() });
  await writeInitiative(ws, 'app/mismatch', { ledger: openLedger([{ path: 'app', branch: 'other' }]) });
  const checkout = await makeCheckout(ws, 'app');
  await writeFile(path.join(checkout, '.grind.md'), '---\ninitiative: app/mismatch\n---\n\n## @README.md#1\nReview note\n');
  const snapshot = async () => JSON.stringify([
    await git(ws.stateGitRoot, 'status', '--porcelain'),
    await git(ws.stateGitRoot, 'rev-parse', 'HEAD'),
    await git(checkout, 'status', '--porcelain'),
    await git(checkout, 'branch', '--show-current'),
    await readFile(path.join(checkout, '.grind.md'), 'utf8'),
    await readFile(path.join(ws.initiativesDir, 'closed', 'ledger.md'), 'utf8'),
  ]);
  const before = await snapshot();
  assert.equal((await run('status', 'closed')).data.inspection.state.status, 'closed');
  assert.equal((await run('status', 'app/mismatch')).data.inspection.repositories[0].onRecordedBranch, false);
  assert.equal(await snapshot(), before);

  const lifecycle = await makeTempWorkspace();
  t.after(lifecycle.cleanup);
  await git(lifecycle.stateGitRoot, 'config', 'user.name', 'Package Test');
  await git(lifecycle.stateGitRoot, 'config', 'user.email', 'package@example.invalid');
  const app = await makeCheckout(lifecycle, 'repo');
  await git(app, 'checkout', '-q', '-b', 'feature');
  await writeFile(path.join(app, 'feature.txt'), 'feature\n');
  await git(app, 'add', 'feature.txt');
  await git(app, 'commit', '-q', '-m', 'feature');
  await git(app, 'checkout', '-q', 'main');
  const gitDir = await git(app, 'rev-parse', '--git-dir');
  await writeFile(path.resolve(app, gitDir, 'info', 'exclude'), '.grind.md\n');
  await writeInitiative(lifecycle, 'alpha', { ledger: openLedger([{ path: 'repo', branch: 'main' }]) });
  await writeInitiative(lifecycle, 'beta', { ledger: openLedger([{ path: 'repo', branch: 'feature' }]) });
  await commitState(lifecycle, 'two initiatives');
  await writeSidecar(app, 'alpha', '## @README.md#1\n\nkeep this note\n');
  const invoke = async (...args) => {
    try {
      return JSON.parse((await exec(process.execPath, [cli, ...args, '--workspace', lifecycle.root, '--json'], { cwd: temp })).stdout);
    } catch (error) {
      return JSON.parse(error.stdout);
    }
  };

  await writeFile(path.join(app, 'dirty.txt'), 'preserve\n');
  assert.equal((await invoke('start', 'beta')).error.code, 'START_BLOCKED');
  assert.equal(await git(app, 'branch', '--show-current'), 'main');
  assert.equal(await readFile(path.join(app, 'dirty.txt'), 'utf8'), 'preserve\n');
  await rm(path.join(app, 'dirty.txt'));
  assert.equal((await invoke('start', 'beta')).data.switched, true);
  assert.equal(await git(app, 'branch', '--show-current'), 'feature');

  const hook = path.join(lifecycle.stateGitRoot, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  assert.equal((await invoke('start', 'alpha')).error.code, 'COMMIT_FAILED');
  assert.equal(await git(app, 'branch', '--show-current'), 'main');
  await rm(hook);
  assert.equal((await invoke('start', 'alpha')).data.inspection.id, 'alpha');
  assert.match(await readFile(path.join(app, '.grind.md'), 'utf8'), /keep this note/);

  const close = ['close', 'beta', '--outcome', 'delivered', '--result', 'release/v1', '--notes', 'handled', '--date', '2026-01-01'];
  assert.equal((await invoke(...close)).data.status, 'closed');
  assert.equal((await invoke('start', 'beta')).data.inspection.state.status, 'open');
  assert.equal((await invoke('start', 'alpha')).data.inspection.id, 'alpha');
  assert.equal((await invoke(...close)).data.status, 'closed');
  const archived = await invoke('archive', 'beta');
  assert.equal(archived.ok, true, JSON.stringify(archived));
  assert.equal(archived.data.archivedId, '_archive/beta');
  assert.match(await readFile(path.join(lifecycle.initiativesDir, '_archive', 'beta', 'ledger.md'), 'utf8'), /release\/v1/);
});


test('relocated dashboard starts, serves its assets and data, and stops on SIGTERM', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'grind-dashboard-package-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const install = path.join(temp, 'installed');
  await cp(path.resolve('build/grind'), install, { recursive: true });
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'dashboard');
  const child = spawn(process.execPath, [path.join(install, 'scripts/grind.mjs'), 'dashboard', '--workspace', ws.root, '--json'], { cwd: temp });
  t.after(() => { child.kill('SIGTERM'); });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Dashboard startup timed out: ' + errors)), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Dashboard exited before startup: ' + errors)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) {
        clearTimeout(timer);
        const envelope = JSON.parse(output.split('\n')[0]);
        if (!envelope.ok) reject(new Error(JSON.stringify(envelope)));
        else resolve(envelope.data.url);
      }
    });
  });
  assert.match(await (await fetch(url)).text(), /Grind — Initiatives/);
  assert.match(await (await fetch(url + 'app.js')).text(), /clipboard.writeText/);
  assert.equal((await (await fetch(url + 'api')).json()).initiatives[0].id, 'dashboard');
  child.kill('SIGTERM');
  const result = await exited;
  assert.equal(result.code, 0);
});

test('relocated context and SessionStart hook honor opt-in, overflow and read-only behavior', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'grind-context-package-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const install = path.join(temp, "plugin's folder");
  await cp(path.resolve('build/grind'), install, { recursive: true });
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'small');
  const hookFile = path.join(install, 'hooks/session-start.mjs');
  const manifest = JSON.parse(await readFile(path.join(install, 'hooks/hooks.json'), 'utf8'));
  const hookCommand = manifest.hooks.SessionStart[0].hooks[0].command;
  const invoke = (source, cwd = dir) => new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', hookCommand], {
      cwd, env: { ...process.env, CLAUDE_PLUGIN_ROOT: install },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify({ cwd, source, hook_event_name: 'SessionStart', session_id: 'package-test' }));
  });
  const cli = path.join(install, 'scripts/grind.mjs');
  const context = JSON.parse((await exec(process.execPath, [cli, 'context', '--json'], { cwd: dir })).stdout);
  assert.equal(context.data.complete, true);
  assert.equal(context.data.resolution.source, 'folder');
  assert.equal(await invoke('startup'), '');
  await writeFile(path.join(ws.root, 'grind-workspace.json'), JSON.stringify({ stateRepository: './grind-state', contextOnSessionStart: true }));
  const before = await git(ws.stateGitRoot, 'status', '--porcelain');
  for (const source of ['startup', 'resume', 'compact', 'clear', 'fork']) {
    const output = JSON.parse(await invoke(source)).hookSpecificOutput;
    assert.equal(output.hookEventName, 'SessionStart');
    assert.match(output.additionalContext, /# Init context: small/);
    assert.match(output.additionalContext, /does not select an init/);
  }
  assert.equal(await git(ws.stateGitRoot, 'status', '--porcelain'), before);
  const ledger = path.join(dir, 'ledger.md');
  await writeFile(ledger, (await readFile(ledger, 'utf8')) + '\n' + 'Context payload '.repeat(2000));
  const output = JSON.parse(await invoke('compact')).hookSpecificOutput.additionalContext;
  assert.match(output, /open init "small"/);
  assert.doesNotMatch(output, /Context payload|Current checkpoint|Purpose and constraints/);
  assert.ok(Buffer.byteLength(output) <= 6000);
  assert.match(output, /if needed/);
  const command = output.match(/Run (.+) to load it if needed\./)[1];
  const loaded = await exec('/bin/sh', ['-c', command], { cwd: temp });
  assert.match(loaded.stdout, /Context payload/);
  await writeFile(path.join(ws.root, 'grind-workspace.json'), JSON.stringify({ stateRepository: './grind-state', contextOnSessionStart: false }));
  assert.equal(await invoke('resume'), '');
  assert.ok(await readFile(hookFile, 'utf8'));
});

test('hook decodes split UTF-8 input and enforces its byte limit', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeFile(path.join(ws.root, 'grind-workspace.json'), JSON.stringify({ stateRepository: './grind-state', contextOnSessionStart: true }));
  const cwd = await writeInitiative(ws, '日本語');
  const hook = path.resolve('build/grind/hooks/session-start.mjs');
  const input = Buffer.from(JSON.stringify({ cwd, source: 'startup' }));
  const splitAt = input.indexOf(Buffer.from('日')) + 1;
  const run = async chunks => {
    const preload = path.join(ws.root, 'stdin.mjs');
    await writeFile(preload, `
      import { Readable } from 'node:stream';
      const chunks = ${JSON.stringify(chunks.map(chunk => chunk.toString('base64')))};
      Object.defineProperty(process, 'stdin', {
        value: Readable.from(chunks.map(chunk => Buffer.from(chunk, 'base64')))
      });
    `);
    const { stdout } = await exec(process.execPath, ['--import', preload, hook], { cwd });
    return JSON.parse(stdout).hookSpecificOutput.additionalContext;
  };
  const context = await run([input.subarray(0, splitAt), input.subarray(splitAt)]);
  assert.match(context, /# Init context: 日本語/);
  assert.doesNotMatch(context, /ENOENT|CONTEXT_HOOK_FAILED|\uFFFD/);
  const tooLarge = Buffer.from(JSON.stringify({ cwd, padding: '日'.repeat(400000) }));
  const rejected = await run([tooLarge]);
  assert.match(rejected, /could not read SessionStart input/);
  assert.doesNotMatch(rejected, /# Init context/);
});
