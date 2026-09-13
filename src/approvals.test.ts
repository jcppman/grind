import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { checkApprovals } from './approvals.ts';
import { readInitiative } from './artifacts.ts';
import { commitState, makeTempWorkspace, writeInitiative } from './test-helpers.ts';

const SPEC = '---\ntype: Specification\nstatus: draft\n---\n\n# Contract\n\nAgreed text.\n';

function approved(commit: string, repoPath: string, body = SPEC): string {
  return body.replace(
    'status: draft\n',
    `status: draft\ngrind:\n  approvals:\n    - by: "human:Tester"\n      at: "2026-09-13T11:00:00+09:00"\n      revision:\n        commit: ${commit}\n        path: ${repoPath}\n`,
  );
}

async function specOf(dir: string) {
  const record = await readInitiative(dir);
  return record.documents.find((d) => d.relativePath === 'spec.md')!;
}

test('approval whose only difference is the approvals block is current', async (t) => {
  const ws = await makeTempWorkspace({ stateLayout: 'subdir' });
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', { files: { 'spec.md': SPEC } });
  const commit = await commitState(ws);
  const repoPath = 'grind-state/initiatives/app/x/spec.md';
  await writeFile(path.join(dir, 'spec.md'), approved(commit, repoPath));
  const report = await checkApprovals(await specOf(dir), ws.stateGitRoot);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.coverages[0]?.coverage, 'current');
});

test('content changed since the approved revision is outdated', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', { files: { 'spec.md': SPEC } });
  const commit = await commitState(ws);
  const repoPath = 'initiatives/app/x/spec.md';
  await writeFile(path.join(dir, 'spec.md'), approved(commit, repoPath).replace('Agreed text.', 'Changed text.'));
  const report = await checkApprovals(await specOf(dir), ws.stateGitRoot);
  assert.equal(report.coverages[0]?.coverage, 'outdated');
  assert.ok(report.diagnostics.some((d) => d.code === 'APPROVAL_OUTDATED'));
});

test('unavailable commit or path gives unknown coverage', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', { files: { 'spec.md': SPEC } });
  const commit = await commitState(ws);
  await writeFile(path.join(dir, 'spec.md'), approved('a'.repeat(40), 'initiatives/app/x/spec.md'));
  let report = await checkApprovals(await specOf(dir), ws.stateGitRoot);
  assert.equal(report.coverages[0]?.coverage, 'unknown');
  await writeFile(path.join(dir, 'spec.md'), approved(commit, 'initiatives/app/x/moved.md'));
  report = await checkApprovals(await specOf(dir), ws.stateGitRoot);
  assert.equal(report.coverages[0]?.coverage, 'unknown');
  assert.ok(report.diagnostics.some((d) => d.code === 'APPROVAL_PATH_MISMATCH'));
});

test('malformed approval events are reported and skipped', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', {
    files: {
      'spec.md': SPEC.replace('status: draft\n', 'status: draft\ngrind:\n  approvals:\n    - by: agent:bot\n      at: "2026-09-13"\n      revision:\n        commit: abc\n'),
    },
  });
  const report = await checkApprovals(await specOf(dir), ws.stateGitRoot);
  assert.equal(report.coverages.length, 0);
  const invalid = report.diagnostics.find((d) => d.code === 'APPROVAL_INVALID');
  assert.match(invalid?.message ?? '', /`by`.*`at`.*`revision.commit`.*`revision.path`/s);
});

test('an unquoted all-digit commit id is diagnosed with a quoting hint', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(() => ws.cleanup());
  const dir = await writeInitiative(ws, 'app/x', { files: { 'spec.md': approved('0'.repeat(40), 'initiatives/app/x/spec.md') } });
  const report = await checkApprovals(await specOf(dir), ws.stateGitRoot);
  assert.match(report.diagnostics[0]?.message ?? '', /quote all-digit commit ids/);
});
