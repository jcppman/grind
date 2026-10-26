import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { commitState, git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';

const CLI = path.join(import.meta.dirname, 'cli.ts');

function grind(env: NodeJS.ProcessEnv, cwd: string, args: string[], stdin = ''): Promise<{ code: number; json: { ok: boolean; data?: any; error?: { code: string } } }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args, '--json'], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, json: JSON.parse(stdout) }));
    child.stdin.end(stdin);
  });
}

test('a session drafts, submits and delivers one batch; the init sees a reference and saves no quote', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const home = await mkdtemp(path.join(os.tmpdir(), 'grind-review-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { GRIND_REVIEW_HOME: home };
  await git(ws.stateGitRoot, 'config', 'user.name', 'Review Test');
  await git(ws.stateGitRoot, 'config', 'user.email', 'review@example.invalid');
  const app = await makeCheckout(ws, 'app', 'feature');
  await writeInitiative(ws, 'alpha', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await commitState(ws, 'alpha');
  const secret = 'PRIVATE-QUOTE-7c1f';
  const source = { kind: 'claude-reply', sessionId: 'sess-1', messageId: 'row-9' };

  const added = await grind(env, app, ['review', 'add', '--session', 'sess-1', '--expect-revision', '0'], JSON.stringify({ source, quote: secret, body: 'first' }));
  assert.equal(added.code, 0);
  assert.deepEqual(added.json.data.draft.association, { workspace: ws.root, initiative: 'alpha', source: 'inferred' });
  const stale = await grind(env, app, ['review', 'add', '--session', 'sess-1', '--expect-revision', '0'], JSON.stringify({ source, quote: 'x' }));
  assert.deepEqual([stale.code, stale.json.error?.code], [1, 'REVIEW_STALE']);
  const edited = await grind(env, app, ['review', 'edit', '--session', 'sess-1', '--comment', 'c1', '--expect-revision', '1'], 'reworded');
  assert.equal(edited.json.data.comments[0].body, 'reworded');

  const context = await grind(env, app, ['context', 'alpha']);
  assert.deepEqual(context.json.data.reviews, []);
  assert.ok(!JSON.stringify(context.json).includes(secret));

  const submitted = await grind(env, app, ['review', 'submit', '--session', 'sess-1', '--draft', added.json.data.draft.id, '--revision', '2']);
  assert.equal(submitted.code, 0);
  const batch = submitted.json.data.submission.id as string;
  assert.ok(submitted.json.data.payload.text.includes(secret));
  assert.ok(submitted.json.data.payload.text.includes(`grind-review batch=${batch}`));
  const attempt = await grind(env, app, ['review', 'attempt', '--batch', batch]);
  assert.equal((await grind(env, app, ['review', 'attempt', '--batch', batch])).json.error?.code, 'REVIEW_DELIVERY_BUSY');
  const finished = await grind(env, app, ['review', 'finish', '--batch', batch, '--attempt', attempt.json.data.attempt.id, '--status', 'received', '--row', 'uuid-1']);
  assert.equal(finished.json.data.state, 'received');

  const withReview = await grind(env, app, ['context', 'alpha']);
  assert.deepEqual(withReview.json.data.reviews.map((review: { batch: string; comments: number }) => [review.batch, review.comments]), [[batch, 1]]);
  assert.ok(!JSON.stringify(withReview.json).includes(secret));
  const close = await grind(env, app, ['close', 'alpha', '--outcome', 'delivered', '--result', 'done', '--notes', 'handled']);
  assert.equal(close.json.error?.code, 'PENDING_NOTES');

  assert.equal((await grind(env, app, ['save', 'alpha', '--message', 'checkpoint'])).code, 0);
  assert.equal(await git(ws.stateGitRoot, 'grep', '-c', secret, 'HEAD').catch(() => 'absent'), 'absent');
  assert.equal(await git(ws.stateGitRoot, 'status', '--porcelain'), '');

  await grind(env, app, ['review', 'resolve', batch, '--note', 'addressed']);
  assert.deepEqual((await grind(env, app, ['context', 'alpha'])).json.data.reviews, []);
});

test('watch registers the session and streams a snapshot after another process changes the draft', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'grind-review-watch-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { ...process.env, GRIND_REVIEW_HOME: home, CMUX_WORKSPACE_ID: 'W1', CMUX_SURFACE_ID: 'S1' };
  const child = spawn(process.execPath, [CLI, 'review', 'watch', '--session', 'sess-w', '--json'], { cwd: home, env });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const first = JSON.parse((await lines.next()).value);
  assert.deepEqual([first.type, first.draft, first.registration.cmux], ['snapshot', null, { workspaceId: 'W1', surfaceId: 'S1' }]);

  const sessions = await grind({ GRIND_REVIEW_HOME: home }, home, ['review', 'sessions']);
  assert.deepEqual(sessions.json.data.map((session: { sessionId: string }) => session.sessionId), ['sess-w']);
  await grind({ GRIND_REVIEW_HOME: home }, home, ['review', 'add', '--session', 'sess-w'], JSON.stringify({ source: { kind: 'terminal', surfaceId: 'S1', workspaceId: 'W1', sessionId: 'sess-w' }, quote: 'seen' }));
  let next = JSON.parse((await lines.next()).value);
  while (next.draft === null) next = JSON.parse((await lines.next()).value);
  assert.deepEqual(next.draft.comments.map((comment: { quote: string }) => comment.quote), ['seen']);

  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('close', resolve));
  assert.deepEqual((await grind({ GRIND_REVIEW_HOME: home }, home, ['review', 'sessions'])).json.data, []);
});
