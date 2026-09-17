import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { git, makeTempWorkspace, writeInitiative, closedLedger, makeCheckout, openLedger } from '../src/test-helpers.ts';

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
  for (const skill of ['context', 'create', 'start', 'save']) {
    const text = await readFile(path.join(install, 'skills', skill, 'SKILL.md'), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      await readFile(path.resolve(install, 'skills', skill, target));
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
});
