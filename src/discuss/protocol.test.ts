import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, cancel, createProtocol, latestCandidate, pendingTurns, queueInput, recordFailure, recordResponse, type ProtocolState, type Turn } from './protocol.ts';

const SNAP = { id: 's1', semanticHash: 'h1' };
const calm = { semanticHash: 'h1', snapshotId: 's1', deadlinePassed: false };

function fresh(maxRounds = 3, participants = ['a', 'b', 'c']): ProtocolState {
  return createProtocol({ discussionId: 'd1', participants, writer: 'a', targets: ['plan.md'], maxRounds, snapshot: SNAP });
}

function envelope(state: ProtocolState, turn: Turn) {
  return { discussionId: state.discussionId, participant: turn.participant, turnId: turn.id, phase: turn.kind, revision: turn.revision, snapshotId: turn.snapshotId };
}

function answer(state: ProtocolState, decide: (turn: Turn) => 'accept' | 'object' | 'question' = () => 'accept', content = 'v') {
  for (const turn of pendingTurns(state)) {
    const base = envelope(state, turn);
    const value = turn.kind === 'assess'
      ? { ...base, summary: 's', findings: [] }
      : turn.kind === 'draft'
        ? { ...base, summary: 's', documents: [{ target: 'plan.md', content: `${content}${turn.revision}` }], assumptions: [], dispositions: [] }
        : (() => {
          const choice = decide(turn);
          return { ...base, decision: choice === 'accept' ? 'accept' : 'object', candidateHash: turn.candidateHash, objections: choice === 'accept' ? [] : [{ id: `${turn.participant}-1`, kind: choice === 'question' ? 'user_question' : 'objection', text: 'no', evidence: [] }] };
        })();
    assert.deepEqual(recordResponse(state, turn.id, value), { accepted: true });
  }
  advance(state, calm);
}

test('independent assessment, a draft and unanimous acceptance of that exact revision agree', () => {
  const state = fresh();
  assert.deepEqual(pendingTurns(state).map((t) => t.kind), ['assess', 'assess', 'assess']);
  answer(state);
  assert.deepEqual(pendingTurns(state).map((t) => [t.participant, t.kind]), [['a', 'draft']]);
  answer(state);
  assert.equal(state.phase, 'ratify');
  assert.equal(state.round, 1);
  assert.equal(pendingTurns(state).length, 3, 'the writer also ratifies');
  answer(state);
  assert.equal(state.phase, 'agreed');
  assert.equal(latestCandidate(state)!.revision, 1);
});

test('objections route to the writer for a new revision and acceptances of an old revision never count', () => {
  const state = fresh();
  answer(state); answer(state);
  answer(state, (turn) => (turn.participant === 'b' ? 'object' : 'accept'));
  assert.equal(state.phase, 'draft');
  assert.equal(state.openIssues.length, 1);
  answer(state);
  assert.equal(latestCandidate(state)!.revision, 2);
  const [first] = pendingTurns(state);
  const staleHash = state.candidates[0]!.hash;
  const verdict = recordResponse(state, first!.id, { ...envelope(state, first!), decision: 'accept', candidateHash: staleHash, objections: [] });
  assert.equal(verdict.accepted, false);
  assert.equal(state.decisions.length, 0);
  answer(state);
  assert.equal(state.phase, 'agreed');
  assert.equal(state.round, 2);
});

test('exhausted rounds end unresolved with the latest candidate and objections', () => {
  const state = fresh(1);
  answer(state); answer(state);
  answer(state, (turn) => (turn.participant === 'c' ? 'object' : 'accept'));
  assert.equal(state.phase, 'unresolved');
  assert.match(state.outcome!.reason, /remaining objections/);
  assert.equal(state.openIssues[0]!.participant, 'c');
  assert.ok(latestCandidate(state));
});

test('a question for the user waits for input while rounds remain and ends unresolved when they are exhausted', () => {
  const waiting = fresh(2);
  answer(waiting); answer(waiting);
  answer(waiting, (turn) => (turn.participant === 'b' ? 'question' : 'accept'));
  assert.equal(waiting.phase, 'waiting_input');
  assert.equal(waiting.questions.length, 1);
  assert.equal(advance(waiting, calm), false, 'nothing proceeds without input');
  queueInput(waiting, { id: 'i1', text: 'Use option A', receivedAt: 'now' });
  assert.equal(advance(waiting, calm), true);
  assert.equal(waiting.phase, 'draft');
  assert.equal(waiting.incorporatedInput.length, 1);
  answer(waiting); answer(waiting);
  assert.equal(waiting.phase, 'agreed');

  const exhausted = fresh(1);
  answer(exhausted); answer(exhausted);
  answer(exhausted, (turn) => (turn.participant === 'b' ? 'question' : 'accept'));
  assert.equal(exhausted.phase, 'unresolved');
  assert.match(exhausted.outcome!.reason, /questions that require the user/);
  assert.equal(exhausted.openIssues[0]!.kind, 'user_question');
});

test('user input arriving during ratification invalidates unanimous acceptance', () => {
  const state = fresh(3);
  answer(state); answer(state);
  queueInput(state, { id: 'i1', text: 'Also cover rollback', receivedAt: 'now' });
  answer(state);
  assert.equal(state.phase, 'draft', 'acceptances of the superseded revision do not agree');
  assert.equal(state.decisions.length, 0);
});

test('stale, duplicate, unknown and mismatched responses never change state', () => {
  const state = fresh();
  const [turn] = pendingTurns(state);
  const good = { ...envelope(state, turn!), summary: 's', findings: [] };
  assert.equal(recordResponse(state, 'nope', good).accepted, false);
  assert.deepEqual(recordResponse(state, turn!.id, { ...good, participant: 'b' }), { accepted: false, reason: 'mismatch', detail: 'mismatch: participant' });
  assert.deepEqual(recordResponse(state, turn!.id, { ...good, snapshotId: 'old' }), { accepted: false, reason: 'mismatch', detail: 'mismatch: snapshotId' });
  assert.equal(recordResponse(state, turn!.id, { ...good, findings: [{ id: 'x', kind: 'finding', text: '', evidence: [] }] }).accepted, false);
  assert.equal(recordResponse(state, turn!.id, good).accepted, true);
  assert.deepEqual(recordResponse(state, turn!.id, good), { accepted: false, reason: 'duplicate', detail: `Turn ${turn!.id} already has a result` });
  assert.equal(advance(state, calm), false, 'other assessments are outstanding');
});

test('a draft must cover exactly the authorized targets', () => {
  const state = fresh();
  answer(state);
  const [draft] = pendingTurns(state);
  const base = { ...envelope(state, draft!), summary: 's', assumptions: [], dispositions: [] };
  assert.equal(recordResponse(state, draft!.id, { ...base, documents: [{ target: 'other.md', content: 'x' }] }).accepted, false);
  assert.equal(recordResponse(state, draft!.id, { ...base, documents: [{ target: 'plan.md', content: 'x' }, { target: 'plan.md', content: 'y' }] }).accepted, false);
  assert.equal(recordResponse(state, draft!.id, { ...base, documents: [{ target: 'plan.md', content: 'x' }] }).accepted, true);
});

test('a failed or missing participant blocks agreement', () => {
  const state = fresh();
  answer(state); answer(state);
  const turns = pendingTurns(state);
  for (const turn of turns.slice(0, 2)) recordResponse(state, turn.id, { ...envelope(state, turn), decision: 'accept', candidateHash: turn.candidateHash, objections: [] });
  assert.equal(advance(state, calm), false, 'a silent participant keeps the phase open');
  recordFailure(state, turns[2]!.id, 'timed out');
  assert.equal(state.phase, 'failed');
  assert.equal(state.outcome!.participant, 'c');
  assert.equal(advance(state, calm), false);
});

test('one substantive context drift re-ratifies; a second ends unresolved; metadata-only drift is the caller’s concern', () => {
  const state = fresh(3);
  answer(state); answer(state);
  for (const turn of pendingTurns(state)) recordResponse(state, turn.id, { ...envelope(state, turn), decision: 'accept', candidateHash: turn.candidateHash, objections: [] });
  advance(state, { semanticHash: 'h2', snapshotId: 's2', deadlinePassed: false });
  assert.equal(state.phase, 'draft', 'acceptance against the outdated snapshot does not agree');
  assert.equal(state.snapshot.id, 's2');
  assert.equal(pendingTurns(state)[0]!.snapshotId, 's2');
  answer(state);
  for (const turn of pendingTurns(state)) recordResponse(state, turn.id, { ...envelope(state, turn), decision: 'accept', candidateHash: turn.candidateHash, objections: [] });
  advance(state, { semanticHash: 'h3', snapshotId: 's3', deadlinePassed: false });
  assert.equal(state.phase, 'unresolved');
  assert.match(state.outcome!.reason, /more than once/);
});

test('drift before any candidate restarts independent assessment', () => {
  const state = fresh();
  for (const turn of pendingTurns(state)) recordResponse(state, turn.id, { ...envelope(state, turn), summary: 's', findings: [] });
  advance(state, { semanticHash: 'h2', snapshotId: 's2', deadlinePassed: false });
  assert.deepEqual(pendingTurns(state).map((t) => [t.kind, t.snapshotId]), [['assess', 's2'], ['assess', 's2'], ['assess', 's2']]);
});

test('the deadline ends unresolved and cancellation supersedes outstanding turns', () => {
  const late = fresh();
  answer(late);
  for (const turn of pendingTurns(late)) recordResponse(late, turn.id, { ...envelope(late, turn), summary: 's', documents: [{ target: 'plan.md', content: 'x' }], assumptions: [], dispositions: [] });
  advance(late, { ...calm, deadlinePassed: true });
  assert.equal(late.phase, 'unresolved');

  const stopped = fresh();
  cancel(stopped);
  assert.equal(stopped.phase, 'cancelled');
  assert.equal(pendingTurns(stopped).length, 0);
  assert.ok(Object.values(stopped.turns).every((t) => t.status === 'superseded'));
});
