import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from '../errors.js';
import { isRecord } from '../frontmatter.js';
import { composeBrief } from './brief.js';
import { responseSchema } from './engines.js';
import { isTerminal, pendingTurns, recordResponse, sha256 } from './protocol.js';
import { paths, readRecord, readState } from './runtime.js';
import { discussionDir, readJson, withLock, writeJsonAtomic } from './store.js';
export function callerIdentity(env) {
    if (env['CODEX_THREAD_ID'])
        return `codex:${env['CODEX_THREAD_ID']}`;
    if (env['CLAUDE_CODE_SESSION_ID'])
        return `claude:${env['CLAUDE_CODE_SESSION_ID']}`;
    return null;
}
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (isRecord(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
export function callerDeadline(record, state, turnId) {
    const assigned = state.turns[turnId]?.assignedAt;
    return Math.min(state.deadline ? Date.parse(state.deadline) : Infinity, assigned ? Date.parse(assigned) + record.config.limits.turnTimeoutSeconds * 1000 : Infinity);
}
export async function callerAssignment(dir, record, state) {
    if (state.status !== 'running' || isTerminal(state.protocol))
        return null;
    if (state.deadline && Date.now() >= Date.parse(state.deadline))
        return null;
    if (await readJson(paths.stop(dir)))
        return null;
    const participant = record.config.participants.find((p) => p.execution === 'caller');
    if (!participant)
        return null;
    const turn = pendingTurns(state.protocol).find((t) => t.participant === participant.id);
    if (!turn || Date.now() >= callerDeadline(record, state, turn.id) || await readJson(paths.submission(dir, turn.id)))
        return null;
    const contextDir = path.join(dir, 'context', turn.snapshotId);
    const bundlePath = path.join(contextDir, 'bundle.md');
    const workDir = path.join(paths.participant(dir, participant.id), 'work');
    return {
        discussionId: record.id, participant: participant.id, turnId: turn.id,
        phase: turn.kind, revision: turn.revision, candidateHash: turn.candidateHash,
        snapshotId: turn.snapshotId, identity: record.callerIdentity ?? null,
        assignment: composeBrief({ state: state.protocol, turn, brief: record.brief, init: record.init, participant, writer: record.config.writer, bundle: await readFile(bundlePath, 'utf8'), bundlePath, sourceRoots: state.snapshot.manifest.readableRoots, workDir }),
        responseSchema: responseSchema(turn.kind),
        contextPaths: { bundle: bundlePath, manifest: path.join(contextDir, 'manifest.json'), work: workDir },
    };
}
export async function submitCaller(service, id, response, options = {}) {
    const dir = discussionDir(id, service.env);
    return withLock(dir, 'state', async () => {
        const record = await readRecord(dir);
        const state = await readState(dir);
        if (!record || !state)
            throw new GrindError('DISCUSSION_NOT_FOUND', `No discussion ${id}`);
        if (!isRecord(response) || typeof response['turnId'] !== 'string')
            throw new GrindError('DISCUSSION_RESPONSE_INVALID', 'Response must contain a turnId');
        const turn = state.protocol.turns[response['turnId']];
        const participant = record.config.participants.find((p) => p.id === turn?.participant && p.execution === 'caller');
        if (!turn || !participant)
            throw new GrindError('DISCUSSION_RESPONSE_INVALID', 'Response does not identify a caller turn');
        const file = paths.submission(dir, turn.id);
        const responseHash = sha256(canonical(response));
        const existing = await readJson(file);
        if (existing) {
            if (existing.receipt.responseHash !== responseHash)
                throw new GrindError('DISCUSSION_RESPONSE_CONFLICT', 'This turn already has a different response');
            return existing.receipt;
        }
        if (state.status !== 'running' || isTerminal(state.protocol) || await readJson(paths.stop(dir)) || Date.now() >= callerDeadline(record, state, turn.id)) {
            throw new GrindError('DISCUSSION_RESPONSE_STALE', 'Discussion is not accepting caller responses');
        }
        const verdict = recordResponse(structuredClone(state.protocol), turn.id, response);
        if (!verdict.accepted)
            throw new GrindError('DISCUSSION_RESPONSE_INVALID', verdict.detail);
        const identity = callerIdentity(service.env);
        const owner = record.callerIdentity ?? null;
        if (owner !== null && owner !== identity && !options.handoff)
            throw new GrindError('DISCUSSION_CALLER_HANDOFF', 'Caller identity differs; use --handoff to explicitly attribute this response to the new session');
        const receipt = { discussionId: id, turnId: turn.id, participant: participant.id, responseHash, receivedAt: new Date().toISOString(), identity, handoffFrom: owner !== identity ? owner : null };
        await writeJsonAtomic(file, { receipt, response });
        return receipt;
    }, service.probe);
}
//# sourceMappingURL=caller.js.map