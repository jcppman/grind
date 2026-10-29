import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { applyCandidate, resolveTargets } from './apply.ts';
import { candidateHash, type Candidate } from './protocol.ts';
import { readJson } from './store.ts';

async function tempDir(t: TestContext): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'grind-apply-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function candidate(documents: Array<{ target: string; content: string }>): Candidate {
  return { revision: 1, hash: candidateHash(documents, []), documents, assumptions: [], dispositions: [], summary: '', snapshotId: 's' };
}

test('targets are canonical regular files listed once; symlinks and missing files are refused', async (t) => {
  const dir = await tempDir(t);
  const outside = await tempDir(t);
  await writeFile(path.join(dir, 'plan.md'), 'a');
  await writeFile(path.join(outside, 'secret.md'), 's');
  await symlink(path.join(outside, 'secret.md'), path.join(dir, 'escape.md'));
  await mkdir(path.join(dir, 'sub'));
  const [target] = await resolveTargets(dir, ['./sub/../plan.md']);
  assert.equal(target!.path, path.join(dir, 'plan.md'));
  await assert.rejects(resolveTargets(dir, ['escape.md']), /symbolic link/);
  await assert.rejects(resolveTargets(dir, ['missing.md']), /does not exist/);
  await assert.rejects(resolveTargets(dir, ['sub']), /not a regular file/);
  await assert.rejects(resolveTargets(dir, ['plan.md', './plan.md']), /more than once/);
});

test('accepted bytes replace every target; an external edit is a write conflict that preserves both versions', async (t) => {
  const dir = await tempDir(t);
  await writeFile(path.join(dir, 'a.md'), 'old a');
  await writeFile(path.join(dir, 'b.md'), 'old b');
  const targets = await resolveTargets(dir, ['a.md', 'b.md']);
  const accepted = candidate([{ target: targets[0]!.path, content: 'new a' }, { target: targets[1]!.path, content: 'new b' }]);
  const applied = await applyCandidate(path.join(dir, 'journal.json'), targets, accepted);
  assert.equal(applied.status, 'applied');
  assert.equal(await readFile(path.join(dir, 'a.md'), 'utf8'), 'new a');
  assert.equal((await applyCandidate(path.join(dir, 'journal.json'), targets, accepted)).status, 'applied', 'repeat is idempotent');

  await writeFile(path.join(dir, 'c.md'), 'old c');
  const [c] = await resolveTargets(dir, ['c.md']);
  await writeFile(path.join(dir, 'c.md'), 'someone else edited this');
  const conflicted = await applyCandidate(path.join(dir, 'journal-c.json'), [c!], candidate([{ target: c!.path, content: 'new c' }]));
  assert.equal(conflicted.status, 'write_conflict');
  assert.equal(conflicted.conflicts[0]!.path, c!.path);
  assert.equal(await readFile(path.join(dir, 'c.md'), 'utf8'), 'someone else edited this');
});

test('an interrupted multi-file application resumes only while every file matches its before or after bytes', async (t) => {
  const dir = await tempDir(t);
  for (const name of ['a.md', 'b.md']) await writeFile(path.join(dir, name), `old ${name}`);
  const targets = await resolveTargets(dir, ['a.md', 'b.md']);
  const accepted = candidate(targets.map((target) => ({ target: target.path, content: `new ${path.basename(target.path)}` })));
  const journal = path.join(dir, 'journal.json');
  await assert.rejects(applyCandidate(journal, targets, accepted, { afterFile: async () => { throw new Error('crash after first file'); } }), /crash/);
  const partial = await readJson<{ status: string; files: Array<{ state: string }> }>(journal);
  assert.equal(partial!.status, 'applying');
  assert.deepEqual(partial!.files.map((file) => file.state), ['applied', 'pending']);
  assert.equal((await applyCandidate(journal, targets, accepted)).status, 'applied');
  assert.equal(await readFile(path.join(dir, 'b.md'), 'utf8'), 'new b.md');

  for (const name of ['a.md', 'b.md']) await writeFile(path.join(dir, name), `old ${name}`);
  const fresh = await resolveTargets(dir, ['a.md', 'b.md']);
  const second = path.join(dir, 'journal-2.json');
  await assert.rejects(applyCandidate(second, fresh, accepted, { afterFile: async () => { throw new Error('crash'); } }));
  await writeFile(path.join(dir, 'b.md'), 'edited during the interruption');
  const conflict = await applyCandidate(second, fresh, accepted);
  assert.equal(conflict.status, 'write_conflict');
  assert.deepEqual(conflict.files.map((file) => file.state), ['applied', 'pending'], 'the report says exactly which files were applied');
});

test('a journal for one candidate cannot apply a different candidate', async (t) => {
  const dir = await tempDir(t);
  await writeFile(path.join(dir, 'a.md'), 'old');
  const targets = await resolveTargets(dir, ['a.md']);
  const journal = path.join(dir, 'journal.json');
  await applyCandidate(journal, targets, candidate([{ target: targets[0]!.path, content: 'first' }]));
  await assert.rejects(applyCandidate(journal, targets, candidate([{ target: targets[0]!.path, content: 'changed after acceptance' }])), /different candidate/);
});
