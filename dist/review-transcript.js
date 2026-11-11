import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathExists } from './paths.js';
import { batchMarker } from './review-payload.js';
import { assertSessionId, finishAttempt, readDelivery } from './review-store.js';
/** Claude Code's transcript file for a session, or null when none is found. */
export async function findTranscript(sessionId, env = process.env) {
    assertSessionId(sessionId);
    const projects = path.join(env['CLAUDE_CONFIG_DIR'] ? path.resolve(env['CLAUDE_CONFIG_DIR']) : path.join(os.homedir(), '.claude'), 'projects');
    const folders = await readdir(projects, { withFileTypes: true }).catch(() => []);
    for (const folder of folders) {
        if (!folder.isDirectory())
            continue;
        const candidate = path.join(projects, folder.name, `${sessionId}.jsonl`);
        if (await pathExists(candidate))
            return candidate;
    }
    return null;
}
function rowText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    return content.map((block) => (typeof block === 'object' && block !== null && typeof block.text === 'string' ? block.text : '')).join('\n');
}
/**
 * The stored user row that delivered the batch: this session's, carrying the
 * batch marker, submitted by the plugin or typed by the person from the
 * prompt box the plugin filled.
 */
export async function findDeliveredRow(transcript, sessionId, batchId, plugin) {
    const marker = batchMarker(batchId);
    const lines = createInterface({ input: createReadStream(transcript, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) {
        if (!line.includes(marker))
            continue;
        let row;
        try {
            row = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (row.type !== 'user' || row.sessionId !== sessionId || typeof row.uuid !== 'string')
            continue;
        const typed = row.origin === undefined || row.origin.kind === 'human' || row.origin.kind === 'composer';
        if (!typed && (row.origin?.kind !== 'plugin' || row.origin.name !== plugin))
            continue;
        if (rowText(row.message?.content).includes(marker))
            return row.uuid;
    }
    return null;
}
/**
 * Settles an interrupted or uncertain attempt from the transcript: received
 * when the stored row is there, otherwise unknown. Absence never proves the
 * batch was not delivered, so nothing is resent here.
 */
export async function reconcileBatch(store, batchId, options = {}) {
    const delivery = await readDelivery(store, batchId);
    const open = delivery.attempts.filter((attempt) => attempt.status === 'sending' || attempt.status === 'unknown');
    if (delivery.state === 'received' || open.length === 0)
        return { delivery, transcript: options.transcript ?? null, found: delivery.rowUuid };
    const transcript = options.transcript ?? (await findTranscript(delivery.sessionId, options.env));
    const found = transcript === null ? null : await findDeliveredRow(transcript, delivery.sessionId, batchId, options.plugin ?? 'grind');
    let next = delivery;
    for (const attempt of open) {
        if (found !== null && attempt === open.at(-1))
            next = await finishAttempt(store, batchId, attempt.id, { status: 'received', rowUuid: found, reason: 'found in transcript' });
        else if (attempt.status === 'sending') {
            next = await finishAttempt(store, batchId, attempt.id, { status: 'unknown', reason: transcript === null ? 'transcript unavailable' : 'not found in transcript' });
        }
    }
    return { delivery: next, transcript, found };
}
//# sourceMappingURL=review-transcript.js.map