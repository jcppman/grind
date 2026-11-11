import { createHash } from 'node:crypto';
import { isRecord } from '../frontmatter.js';
export const TERMINAL_PHASES = ['agreed', 'unresolved', 'failed', 'cancelled'];
export const PROPOSAL_TARGET = 'proposal';
export function candidateHash(documents, assumptions) {
    const manifest = {
        documents: [...documents].sort((a, b) => a.target.localeCompare(b.target)).map((doc) => ({ target: doc.target, sha256: sha256(doc.content), content: doc.content })),
        assumptions,
    };
    return sha256(JSON.stringify(manifest));
}
export function sha256(text) {
    return createHash('sha256').update(text).digest('hex');
}
export function createProtocol(options) {
    const state = {
        discussionId: options.discussionId,
        participants: [...options.participants],
        writer: options.writer,
        targets: options.targets.length === 0 ? [PROPOSAL_TARGET] : [...options.targets],
        maxRounds: options.maxRounds,
        phase: 'assess',
        round: 0,
        snapshot: { ...options.snapshot },
        driftRestarts: 0,
        nextTurn: 1,
        turns: {},
        assessments: {},
        candidates: [],
        decisions: [],
        openIssues: [],
        pendingInput: [],
        incorporatedInput: [],
        questions: [],
        outcome: null,
    };
    issueAssessments(state);
    return state;
}
export function isTerminal(state) {
    return TERMINAL_PHASES.includes(state.phase);
}
export function latestCandidate(state) {
    return state.candidates.at(-1) ?? null;
}
export function pendingTurns(state) {
    return Object.values(state.turns).filter((turn) => turn.status === 'pending');
}
function addTurn(state, participant, kind) {
    const candidate = latestCandidate(state);
    const turn = {
        id: `t${String(state.nextTurn).padStart(4, '0')}-${participant}-${kind}`,
        participant,
        kind,
        revision: kind === 'ratify' ? (candidate?.revision ?? null) : kind === 'draft' ? state.candidates.length + 1 : null,
        candidateHash: kind === 'ratify' ? (candidate?.hash ?? null) : null,
        snapshotId: state.snapshot.id,
        status: 'pending',
    };
    state.nextTurn += 1;
    state.turns[turn.id] = turn;
    return turn;
}
function issueAssessments(state) {
    state.phase = 'assess';
    state.assessments = {};
    for (const participant of state.participants)
        addTurn(state, participant, 'assess');
}
function issueDraft(state) {
    state.phase = 'draft';
    addTurn(state, state.writer, 'draft');
}
function issueRatification(state) {
    state.phase = 'ratify';
    state.round += 1;
    state.decisions = [];
    for (const participant of state.participants)
        addTurn(state, participant, 'ratify');
}
/** Ends the discussion with `outcome`, superseding every outstanding turn. */
export function finish(state, outcome) {
    state.phase = outcome.kind;
    state.outcome = outcome;
    for (const turn of Object.values(state.turns))
        if (turn.status === 'pending')
            turn.status = 'superseded';
}
/**
 * Validates a structured response against the turn it claims to answer and records it.
 * Responses for unknown, superseded or already answered turns never change the state.
 */
export function recordResponse(state, turnId, value) {
    const turn = state.turns[turnId];
    if (!turn)
        return { accepted: false, reason: 'unknown_turn', detail: `No turn ${turnId}` };
    if (turn.status === 'done')
        return { accepted: false, reason: 'duplicate', detail: `Turn ${turnId} already has a result` };
    if (turn.status !== 'pending')
        return { accepted: false, reason: 'stale', detail: `Turn ${turnId} is ${turn.status}` };
    const problem = validateResponse(state, turn, value);
    if (problem !== null)
        return { accepted: false, reason: problem.startsWith('mismatch:') ? 'mismatch' : 'invalid', detail: problem };
    const response = value;
    turn.status = 'done';
    if (response.phase === 'assess')
        state.assessments[turn.participant] = response;
    else if (response.phase === 'draft') {
        const documents = response.documents.map((doc) => ({ target: doc.target, content: doc.content }));
        state.candidates.push({
            revision: turn.revision,
            hash: candidateHash(documents, response.assumptions),
            documents,
            assumptions: [...response.assumptions],
            dispositions: response.dispositions,
            summary: response.summary,
            snapshotId: turn.snapshotId,
        });
    }
    else {
        state.decisions.push({ participant: turn.participant, revision: turn.revision, candidateHash: response.candidateHash, decision: response.decision, objections: response.objections, turnId });
    }
    return { accepted: true };
}
/** A participant that fails, times out or answers malformed output blocks agreement for the whole discussion. */
export function recordFailure(state, turnId, reason) {
    const turn = state.turns[turnId];
    if (!turn || turn.status !== 'pending')
        return;
    turn.status = 'failed';
    turn.failure = reason;
    finish(state, { kind: 'failed', reason: `Participant ${turn.participant} failed its ${turn.kind} turn: ${reason}`, participant: turn.participant });
}
export function queueInput(state, input) {
    state.pendingInput.push(input);
}
export function cancel(state, reason = 'Cancelled by request') {
    if (!isTerminal(state))
        finish(state, { kind: 'cancelled', reason });
}
/** Ends the discussion when its total time limit passes, even with turns outstanding. */
export function expire(state) {
    if (!isTerminal(state))
        finish(state, { kind: 'unresolved', reason: 'The total time limit was reached' });
}
/**
 * Advances the protocol once every outstanding turn of the current phase has
 * finished. Returns false while turns remain outstanding or the state is terminal.
 */
export function advance(state, boundary) {
    if (isTerminal(state) || pendingTurns(state).length > 0)
        return false;
    if (boundary.deadlinePassed) {
        finish(state, { kind: 'unresolved', reason: 'The total time limit was reached' });
        return true;
    }
    const drifted = boundary.semanticHash !== state.snapshot.semanticHash;
    if (drifted) {
        if (state.driftRestarts >= 1) {
            finish(state, { kind: 'unresolved', reason: 'Shared context changed substantively more than once' });
            return true;
        }
        state.driftRestarts += 1;
        state.snapshot = { id: boundary.snapshotId, semanticHash: boundary.semanticHash };
        state.decisions = [];
        if (state.candidates.length === 0) {
            issueAssessments(state);
            return true;
        }
        return revise(state);
    }
    const hasNewInput = state.pendingInput.length > 0;
    if (hasNewInput) {
        state.incorporatedInput.push(...state.pendingInput);
        state.pendingInput = [];
        state.questions = [];
        state.decisions = [];
    }
    switch (state.phase) {
        case 'assess':
            issueDraft(state);
            return true;
        case 'draft':
            if (hasNewInput && state.candidates.length > 0)
                return revise(state);
            issueRatification(state);
            return true;
        case 'waiting_input':
            if (!hasNewInput)
                return false;
            return revise(state);
        case 'ratify': {
            if (hasNewInput)
                return revise(state);
            const candidate = latestCandidate(state);
            const current = state.decisions.filter((decision) => decision.revision === candidate.revision && decision.candidateHash === candidate.hash);
            const accepted = state.participants.every((participant) => current.some((decision) => decision.participant === participant && decision.decision === 'accept'));
            state.openIssues = current.flatMap((decision) => decision.objections.map((issue) => ({ ...issue, participant: decision.participant, revision: candidate.revision })));
            if (accepted) {
                finish(state, { kind: 'agreed', reason: `Every participant accepted revision ${candidate.revision}` });
                return true;
            }
            const questions = state.openIssues.filter((issue) => issue.kind === 'user_question');
            if (state.round >= state.maxRounds) {
                finish(state, { kind: 'unresolved', reason: questions.length > 0 ? 'Rounds exhausted with questions that require the user' : 'Rounds exhausted with remaining objections' });
                return true;
            }
            if (questions.length > 0) {
                state.questions = questions;
                state.phase = 'waiting_input';
                return true;
            }
            return revise(state);
        }
        default:
            return false;
    }
}
function revise(state) {
    if (state.round >= state.maxRounds) {
        finish(state, { kind: 'unresolved', reason: 'Rounds exhausted before the candidate could be ratified again' });
        return true;
    }
    issueDraft(state);
    return true;
}
function stringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function validIssues(value, kinds) {
    if (!Array.isArray(value))
        return false;
    const ids = new Set();
    for (const item of value) {
        if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'] === '' || ids.has(item['id']))
            return false;
        if (!kinds.includes(item['kind']) || typeof item['text'] !== 'string' || item['text'].trim() === '' || !stringArray(item['evidence']))
            return false;
        ids.add(item['id']);
    }
    return true;
}
function validateResponse(state, turn, value) {
    if (!isRecord(value))
        return 'Response must be a JSON object';
    if (value['discussionId'] !== state.discussionId)
        return 'mismatch: discussionId';
    if (value['participant'] !== turn.participant)
        return 'mismatch: participant';
    if (value['turnId'] !== turn.id)
        return 'mismatch: turnId';
    if (value['phase'] !== turn.kind)
        return 'mismatch: phase';
    if (value['revision'] !== turn.revision)
        return 'mismatch: revision';
    if (value['snapshotId'] !== turn.snapshotId)
        return 'mismatch: snapshotId';
    if (turn.kind === 'assess') {
        if (typeof value['summary'] !== 'string' || !validIssues(value['findings'], ['finding', 'objection', 'evidence_request', 'user_question']))
            return 'Assessment needs summary and well-formed findings';
    }
    else if (turn.kind === 'draft') {
        if (typeof value['summary'] !== 'string' || !stringArray(value['assumptions']))
            return 'Draft needs summary and assumptions';
        const documents = value['documents'];
        if (!Array.isArray(documents) || documents.some((doc) => !isRecord(doc) || typeof doc['target'] !== 'string' || typeof doc['content'] !== 'string'))
            return 'Draft documents must be {target, content}';
        const targets = documents.map((doc) => doc.target).sort();
        if (JSON.stringify(targets) !== JSON.stringify([...state.targets].sort()))
            return `Draft must contain exactly the targets ${state.targets.join(', ')}`;
        const dispositions = value['dispositions'];
        if (!Array.isArray(dispositions) || dispositions.some((item) => !isRecord(item) || typeof item['issueId'] !== 'string' || !['accepted', 'rejected', 'deferred'].includes(item['disposition']) || typeof item['rationale'] !== 'string'))
            return 'Draft dispositions are malformed';
    }
    else {
        if (!['accept', 'object'].includes(value['decision']))
            return 'Decision must be accept or object';
        if (value['candidateHash'] !== turn.candidateHash)
            return 'mismatch: candidateHash';
        if (!validIssues(value['objections'], ['objection', 'evidence_request', 'user_question']))
            return 'Objections are malformed';
        if (value['decision'] === 'object' && value['objections'].length === 0)
            return 'An objection decision must list its objections';
    }
    return null;
}
//# sourceMappingURL=protocol.js.map