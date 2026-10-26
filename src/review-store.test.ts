import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { formatBatch, INLINE_PAYLOAD_LIMIT, promptPayload } from './review-payload.ts';
import {
  addComment, associateDraft, changeComment, finishAttempt, listBatches, openInitiativeBatches, readDelivery, readDraft, startAttempt, submitDraft,
  type ReviewAssociation, type ReviewSource, type ReviewStore,
} from './review-store.ts';
import { findDeliveredRow, reconcileBatch } from './review-transcript.ts';

const REPLY: ReviewSource = { kind: 'claude-reply', sessionId: 's1', messageId: 'm1' };
const INIT: ReviewAssociation = { workspace: '/ws', initiative: 'audio/nav', source: 'inferred' };

async function tempStore(t: { after: (fn: () => Promise<void>) => void }): Promise<ReviewStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'grind-reviews-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root };
}

test('concurrent writers keep every comment, and a stale revision changes nothing', async (t) => {
  const store = await tempStore(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => addComment(store, 's1', { source: REPLY, quote: `quote ${i}`, association: INIT })));
  const draft = await readDraft(store, 's1');
  assert.equal(draft?.comments.length, 12);
  assert.equal(draft?.revision, 12);
  assert.deepEqual(new Set(draft?.comments.map((comment) => comment.id)).size, 12);

  await assert.rejects(changeComment(store, 's1', 'c1', { kind: 'edit', body: 'late' }, 3), { code: 'REVIEW_STALE' });
  assert.equal((await readDraft(store, 's1'))?.comments[0]?.body, '');
});

test('delete and restore are revisions of the same draft, and a deleted comment is not sent', async (t) => {
  const store = await tempStore(t);
  const first = await addComment(store, 's1', { source: REPLY, quote: 'keep', body: 'one', association: INIT });
  await addComment(store, 's1', { source: REPLY, quote: 'drop', body: 'two', association: INIT });
  await changeComment(store, 's1', 'c2', { kind: 'delete' }, 2);
  await changeComment(store, 's1', 'c1', { kind: 'delete' }, 3);
  const restored = await changeComment(store, 's1', 'c1', { kind: 'restore' }, 4);
  assert.deepEqual(restored.comments.map((comment) => [comment.id, comment.deletedAt === null]), [['c1', true], ['c2', false]]);
  const { submission } = await submitDraft(store, 's1', first.draft.id, restored.revision);
  assert.deepEqual(submission.comments.map((comment) => comment.quote), ['keep']);
});

test('submit freezes exactly the reviewed revision once, and later edits start a new draft', async (t) => {
  const store = await tempStore(t);
  const { draft } = await addComment(store, 's1', { source: REPLY, quote: 'alpha', body: 'fix this', association: INIT });
  await assert.rejects(submitDraft(store, 's1', draft.id, draft.revision + 1), { code: 'REVIEW_STALE' });

  const sent = await submitDraft(store, 's1', draft.id, draft.revision);
  assert.equal(sent.repeated, false);
  assert.deepEqual(sent.submission.comments.map((comment) => comment.body), ['fix this']);
  assert.deepEqual(sent.draft.comments, []);
  assert.deepEqual(sent.draft.association, INIT);

  const again = await submitDraft(store, 's1', draft.id, draft.revision);
  assert.equal(again.repeated, true);
  assert.equal(again.submission.id, sent.submission.id);
  assert.equal((await listBatches(store)).length, 1);

  await addComment(store, 's1', { source: REPLY, quote: 'beta', association: INIT });
  assert.deepEqual((await listBatches(store))[0]?.submission.comments.map((comment) => comment.quote), ['alpha']);
});

test('an empty draft and a failed write keep the comments', async (t) => {
  const store = await tempStore(t);
  const { draft } = await addComment(store, 's1', { source: REPLY, quote: 'only', association: INIT });
  const deleted = await changeComment(store, 's1', 'c1', { kind: 'delete' });
  await assert.rejects(submitDraft(store, 's1', draft.id, deleted.revision), { code: 'REVIEW_EMPTY' });
  const restored = await changeComment(store, 's1', 'c1', { kind: 'restore' });

  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    await mkdir(path.join(store.root, 'submissions'), { recursive: true });
    await chmod(path.join(store.root, 'submissions'), 0o500);
    await assert.rejects(submitDraft(store, 's1', draft.id, restored.revision));
    const kept = await readDraft(store, 's1');
    assert.equal(kept?.id, draft.id);
    assert.deepEqual(kept?.comments.map((comment) => comment.quote), ['only']);
    await chmod(path.join(store.root, 'submissions'), 0o700);
  }
  assert.equal((await submitDraft(store, 's1', draft.id, restored.revision)).submission.comments.length, 1);
});

test('a draft keeps its association until it is changed explicitly', async (t) => {
  const store = await tempStore(t);
  await addComment(store, 's1', { source: REPLY, quote: 'one', association: INIT });
  const other: ReviewAssociation = { workspace: '/ws', initiative: 'other', source: 'inferred' };
  const second = await addComment(store, 's1', { source: REPLY, quote: 'two', association: other });
  assert.deepEqual(second.draft.association, INIT);
  const changed = await associateDraft(store, 's1', { ...other, source: 'explicit' });
  assert.equal(changed.association.initiative, 'other');
  await addComment(store, 's2', { source: { ...REPLY, sessionId: 's2' }, quote: 'elsewhere', association: other });
  assert.equal((await readDraft(store, 's1'))?.comments.length, 2);
});

test('delivery never enqueues a batch twice and keeps a receipt once recorded', async (t) => {
  const store = await tempStore(t);
  const { draft } = await addComment(store, 's1', { source: REPLY, quote: 'x', association: INIT });
  const { submission } = await submitDraft(store, 's1', draft.id, draft.revision);

  const first = await startAttempt(store, submission.id);
  await assert.rejects(startAttempt(store, submission.id), { code: 'REVIEW_DELIVERY_BUSY' });
  await finishAttempt(store, submission.id, first.attempt.id, { status: 'dropped', reason: 'removed from the queue' });

  const second = await startAttempt(store, submission.id);
  await finishAttempt(store, submission.id, second.attempt.id, { status: 'unknown', reason: 'reloaded' });
  await assert.rejects(startAttempt(store, submission.id), { code: 'REVIEW_DELIVERY_BUSY' });
  const third = await startAttempt(store, submission.id, { afterUnknown: true });
  const received = await finishAttempt(store, submission.id, third.attempt.id, { status: 'received', rowUuid: 'row-1' });
  assert.deepEqual([received.state, received.rowUuid], ['received', 'row-1']);
  const late = await finishAttempt(store, submission.id, second.attempt.id, { status: 'failed' });
  assert.equal(late.state, 'received');
  await assert.rejects(startAttempt(store, submission.id), { code: 'REVIEW_DELIVERY_BUSY' });
  assert.equal((await openInitiativeBatches(store, '/ws', 'audio/nav')).length, 1);
});

test('reconcile accepts only this session’s row carrying the marker from the plugin or the person, and absence stays unknown', async (t) => {
  const store = await tempStore(t);
  const { draft } = await addComment(store, 's1', { source: REPLY, quote: 'x', association: INIT });
  const { submission } = await submitDraft(store, 's1', draft.id, draft.revision);
  const { attempt } = await startAttempt(store, submission.id);
  const transcript = path.join(store.root, 'transcript.jsonl');
  const text = formatBatch(submission);
  const row = (fields: Record<string, unknown>) => JSON.stringify({ type: 'user', sessionId: 's1', uuid: 'u-typed', origin: { kind: 'plugin', name: 'grind' }, message: { role: 'user', content: text }, ...fields });
  await writeFile(transcript, [
    row({ uuid: 'u-other-session', sessionId: 's2' }),
    row({ uuid: 'u-other-plugin', origin: { kind: 'plugin', name: 'elsewhere' } }),
    'not json',
  ].join('\n') + '\n');
  const missing = await reconcileBatch(store, submission.id, { transcript });
  assert.equal(missing.delivery.state, 'unknown');
  assert.equal(missing.delivery.attempts.find((item) => item.id === attempt.id)?.reason, 'not found in transcript');

  await writeFile(transcript, `${row({ uuid: 'u-blocks', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`, { flag: 'a' });
  assert.equal(await findDeliveredRow(transcript, 's1', submission.id, 'grind'), 'u-blocks');
  const found = await reconcileBatch(store, submission.id, { transcript });
  assert.deepEqual([found.delivery.state, found.delivery.rowUuid], ['received', 'u-blocks']);

  const unavailable = await submitDraft(store, 's1', (await addComment(store, 's1', { source: REPLY, quote: 'y', association: INIT })).draft.id, 1);
  await startAttempt(store, unavailable.submission.id);
  const result = await reconcileBatch(store, unavailable.submission.id, { env: { CLAUDE_CONFIG_DIR: path.join(store.root, 'no-claude') } });
  assert.deepEqual([result.delivery.state, result.transcript], ['unknown', null]);
});

test('quotes survive storage and the prompt byte for byte, fenced apart from feedback', async (t) => {
  const store = await tempStore(t);
  const quote = 'Ünïcode — 日本語 ✓\n  indented `code` and ~~~ fences ~~~~\n\ttab and trailing space ';
  const { draft } = await addComment(store, 's1', { source: REPLY, quote, body: 'Explain **why**', association: INIT });
  const { submission } = await submitDraft(store, 's1', draft.id, draft.revision);
  assert.equal(submission.comments[0]?.quote, quote);
  const text = formatBatch(submission);
  assert.ok(text.includes(`~~~~~quote\n${quote}\n~~~~~\nFeedback:\nExplain **why**`));
  assert.ok(text.startsWith(`<grind-review batch=${submission.id} comments=1 init=audio/nav>`));

  const inline = promptPayload(submission, 'node grind.mjs review show-batch x --prompt');
  assert.deepEqual([inline.inline, inline.text], [true, text]);
  const large = { ...submission, comments: Array.from({ length: 3 }, (_, i) => ({ ...(submission.comments[0] as (typeof submission.comments)[number]), id: `c${i}`, quote: 'q'.repeat(INLINE_PAYLOAD_LIMIT / 2) })) };
  const reference = promptPayload(large, 'node grind.mjs review show-batch x --prompt');
  assert.equal(reference.inline, false);
  assert.ok(reference.text.includes(`grind-review batch=${submission.id}`));
  assert.ok(reference.text.includes('node grind.mjs review show-batch x --prompt'));
  assert.ok(reference.text.length < 1000);
});

test('invalid input is refused before anything is written', async (t) => {
  const store = await tempStore(t);
  await assert.rejects(addComment(store, '../escape', { source: REPLY, quote: 'x', association: INIT }), { code: 'USAGE' });
  await assert.rejects(addComment(store, 's1', { source: REPLY, quote: '   ', association: INIT }), { code: 'REVIEW_INVALID' });
  await assert.rejects(addComment(store, 's1', { source: REPLY, quote: 'x'.repeat(20_001), association: INIT }), { code: 'REVIEW_INVALID' });
  assert.deepEqual((await readdir(store.root).catch(() => [])).filter((name) => name !== 'change'), []);
  assert.equal((await readDelivery(store, 'b-missing').catch((error: { code: string }) => error.code)), 'REVIEW_INVALID');
});

test('a lock left by a dead writer or without an owner does not block later writes', async (t) => {
  const store = await tempStore(t);
  const lock = path.join(store.root, '.lock');
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname() }));
  assert.equal((await addComment(store, 's1', { source: REPLY, quote: 'after a crash', association: INIT })).draft.revision, 1);

  await mkdir(lock);
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  assert.equal((await addComment(store, 's1', { source: REPLY, quote: 'after an ownerless lock', association: INIT })).draft.revision, 2);
});
