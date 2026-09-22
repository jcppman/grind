import assert from 'node:assert/strict';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { contextCommand, formatContext } from './context.ts';
import { markdownSection } from './context-markdown.ts';
import { loadWorkspace } from './workspace.ts';
import { makeTempWorkspace, writeInitiative, makeCheckout, openLedger, writeSidecar, git } from './test-helpers.ts';

test('section boundaries preserve prose and ignore fenced headings, including duplicate Unicode slugs', () => {
  const body = '# Root\r\n\r\n## Héllo!\r\none\r\n```md\r\n## fake\r\n```\r\n### Child\r\ntwo\r\n## Héllo!\r\nthree\r\n## End\r\n';
  assert.equal(markdownSection(body, 'héllo'), '## Héllo!\r\none\r\n```md\r\n## fake\r\n```\r\n### Child\r\ntwo\r\n');
  assert.equal(markdownSection(body, 'héllo-1'), '## Héllo!\r\nthree\r\n');
  assert.throws(() => markdownSection(body, 'fake'), /fragment/);
});

test('context preserves sources, deduplicates required reads, inspects foreign invoking checkout without mutations', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  await writeInitiative(ws, 'other', { ledger: openLedger([{ path: 'app', branch: 'main' }]) });
  await writeSidecar(app, 'other', '## @README.md#1\n> # app\nPlease inspect\n');
  const dir = await writeInitiative(ws, 'selected', {
    index: '# Index\n\n## Read on every context load\n- [Intent](intent.md)\n- [Rule](rules.md#h%C3%A9llo)\n- [Again](rules.md#h%C3%A9llo)\n\n## Later\n- [Optional](rules.md#absent)\n',
    ledger: openLedger([], { body: '\nExact checkpoint.\n' }),
    files: { 'rules.md': '---\ntype: Specification\n---\n## Héllo\nKeep me.\n## Other\nOmit me.\n' },
  });
  const before = await git(ws.stateGitRoot, 'status', '--porcelain');
  const sidecar = await readFile(path.join(app, '.grind.md'), 'utf8');
  const result = await contextCommand({ workspace: await loadWorkspace({ cwd: app }), cwd: app }, 'selected');
  assert.equal(result.complete, true);
  assert.equal(result.constraints.length, 1);
  assert.equal(result.constraints[0]?.body, '## Héllo\nKeep me.\n');
  assert.equal(result.invokingCheckout?.association, 'other');
  assert.equal(result.invokingCheckout?.notes[0]?.reference, '@README.md#1');
  assert.equal(result.ledger?.body, '\n# Initiative Ledger\n\nExact checkpoint.\n');
  assert.match(formatContext(result), /Exact checkpoint/);
  assert.ok(result.navigation.some(link => link.path === path.join(dir, 'rules.md')));
  assert.equal(await git(ws.stateGitRoot, 'status', '--porcelain'), before);
  assert.equal(await readFile(path.join(app, '.grind.md'), 'utf8'), sidecar);
});

test('missing fragments and symlink escapes make context incomplete without dropping other sources', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const other = await makeTempWorkspace(); t.after(other.cleanup);
  const outside = path.join(other.root, 'secret.md'); await writeFile(outside, '# Secret\n');
  const dir = await writeInitiative(ws, 'work', {
    index: '## Read on every context load\n- [Missing](rules.md#absent)\n- [Escape](escape.md)\n',
    files: { 'rules.md': '---\ntype: Specification\n---\n# Rules\n' },
  });
  await symlink(outside, path.join(dir, 'escape.md'));
  const result = await contextCommand({ workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root }, 'work');
  assert.equal(result.complete, false);
  assert.ok(result.intent);
  assert.ok(result.diagnostics.some(d => d.message.includes('fragment')));
  assert.ok(result.diagnostics.some(d => d.message.includes('outside')));
  assert.doesNotMatch(formatContext(result), /# Secret/);
});

test('malformed required links and duplicate section declarations are incomplete', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  for (const [id, index] of [
    ['prose', '## Read on every context load\nRead the whole plan.\n'],
    ['duplicate', '## Read on every context load\n- [Intent](intent.md)\n## Read on every context load\n- [Ledger](ledger.md)\n'],
    ['external', '## Read on every context load\n- [Remote](https://example.invalid/rules.md)\n'],
    ['encoding', '## Read on every context load\n- [Bad](%ZZ.md)\n'],
  ]) {
    await writeInitiative(ws, id!, { index: index! });
    const result = await contextCommand({ workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root }, id!);
    assert.equal(result.complete, false, id);
  }
});

test('required missing fragment is diagnosed even when the whole document is already included', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeInitiative(ws, 'work', { index: '## Read on every context load\n- [Intent](intent.md#absent)\n' });
  const result = await contextCommand({ workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root }, 'work');
  assert.equal(result.complete, false);
});

test('context reports detached HEAD, missing checkout and notes without modifying branches', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const head = await git(app, 'rev-parse', 'HEAD');
  await git(app, 'checkout', '--detach', '-q');
  await writeInitiative(ws, 'work', { ledger: openLedger([{ path: 'app', branch: 'main' }, { path: 'missing', branch: 'main' }]) });
  await writeSidecar(app, 'work', '## @README.md#1\n> # app\nInspect\n');
  const result = await contextCommand({ workspace: await loadWorkspace({ cwd: app }), cwd: app }, 'work');
  assert.equal(result.complete, false);
  assert.equal(result.repositories[0]?.details?.head, head);
  assert.equal(result.repositories[0]?.observed.detached, true);
  assert.equal(result.repositories[0]?.details?.notes.length, 1);
  assert.equal(await git(app, 'rev-parse', 'HEAD'), head);
});

test('required reads support reference links and headings with entities and formatting', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  await writeInitiative(ws, 'work', {
    index: '## Read on every context load\n- [Rules][rules]\n\n## Later\n\n[rules]: rules.md#rd\n',
    files: { 'rules.md': '---\ntype: Specification\n---\n## **R&amp;D**\nExact rule.\n## Next\nOther.\n' },
  });
  const result = await contextCommand({ workspace: await loadWorkspace({ cwd: ws.root }), cwd: ws.root }, 'work');
  assert.equal(result.complete, true, JSON.stringify(result.diagnostics));
  assert.equal(result.constraints[0]?.body, '## **R&amp;D**\nExact rule.\n');
});

test('context discovers an init from its tracked linked worktree', async t => {
  const ws = await makeTempWorkspace(); t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app');
  const worktree = path.join(ws.root, 'worktrees', 'feature');
  await git(app, 'worktree', 'add', '-b', 'feature', worktree);
  await writeInitiative(ws, 'work', { ledger: openLedger([{ path: 'app', branch: 'feature', checkout: 'worktrees/feature' }]) });
  const input = { workspace: await loadWorkspace({ cwd: worktree }), cwd: worktree };
  assert.equal((await contextCommand(input)).resolution.source, 'branch');
  await writeSidecar(worktree, 'work');
  const result = await contextCommand(input);
  assert.equal(result.id, 'work');
  assert.equal(result.complete, true);
  assert.equal(result.resolution.source, 'sidecar');
});
