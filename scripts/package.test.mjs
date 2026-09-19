import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
