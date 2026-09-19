import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { readInitiative } from './artifacts.ts';
import { INTENT, makeSymlink, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';
import { loadWorkspace } from './workspace.ts';

const codes = (diags: { code: string }[]) => diags.map((d) => d.code).sort();

test('reads typed split documents and nested indexes, preserving content', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const spec = '---\ntype: Specification\nstatus: draft\ncustom:\n  keep: me\n---\n\n# Spec\n';
  const dir = await writeInitiative(ws, 'app/thing', {
    index: '# Thing\n\n- [Intent](intent.md)\n- [M1](milestones/01/index.md)\n- [Ext](https://example.com)\n',
    files: {
      'spec.md': spec,
      'milestones/01/index.md': '# M1\n\n- [Spec](spec.md#section)\n- [Up](../../index.md)\n',
      'milestones/01/spec.md': '---\ntype: Specification\n---\n',
      'milestones/01/design.md': '---\ntype: Visual Design\n---\n',
    },
  });
  const record = await readInitiative(dir);
  assert.deepEqual(record.diagnostics, []);
  assert.deepEqual(
    record.documents.map((d) => [d.relativePath, d.role, d.type]),
    [
      ['index.md', 'index', null],
      ['intent.md', 'intent', 'Intent'],
      ['ledger.md', 'ledger', 'Initiative Ledger'],
      ['milestones/01/design.md', 'document', 'Visual Design'],
      ['milestones/01/index.md', 'index', null],
      ['milestones/01/spec.md', 'document', 'Specification'],
      ['spec.md', 'document', 'Specification'],
    ],
  );
  const specDoc = record.documents.find((d) => d.relativePath === 'spec.md');
  assert.equal(specDoc?.frontmatter.raw, spec);
  assert.deepEqual(specDoc?.frontmatter.data?.['custom'], { keep: 'me' });
  assert.equal(record.ledgerState?.state?.status, 'open');
  assert.equal(await readFile(path.join(dir, 'spec.md'), 'utf8'), spec);
});

test('symlinked artifacts are rejected, not read through', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/linked', { ledger: null });
  const other = await writeInitiative(ws, 'app/source');
  await makeSymlink(path.join(other, 'ledger.md'), path.join(dir, 'ledger.md'));
  const record = await readInitiative(dir);
  assert.deepEqual(codes(record.diagnostics), ['MISSING_ARTIFACT', 'SYMLINK_NOT_ALLOWED']);
  assert.equal(record.ledger, null);
});

test('a worktree recorded inside the state directory is rejected when the workspace is known', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/wt', {
    ledger: openLedger([{ path: 'app', branch: 'x', checkout: 'grind-state/initiatives/app/wt/worktrees/app' }]),
  });
  const workspace = await loadWorkspace({ cwd: ws.root });
  assert.ok((await readInitiative(dir, { workspace })).diagnostics.some((d) => d.code === 'CHECKOUT_IN_STATE'));
  assert.deepEqual((await readInitiative(dir)).diagnostics, []);
  const outside = await writeInitiative(ws, 'app/ok', { ledger: openLedger([{ path: 'app', branch: 'x', checkout: 'worktrees/app' }]) });
  assert.deepEqual((await readInitiative(outside, { workspace })).diagnostics, []);
});

test('reports missing required artifacts, broken index links, and missing types', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/broken', {
    index: '# Broken\n\n- [Plan](plan.md)\n- [Anchor](#local)\n',
    ledger: null,
    files: { 'notes.md': '---\ntitle: no type\n---\n', 'legacy.md': '# no frontmatter\n' },
  });
  const record = await readInitiative(dir);
  assert.deepEqual(codes(record.diagnostics), ['BROKEN_LINK', 'LEGACY_RECORD', 'MISSING_ARTIFACT', 'MISSING_TYPE']);
  assert.equal(record.ledger, null);
  assert.equal(record.ledgerState, null);
});

test('type mismatches and malformed frontmatter are surfaced without dropping documents', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/odd', {
    intent: INTENT.replace('Intent', 'Specification'),
    ledger: openLedger().replace('type: Initiative Ledger', 'type: [oops'),
  });
  const record = await readInitiative(dir);
  assert.ok(record.diagnostics.some((d) => d.code === 'TYPE_MISMATCH'));
  assert.ok(record.diagnostics.some((d) => d.code === 'FRONTMATTER_INVALID' && d.severity === 'error'));
  assert.equal(record.documents.length, 3);
});

test('milestone intents are valid documents but nested roots are rejected', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const dir = await writeInitiative(ws, 'work', { files: {
    'milestones/01/intent.md': '---\ntype: Intent\n---\n',
    'milestones/02/intent.md': '---\ntype: Intent\ngrind:\n  root: true\n---\n',
  } });
  const record = await readInitiative(dir);
  assert.deepEqual(record.diagnostics.map((d) => [d.code, path.relative(dir, d.path ?? '')]), [
    ['NESTED_ROOT', 'milestones/02/intent.md'],
  ]);
});
