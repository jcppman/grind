import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { isContainedRelativePath, resolveWithin } from './paths.ts';
import { makeSymlink, makeTempWorkspace, type TempWorkspace } from './test-helpers.ts';
import { findNestedWorkspaceConfig } from './workspace.ts';

let ws: TempWorkspace;
before(async () => {
  ws = await makeTempWorkspace();
});
after(() => ws.cleanup());

test('lexical containment rejects absolute paths and parent segments', () => {
  assert.equal(isContainedRelativePath('a/b'), true);
  assert.equal(isContainedRelativePath('./a'), true);
  assert.equal(isContainedRelativePath(''), false);
  assert.equal(isContainedRelativePath('/abs'), false);
  assert.equal(isContainedRelativePath('../x'), false);
  assert.equal(isContainedRelativePath('a/../../x'), false);
  assert.equal(isContainedRelativePath('a\\..\\x'), false);
});

test('resolveWithin returns the real path of an existing child', async () => {
  const dir = path.join(ws.root, 'child', 'grand');
  await mkdir(dir, { recursive: true });
  assert.equal(await resolveWithin(ws.root, 'child/grand'), dir);
});

test('resolveWithin rejects a symlink that escapes the base', async () => {
  const outside = path.join(ws.root, 'outside');
  await mkdir(outside);
  await makeSymlink(outside, path.join(ws.root, 'inside', 'link'));
  await assert.rejects(resolveWithin(path.join(ws.root, 'inside'), 'link'), { code: 'PATH_ESCAPE' });
  await assert.rejects(resolveWithin(path.join(ws.root, 'inside'), 'link/deeper'), { code: 'PATH_ESCAPE' });
});

test('resolveWithin rejects traversal before touching the filesystem', async () => {
  await assert.rejects(resolveWithin(ws.root, '../etc'), { code: 'PATH_ESCAPE' });
});

test('nested workspace configuration is detected between root and target', async () => {
  const nested = path.join(ws.root, 'apps');
  const repo = path.join(nested, 'repo');
  await mkdir(repo, { recursive: true });
  assert.equal(await findNestedWorkspaceConfig(ws.root, repo), null);
  await writeFile(path.join(nested, 'grind-workspace.json'), '{"stateRepository":"./s"}');
  assert.equal(await findNestedWorkspaceConfig(ws.root, repo), path.join(nested, 'grind-workspace.json'));
  assert.equal(await findNestedWorkspaceConfig(ws.root, ws.root), null);
});
