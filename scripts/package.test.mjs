import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { commitState, git, makeTempWorkspace, writeInitiative, closedLedger, makeCheckout, openLedger } from '../src/test-helpers.ts';

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
  for (const skill of ['context', 'triage', 'coordinate', 'create', 'start', 'save', 'close', 'housekeeping']) {
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
  assert.equal((await run('save', 'cold', '--message', 'initial')).data.saved, true);
  assert.equal((await run('save', 'cold', '--message', 'no-op')).data.saved, false);
  assert.equal((await run('list')).data.initiatives.length, 1);
  const status = await run('status', 'cold');
  assert.equal(status.ok, true);
  await writeInitiative(ws, 'closed', { ledger: closedLedger() });
  await writeInitiative(ws, 'app/mismatch', { ledger: openLedger([{ path: 'app', branch: 'other' }]) });
  const checkout = await makeCheckout(ws, 'app');
  const snapshot = async () => JSON.stringify([
    await git(ws.stateGitRoot, 'status', '--porcelain'),
    await git(ws.stateGitRoot, 'rev-parse', 'HEAD'),
    await git(checkout, 'status', '--porcelain'),
    await git(checkout, 'branch', '--show-current'),
    await readFile(path.join(ws.initiativesDir, 'closed', 'ledger.md'), 'utf8'),
  ]);
  const before = await snapshot();
  assert.equal((await run('status', 'closed')).data.inspection.state.status, 'closed');
  assert.equal((await run('status', 'app/mismatch')).data.inspection.repositories[0].observed.path, null);
  assert.equal(await snapshot(), before);

  const lifecycle = await makeTempWorkspace();
  t.after(lifecycle.cleanup);
  await git(lifecycle.stateGitRoot, 'config', 'user.name', 'Package Test');
  await git(lifecycle.stateGitRoot, 'config', 'user.email', 'package@example.invalid');
  const app = await makeCheckout(lifecycle, 'repo');
  await git(app, 'branch', 'feature');
  await writeInitiative(lifecycle, 'alpha', { ledger: openLedger([{ path: 'repo', branch: 'main' }]) });
  await writeInitiative(lifecycle, 'beta', { ledger: openLedger([{ path: 'repo', branch: 'feature' }]) });
  await commitState(lifecycle, 'two initiatives');
  const invoke = async (cwd, ...args) => {
    try {
      return JSON.parse((await exec(process.execPath, [cli, ...args, '--workspace', lifecycle.root, '--json'], { cwd })).stdout);
    } catch (error) {
      return JSON.parse(error.stdout);
    }
  };

  const worktree = (await invoke(temp, 'worktree', 'beta')).data.path;
  assert.equal(worktree, path.join(lifecycle.root, '.worktrees', 'repo', 'beta'));
  assert.equal((await invoke(temp, 'worktree', 'alpha')).error.code, 'CHECKOUT_HELD');
  assert.equal((await invoke(worktree, 'note', 'add', 'README.md', '1', 'keep this note')).data.initiative, 'beta');
  await writeFile(path.join(app, 'dirty.txt'), 'preserve\n');
  assert.equal((await invoke(app, 'switch', 'beta', '--force')).data.switched, true);
  assert.equal(await git(app, 'branch', '--show-current'), 'feature');
  const alphaTree = path.join(lifecycle.root, '.worktrees', 'repo', 'alpha');
  assert.equal(await readFile(path.join(alphaTree, 'dirty.txt'), 'utf8'), 'preserve\n');
  assert.equal((await invoke(app, 'status')).data.owner.id, 'beta');
  assert.equal((await invoke(temp, 'save', 'beta', '--message', 'note')).data.saved, true);

  const close = ['close', 'beta', '--outcome', 'delivered', '--result', 'release/v1', '--notes', 'handled', '--date', '2026-01-01'];
  assert.equal((await invoke(temp, ...close)).error.code, 'PENDING_NOTES');
  assert.equal((await invoke(temp, 'note', 'done', 'n1', '--init', 'beta')).data.id, 'n1');
  assert.equal((await invoke(temp, ...close)).data.status, 'closed');
  await git(app, 'checkout', '-q', '--detach');
  const archived = await invoke(temp, 'archive', 'beta');
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
  // Windows has no SIGTERM handler; kill() terminates the process outright.
  if (process.platform === 'win32') assert.equal(result.signal, 'SIGTERM');
  else assert.equal(result.code, 0);
});

test('relocated explicit context remains read-only with legacy hook configuration', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'grind-context-package-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const install = path.join(temp, "plugin's folder");
  await cp(path.resolve('build/grind'), install, { recursive: true });
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'small');
  await writeFile(path.join(ws.root, 'grind-workspace.json'), JSON.stringify({ stateRepository: './grind-state', contextOnSessionStart: true }));
  const before = await git(ws.stateGitRoot, 'status', '--porcelain');
  const context = JSON.parse((await exec(process.execPath, [path.join(install, 'scripts/grind.mjs'), 'context', '--json'], { cwd: dir })).stdout);
  assert.equal(context.data.complete, true);
  assert.equal(context.data.resolution.source, 'folder');
  assert.equal(await git(ws.stateGitRoot, 'status', '--porcelain'), before);
  await assert.rejects(readFile(path.join(install, 'hooks/hooks.json')), { code: 'ENOENT' });
});
