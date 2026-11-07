import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrindError } from './errors.js';
import { atomicWriteFile } from './operations.js';
export const REVIEW_SCHEMA_VERSION = 1;
export const MAX_QUOTE_LENGTH = 20_000;
export const MAX_BODY_LENGTH = 20_000;
const LOCK_WAIT_MS = 5_000;
// A lock is written with its owner at once, so one without an owner this old was abandoned.
const STALE_OWNERLESS_MS = 30_000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RECORD_ID = /^[a-z]-[A-Za-z0-9-]{1,80}$/;
/** The local review store: outside every Git-tracked state repository, private to this user and machine. */
export function reviewStore(env = process.env) {
    if (env['GRIND_REVIEW_HOME'])
        return { root: path.resolve(env['GRIND_REVIEW_HOME']) };
    if (process.platform === 'win32') {
        return { root: path.join(env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'grind', 'reviews') };
    }
    const stateHome = env['XDG_STATE_HOME'] ? path.resolve(env['XDG_STATE_HOME']) : path.join(os.homedir(), '.local', 'state');
    return { root: path.join(stateHome, 'grind', 'reviews') };
}
export function assertSessionId(sessionId) {
    if (!SESSION_ID.test(sessionId))
        throw new GrindError('USAGE', `Invalid session id "${sessionId}"`);
}
function assertRecordId(id) {
    if (!RECORD_ID.test(id))
        throw new GrindError('USAGE', `Invalid review record id "${id}"`);
}
const draftPath = (store, sessionId) => path.join(store.root, 'drafts', `${sessionId}.json`);
const submissionPath = (store, batchId) => path.join(store.root, 'submissions', `${batchId}.json`);
const deliveryPath = (store, batchId) => path.join(store.root, 'delivery', `${batchId}.json`);
const sessionPath = (store, sessionId) => path.join(store.root, 'sessions', `${sessionId}.json`);
export const changePath = (store) => path.join(store.root, 'change');
async function readJson(file) {
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== REVIEW_SCHEMA_VERSION)
            throw new Error(`unsupported schemaVersion ${String(parsed.schemaVersion)}`);
        return parsed;
    }
    catch (error) {
        throw new GrindError('REVIEW_INVALID', `Review record ${file} is unreadable: ${error.message}`, { path: file });
    }
}
async function writeJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
async function createJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
function processAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
/** Runs `action` holding the store's lock, waiting briefly for another writer and clearing a lock whose owner died. */
export async function withReviewLock(store, action) {
    const lock = path.join(store.root, '.lock');
    await mkdir(store.root, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        try {
            await mkdir(lock);
            break;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            const owner = await readFile(path.join(lock, 'owner.json'), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
            const ownerless = owner === null && Date.now() - ((await stat(lock).catch(() => null))?.mtimeMs ?? Date.now()) > STALE_OWNERLESS_MS;
            if (ownerless || (owner !== null && owner.host === os.hostname() && !processAlive(owner.pid))) {
                await rm(lock, { recursive: true, force: true });
                continue;
            }
            if (Date.now() > deadline) {
                throw new GrindError('STATE_LOCKED', `Review store lock is held at ${lock}`, { lock, owner });
            }
            await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 50));
        }
    }
    try {
        await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString() }));
        const result = await action();
        await writeFile(changePath(store), `${Date.now()}-${randomUUID()}\n`);
        return result;
    }
    finally {
        await rm(lock, { recursive: true, force: true });
    }
}
function now() {
    return new Date().toISOString();
}
function newId(prefix) {
    return `${prefix}-${now().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}
function emptyDraft(sessionId, association, previous = null) {
    const at = now();
    return { schemaVersion: 1, id: newId('d'), sessionId, createdAt: at, updatedAt: at, revision: 0, association, comments: [], nextComment: 1, previous };
}
export async function readDraft(store, sessionId) {
    assertSessionId(sessionId);
    return readJson(draftPath(store, sessionId));
}
function checkExpected(draft, expected) {
    const actual = { draftId: draft?.id ?? null, revision: draft?.revision ?? 0 };
    if ((expected.draftId !== undefined && expected.draftId !== actual.draftId) || (expected.revision !== undefined && expected.revision !== actual.revision)) {
        throw new GrindError('REVIEW_STALE', 'The draft changed since it was read; reload it and retry', { expected, actual });
    }
}
function checkText(quote, body) {
    if (quote.length > MAX_QUOTE_LENGTH)
        throw new GrindError('REVIEW_INVALID', `A quote is limited to ${MAX_QUOTE_LENGTH} characters; select a shorter passage`);
    if (body.length > MAX_BODY_LENGTH)
        throw new GrindError('REVIEW_INVALID', `A comment is limited to ${MAX_BODY_LENGTH} characters`);
}
/** Adds a comment to the session's draft, starting a draft when there is none. */
export async function addComment(store, sessionId, input) {
    assertSessionId(sessionId);
    if (input.quote.trim() === '')
        throw new GrindError('REVIEW_INVALID', 'A review comment needs a nonempty quote');
    const body = input.body ?? '';
    checkText(input.quote, body);
    return withReviewLock(store, async () => {
        const existing = await readDraft(store, sessionId);
        checkExpected(existing, input.expected ?? {});
        const draft = existing ?? emptyDraft(sessionId, input.association);
        const at = now();
        const comment = { id: `c${draft.nextComment}`, source: input.source, quote: input.quote, body, capturedAt: at, updatedAt: at, deletedAt: null };
        const next = { ...draft, revision: draft.revision + 1, updatedAt: at, nextComment: draft.nextComment + 1, comments: [...draft.comments, comment] };
        await writeJson(draftPath(store, sessionId), next);
        return { draft: next, comment };
    });
}
export async function changeComment(store, sessionId, commentId, change, expected = {}) {
    assertSessionId(sessionId);
    if (change.kind === 'edit')
        checkText('', change.body);
    return withReviewLock(store, async () => {
        const draft = await readDraft(store, sessionId);
        checkExpected(draft, expected);
        const target = draft?.comments.find((comment) => comment.id === commentId);
        if (draft === null || target === undefined)
            throw new GrindError('REVIEW_INVALID', `The draft has no comment ${commentId}`, { commentId });
        const at = now();
        const updated = change.kind === 'edit' ? { ...target, body: change.body, updatedAt: at } : { ...target, deletedAt: change.kind === 'delete' ? at : null, updatedAt: at };
        const next = { ...draft, revision: draft.revision + 1, updatedAt: at, comments: draft.comments.map((comment) => (comment.id === commentId ? updated : comment)) };
        await writeJson(draftPath(store, sessionId), next);
        return next;
    });
}
/** Changes the init a draft belongs to; only an explicit request does this. */
export async function associateDraft(store, sessionId, association, expected = {}) {
    assertSessionId(sessionId);
    return withReviewLock(store, async () => {
        const existing = await readDraft(store, sessionId);
        checkExpected(existing, expected);
        const draft = existing ?? emptyDraft(sessionId, association);
        const next = { ...draft, association, revision: draft.revision + 1, updatedAt: now() };
        await writeJson(draftPath(store, sessionId), next);
        return next;
    });
}
/**
 * Freezes exactly the reviewed revision into an immutable batch and starts an
 * empty draft with the same association.
 */
export async function submitDraft(store, sessionId, draftId, revision) {
    assertSessionId(sessionId);
    return withReviewLock(store, async () => {
        const draft = await readDraft(store, sessionId);
        if (draft?.previous && draft.previous.draftId === draftId && draft.previous.revision === revision) {
            const submission = await readSubmission(store, draft.previous.batchId);
            return { submission, delivery: await readDelivery(store, submission.id), draft, repeated: true };
        }
        if (draft === null || draft.id !== draftId || draft.revision !== revision) {
            throw new GrindError('REVIEW_STALE', 'The draft changed since it was reviewed; reload it and send again', {
                expected: { draftId, revision },
                actual: draft === null ? null : { draftId: draft.id, revision: draft.revision },
            });
        }
        const comments = draft.comments.filter((comment) => comment.deletedAt === null);
        if (comments.length === 0)
            throw new GrindError('REVIEW_EMPTY', 'The draft has no comments to send');
        const at = now();
        const submission = {
            schemaVersion: 1, id: newId('b'), sessionId, draftId: draft.id, revision: draft.revision, submittedAt: at, association: draft.association, comments,
        };
        const delivery = {
            schemaVersion: 1, batchId: submission.id, sessionId, state: 'pending', rowUuid: null, attempts: [], resolution: { state: 'open', at: null, note: null },
        };
        await createJson(submissionPath(store, submission.id), submission);
        try {
            await createJson(deliveryPath(store, submission.id), delivery);
        }
        catch (error) {
            await rm(submissionPath(store, submission.id), { force: true });
            throw error;
        }
        const next = emptyDraft(sessionId, draft.association, { draftId: draft.id, revision: draft.revision, batchId: submission.id });
        await writeJson(draftPath(store, sessionId), next);
        return { submission, delivery, draft: next, repeated: false };
    });
}
export async function readSubmission(store, batchId) {
    assertRecordId(batchId);
    const submission = await readJson(submissionPath(store, batchId));
    if (submission === null)
        throw new GrindError('REVIEW_INVALID', `No review batch ${batchId}`, { batchId });
    return submission;
}
export async function readDelivery(store, batchId) {
    assertRecordId(batchId);
    const delivery = await readJson(deliveryPath(store, batchId));
    if (delivery === null)
        throw new GrindError('REVIEW_INVALID', `No delivery record for ${batchId}`, { batchId });
    return delivery;
}
/**
 * Starts a delivery attempt. Refuses while one is in flight or after the batch
 * was received, so repeated clicks never enqueue the batch twice; after an
 * unknown outcome only an explicit confirmation sends it again.
 */
export async function startAttempt(store, batchId, options = {}) {
    return withReviewLock(store, async () => {
        const delivery = await readDelivery(store, batchId);
        if (delivery.state === 'sending' || delivery.state === 'received') {
            throw new GrindError('REVIEW_DELIVERY_BUSY', `Batch ${batchId} is ${delivery.state}; it is not sent again`, { batchId, state: delivery.state });
        }
        if (delivery.state === 'unknown' && !options.afterUnknown) {
            throw new GrindError('REVIEW_DELIVERY_BUSY', `Batch ${batchId} may already have been received; reconcile it, then confirm a resend explicitly`, { batchId, state: delivery.state });
        }
        const at = now();
        const attempt = { id: newId('a'), startedAt: at, updatedAt: at, status: 'sending', rowUuid: null, reason: null };
        const next = { ...delivery, state: 'sending', attempts: [...delivery.attempts, attempt] };
        await writeJson(deliveryPath(store, batchId), next);
        return { delivery: next, attempt };
    });
}
/** Records how an attempt (or `latest`) ended. A received batch stays received whatever a later report says. */
export async function finishAttempt(store, batchId, attemptId, outcome) {
    if (outcome.status === 'received' && !outcome.rowUuid)
        throw new GrindError('USAGE', 'A received attempt needs the stored row uuid');
    return withReviewLock(store, async () => {
        const delivery = await readDelivery(store, batchId);
        const attempt = attemptId === 'latest' ? delivery.attempts.at(-1) : delivery.attempts.find((item) => item.id === attemptId);
        if (attempt === undefined)
            throw new GrindError('REVIEW_INVALID', `Batch ${batchId} has no attempt ${attemptId}`, { batchId, attemptId });
        if (attempt.status === 'received')
            return delivery;
        const updated = { ...attempt, status: outcome.status, rowUuid: outcome.rowUuid ?? attempt.rowUuid, reason: outcome.reason ?? null, updatedAt: now() };
        const attempts = delivery.attempts.map((item) => (item.id === attempt.id ? updated : item));
        const received = attempts.find((item) => item.status === 'received');
        const latest = attempts.at(-1);
        const next = {
            ...delivery,
            attempts,
            state: received ? 'received' : latest.status,
            rowUuid: received?.rowUuid ?? null,
        };
        await writeJson(deliveryPath(store, batchId), next);
        return next;
    });
}
export async function resolveBatch(store, batchId, note) {
    return withReviewLock(store, async () => {
        const delivery = await readDelivery(store, batchId);
        const next = { ...delivery, resolution: { state: 'resolved', at: now(), note } };
        await writeJson(deliveryPath(store, batchId), next);
        return next;
    });
}
/** Submitted batches, newest first, optionally narrowed to a session or an init. */
export async function listBatches(store, filter = {}) {
    const names = await readdir(path.join(store.root, 'submissions')).catch((error) => {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    });
    const batches = [];
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
        const submission = await readSubmission(store, name.slice(0, -'.json'.length));
        if (filter.sessionId !== undefined && submission.sessionId !== filter.sessionId)
            continue;
        if (filter.workspace !== undefined && submission.association.workspace !== filter.workspace)
            continue;
        if (filter.initiative !== undefined && submission.association.initiative !== filter.initiative)
            continue;
        batches.push({ submission, delivery: await readDelivery(store, submission.id) });
    }
    return batches.sort((a, b) => b.submission.submittedAt.localeCompare(a.submission.submittedAt));
}
/** Submitted batches of an init that are not yet marked resolved. */
export async function openInitiativeBatches(store, workspace, initiative) {
    return (await listBatches(store, { workspace, initiative })).filter((batch) => batch.delivery.resolution.state === 'open');
}
export async function registerSession(store, registration) {
    assertSessionId(registration.sessionId);
    return withReviewLock(store, async () => {
        const previous = await readJson(sessionPath(store, registration.sessionId));
        const next = { schemaVersion: 1, ...registration, registeredAt: now(), endedAt: null, binding: previous?.binding ?? null };
        await writeJson(sessionPath(store, registration.sessionId), next);
        return next;
    });
}
/** Marks the session ended, but only while `pid` still owns the registration. */
export async function endSession(store, sessionId, pid) {
    assertSessionId(sessionId);
    await withReviewLock(store, async () => {
        const current = await readJson(sessionPath(store, sessionId));
        if (current === null || current.pid !== pid || current.endedAt !== null)
            return;
        await writeJson(sessionPath(store, sessionId), { ...current, endedAt: now() });
    });
}
export async function bindSession(store, sessionId, binding) {
    assertSessionId(sessionId);
    return withReviewLock(store, async () => {
        const current = await readJson(sessionPath(store, sessionId));
        if (current === null)
            throw new GrindError('REVIEW_INVALID', `Session ${sessionId} is not registered`, { sessionId });
        const next = { ...current, binding };
        await writeJson(sessionPath(store, sessionId), next);
        return next;
    });
}
export async function readSession(store, sessionId) {
    assertSessionId(sessionId);
    return readJson(sessionPath(store, sessionId));
}
/** Registered sessions whose watcher still runs on this machine. */
export async function liveSessions(store) {
    const names = await readdir(path.join(store.root, 'sessions')).catch((error) => {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    });
    const sessions = [];
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
        const registration = await readJson(path.join(store.root, 'sessions', name)).catch(() => null);
        if (registration === null || registration.endedAt !== null)
            continue;
        if (registration.host !== os.hostname() || !processAlive(registration.pid))
            continue;
        sessions.push(registration);
    }
    return sessions.sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
}
/** Unresolved submitted batches of an init, as references without quoted text. */
export async function initiativeReviewReferences(workspace, initiative, store = reviewStore()) {
    return (await openInitiativeBatches(store, workspace, initiative)).map(({ submission, delivery }) => ({
        batch: submission.id,
        submittedAt: submission.submittedAt,
        comments: submission.comments.length,
        delivery: delivery.state,
        read: `grind review show-batch ${submission.id} --prompt`,
    }));
}
//# sourceMappingURL=review-store.js.map