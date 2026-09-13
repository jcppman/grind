import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { makeTempWorkspace } from './test-helpers.ts';
import { findWorkspaceConfig, loadWorkspace } from './workspace.ts';

test('nearest configuration wins when workspaces nest', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const inner = path.join(ws.root, 'inner');
  const innerState = path.join(inner, 'state');
  await mkdir(path.join(innerState), { recursive: true });
  await writeFile(path.join(inner, 'grind-workspace.json'), '{"stateRepository":"./state"}');
  const deep = path.join(inner, 'a', 'b');
  await mkdir(deep, { recursive: true });
  assert.equal(await findWorkspaceConfig(deep), path.join(inner, 'grind-workspace.json'));
  assert.equal(await findWorkspaceConfig(ws.root), path.join(ws.root, 'grind-workspace.json'));
});

test('loadWorkspace resolves the state directory and its git root', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const loaded = await loadWorkspace({ cwd: ws.root });
  assert.equal(loaded.root, ws.root);
  assert.equal(loaded.stateDir, ws.stateDir);
  assert.equal(loaded.stateGitRoot, ws.stateGitRoot);
  assert.equal(loaded.initiativesDir, path.join(ws.stateDir, 'initiatives'));
});

test('state directory inside a containing repository reports that repository root', async (t) => {
  const ws = await makeTempWorkspace({ stateLayout: 'subdir' });
  t.after(() => ws.cleanup());
  const loaded = await loadWorkspace({ cwd: ws.root });
  assert.equal(loaded.stateDir, path.join(ws.root, 'container', 'grind-state'));
  assert.equal(loaded.stateGitRoot, path.join(ws.root, 'container'));
});

test('explicit --workspace bypasses discovery from an unrelated directory', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const elsewhere = await makeTempWorkspace();
  t.after(() => elsewhere.cleanup());
  await rm(path.join(elsewhere.root, 'grind-workspace.json'));
  const loaded = await loadWorkspace({ cwd: elsewhere.root, workspace: ws.root });
  assert.equal(loaded.root, ws.root);
  await assert.rejects(loadWorkspace({ cwd: elsewhere.root }), { code: 'WORKSPACE_NOT_FOUND' });
  await assert.rejects(loadWorkspace({ cwd: ws.root, workspace: elsewhere.root }), { code: 'WORKSPACE_NOT_FOUND' });
});

test('invalid configuration contents are rejected', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const config = path.join(ws.root, 'grind-workspace.json');
  await writeFile(config, '{not json');
  await assert.rejects(loadWorkspace({ cwd: ws.root }), { code: 'WORKSPACE_CONFIG_INVALID' });
  await writeFile(config, '{"stateRepository": ""}');
  await assert.rejects(loadWorkspace({ cwd: ws.root }), { code: 'WORKSPACE_CONFIG_INVALID' });
  await writeFile(config, '[]');
  await assert.rejects(loadWorkspace({ cwd: ws.root }), { code: 'WORKSPACE_CONFIG_INVALID' });
});

test('state directory must exist inside a git repository', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const config = path.join(ws.root, 'grind-workspace.json');
  await writeFile(config, '{"stateRepository": "./missing"}');
  await assert.rejects(loadWorkspace({ cwd: ws.root }), { code: 'STATE_REPOSITORY_INVALID' });
  await mkdir(path.join(ws.root, 'plain'));
  await writeFile(config, '{"stateRepository": "./plain"}');
  await assert.rejects(loadWorkspace({ cwd: ws.root }), { code: 'STATE_REPOSITORY_INVALID' });
});
