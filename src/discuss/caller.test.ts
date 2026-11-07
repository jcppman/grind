import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { runRunner } from './runner.ts';
import { recordResponse } from './protocol.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { callerAssignment, submitCaller } from './caller.ts';
import { parseSetup, resolveEffective, mergeLayers, type LayeredConfig } from './config.ts';
import { runDiscuss } from './cli.ts';
import { paths, readState, readRecord } from './runtime.ts';
import { addInput, discussionResult, discussionStatus, resumeDiscussion, startDiscussion, stopDiscussion, systemServiceEnv, systemRunnerDeps, waitDiscussion } from './service.ts';
import { writeJsonAtomic } from './store.ts';
import { makeFakes, writePersonalConfig } from './test-fakes.ts';

const darwinOnly = { skip: process.platform !== 'darwin' };
const caller = { id: 'author', execution: 'caller' as const, role: 'author', instructions: 'Assess and write the proposal.' };
const managed = { id: 'critic', engine: 'codex' as const, model: 'fake-model', role: 'critic', instructions: 'Find defects.' };
const setup = { participants: [caller, managed], writer: caller.id };

test('ad hoc setups and preset callers validate the complete resolved roster', () => {
  const { origins, ...merged } = mergeLayers([]);
  const layered: LayeredConfig = { merged, origins, sources: [] };
  assert.equal(resolveEffective(layered, { setup: parseSetup(setup, 'setup') }).writer, caller.id);
  for (const bad of [
    { ...setup, participants: [caller] },
    { ...setup, participants: [caller, caller] },
    { ...setup, participants: [caller, { ...caller, id: 'other' }] },
    { ...setup, writer: 'absent' },
    { ...setup, participants: [caller, ...Array.from({ length: 8 }, (_, i) => ({ ...managed, id: `m${i}` }))] },
    { ...setup, participants: [{ ...caller, model: 'wrong' }, managed] },
    { ...setup, participants: [{ ...caller, instructions: '' }, managed] },
  ]) assert.throws(() => resolveEffective(layered, { setup: parseSetup(bad, 'setup') }));
  assert.throws(() => resolveEffective(layered, { setup, preset: 'pair' }), /cannot combine/);
  assert.throws(() => resolveEffective(layered, { setup, caller }), /cannot combine/);
  layered.merged.roles = { critic: { instructions: 'Critique' } };
  layered.merged.presets['pair'] = { participants: [managed, { ...managed, id: 'other' }], writer: managed.id };
  assert.equal(resolveEffective(layered, { preset: 'pair', caller }).writer, managed.id);
  assert.equal(resolveEffective(layered, { preset: 'pair', caller, writer: caller.id }).writer, caller.id);
});

async function fixture(t: TestContext, launch = true, options: { totalTimeoutSeconds?: number; maxRounds?: number } = {}) {
  const fakes = await makeFakes();
  const work = path.join(fakes.root, 'work');
  await mkdir(work);
  await writeFile(path.join(work, 'brief.md'), 'Choose a plan.');
  await writeFile(path.join(work, 'plan.md'), 'original');
  await writeFile(path.join(work, 'setup.json'), JSON.stringify(setup));
  await writeFile(path.join(work, 'caller.json'), JSON.stringify(caller));
  await writePersonalConfig(fakes, { defaults: { maxConcurrent: 1, turnTimeoutSeconds: options.totalTimeoutSeconds ?? 60, totalTimeoutSeconds: options.totalTimeoutSeconds ?? 120, maxRounds: options.maxRounds ?? 3 }, roles: { critic: { instructions: 'Critique' } }, presets: { pair: { participants: [managed, { ...managed, id: 'other' }].map(({ instructions, ...p }) => p), writer: managed.id } } });
  const service = systemServiceEnv(work, { ...fakes.env, CODEX_THREAD_ID: 'original' });
  const starter = launch ? service : { ...service, launchRunner: async () => undefined };
  const started = await startDiscussion(starter, { briefFile: 'brief.md', setupFile: 'setup.json', targets: ['plan.md'], noInit: true });
  t.after(async () => {
    await stopDiscussion(service, started.id);
    await waitDiscussion(service, started.id, { timeoutSeconds: 10, pollMs: 50 });
    await fakes.cleanup();
  });
  return { fakes, work, service, ...started };
}

type Assignment = NonNullable<Awaited<ReturnType<typeof callerAssignment>>>;
function answer(a: Assignment, target = 'proposal', object = false) {
  const envelope = { discussionId: a.discussionId, participant: a.participant, turnId: a.turnId, phase: a.phase, revision: a.revision, snapshotId: a.snapshotId };
  if (a.phase === 'assess') return { ...envelope, summary: 'Caller assessment', findings: [] };
  if (a.phase === 'draft') return { ...envelope, summary: 'Caller draft', documents: [{ target, content: 'caller proposal' }], assumptions: [], dispositions: [] };
  return { ...envelope, candidateHash: a.candidateHash, decision: object ? 'object' : 'accept', objections: object ? [{ id: 'no', kind: 'objection', text: 'Unsafe plan', evidence: [] }] : [] };
}
async function assignment(h: Awaited<ReturnType<typeof fixture>>) {
  const waited = await waitDiscussion(h.service, h.id, { timeoutSeconds: 30, pollMs: 50 });
  assert.equal(waited.reason, 'caller_assignment', JSON.stringify(waited));
  assert.ok(waited.discussion.callerAssignment);
  return waited.discussion.callerAssignment;
}
async function complete(h: Awaited<ReturnType<typeof fixture>>, options: { dissent?: boolean; beforeRatify?: () => Promise<void> } = {}) {
  for (let n = 0; n < 12; n++) {
    const waited = await waitDiscussion(h.service, h.id, { timeoutSeconds: 30, pollMs: 50 });
    if (waited.reason === 'final') return waited;
    assert.equal(waited.reason, 'caller_assignment', JSON.stringify(waited));
    const a = waited.discussion.callerAssignment!;
    if (a.phase === 'ratify') {
      await assert.rejects(submitCaller(h.service, h.id, { ...answer(a), candidateHash: 'stale' }), /candidateHash/);
      await options.beforeRatify?.();
    }
    await submitCaller(h.service, h.id, answer(a, path.join(h.work, 'plan.md'), options.dissent));
  }
  throw new Error('Exceeded caller turn bound');
}

test('caller writer completes all phases, retries return receipts, and maxConcurrent 1 still runs the managed assessment', darwinOnly, async (t) => {
  const h = await fixture(t);
  const a = await assignment(h);
  assert.equal(a.phase, 'assess');
  const until = Date.now() + 10_000;
  while (!(await h.fakes.invocations()).some((call) => call['phase'] === 'assess') && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
  const status = await discussionStatus(h.service, h.id);
  assert.ok((await h.fakes.invocations()).some((call) => call['phase'] === 'assess'));
  assert.ok(!status.callerAssignment!.assignment.includes('assessment by critic'));
  assert.ok(!Object.keys((await readState(h.dir))!.workers).includes(caller.id));
  const response = answer(a);
  const receipts = await Promise.all([submitCaller(h.service, h.id, response), submitCaller(h.service, h.id, response)]);
  assert.deepEqual(receipts[0], receipts[1]);
  await assert.rejects(submitCaller(h.service, h.id, { ...response, summary: 'different' }), /different response/);
  await complete(h);
  assert.equal((await discussionResult(h.service, h.id))['agreed'], true);
  assert.equal(await readFile(path.join(h.work, 'plan.md'), 'utf8'), 'caller proposal');
  assert.deepEqual(await submitCaller(h.service, h.id, response), receipts[0]);
  assert.equal((await h.fakes.invocations()).some((call) => call['participant'] === caller.id), false);
});

test('caller submissions reject wrong context, phases, revisions and identity without changing state; handoff is explicit', darwinOnly, async (t) => {
  const h = await fixture(t, false);
  const a = (await discussionStatus(h.service, h.id)).callerAssignment!;
  const response = answer(a);
  const before = await readFile(paths.state(h.dir), 'utf8');
  for (const change of [{ snapshotId: 'stale' }, { revision: 99 }, { phase: 'draft' }, { participant: 'critic' }, { turnId: '../escape' }, { discussionId: 'other' }]) {
    await assert.rejects(submitCaller(h.service, h.id, { ...response, ...change }));
  }
  const other = { ...h.service, env: { ...h.service.env, CODEX_THREAD_ID: 'new' } };
  await assert.rejects(submitCaller(other, h.id, response), /handoff/);
  const receipt = await submitCaller(other, h.id, response, { handoff: true });
  assert.equal(receipt.identity, 'codex:new');
  assert.equal(receipt.handoffFrom, 'codex:original');
  assert.equal(await readFile(paths.state(h.dir), 'utf8'), before);
});

for (const submitted of [false, true]) test(`recovery preserves caller assignment and durable response (submitted=${submitted})`, darwinOnly, async (t) => {
  const h = await fixture(t, false);
  const a = await assignment(h);
  if (submitted) await submitCaller(h.service, h.id, answer(a));
  await resumeDiscussion(h.service, h.id, {});
  if (!submitted) assert.equal((await assignment(h)).turnId, a.turnId);
  await complete(h);
  assert.equal((await discussionResult(h.service, h.id))['agreed'], true);
  assert.equal((await readState(h.dir))!.turns[a.turnId]!.attempt, 1);
});

test('preset plus non-writer caller cannot be outvoted by two managed participants', darwinOnly, async (t) => {
  const h = await fixture(t, false);
  const started = await startDiscussion(h.service, { briefFile: 'brief.md', preset: 'pair', callerFile: 'caller.json', maxRounds: 1, targets: ['plan.md'], noInit: true });
  assert.equal(started.participants.find((p) => p.writer)!.id, 'critic');
  const finished = await complete({ ...h, ...started }, { dissent: true });
  assert.equal(finished.discussion.outcome?.kind, 'unresolved');
  assert.equal(await readFile(path.join(h.work, 'plan.md'), 'utf8'), 'original');
});

test('input during caller ratification invalidates acceptance and requires a new exact hash', darwinOnly, async (t) => {
  const h = await fixture(t);
  let input = false;
  await complete(h, { beforeRatify: async () => {
    if (!input) { await addInput(h.service, h.id, 'Consider the new requirement.'); input = true; }
  } });
  const state = (await readState(h.dir))!;
  assert.equal(state.protocol.outcome?.kind, 'agreed');
  assert.equal(state.protocol.candidates.length, 2);
  assert.equal(state.protocol.incorporatedInput.length, 1);
});

test('caller waiting keeps the deadline and expiry rejects submission', darwinOnly, async (t) => {
  const h = await fixture(t, false, { totalTimeoutSeconds: 1 });
  const a = await assignment(h);
  const state = (await readState(h.dir))!;
  state.deadline = new Date(Date.now() - 1).toISOString();
  await writeJsonAtomic(paths.state(h.dir), state);
  await assert.rejects(submitCaller(h.service, h.id, answer(a)), /not accepting/);
  await resumeDiscussion(h.service, h.id, {});
  const finished = await waitDiscussion(h.service, h.id, { timeoutSeconds: 10, pollMs: 50 });
  assert.equal(finished.discussion.outcome?.kind, 'unresolved');
  assert.equal((await readState(h.dir))!.deadline, state.deadline);
});

test('stop invalidates a pending caller and target changes still block application', darwinOnly, async (t) => {
  const h = await fixture(t, false);
  const a = await assignment(h);
  await stopDiscussion(h.service, h.id);
  await assert.rejects(submitCaller(h.service, h.id, answer(a)), /not accepting/);
  const running = await fixture(t);
  await complete(running, { beforeRatify: async () => { await writeFile(path.join(running.work, 'plan.md'), 'user edit'); } });
  const result = await discussionResult(running.service, running.id);
  assert.equal(result['agreed'], true);
  assert.equal(result['applied'], false);
  assert.equal(await readFile(path.join(running.work, 'plan.md'), 'utf8'), 'user edit');
});

test('CLI setup and submit reject conflicting options and preserve finalized setup for follow-ups', darwinOnly, async (t) => {
  const h = await fixture(t, false);
  await assert.rejects(runDiscuss(['start', '--brief-file', 'brief.md', '--setup-file', 'setup.json', '--preset', 'pair'], h.service), /cannot combine/);
  const a = await assignment(h);
  await writeFile(path.join(h.work, 'response.json'), JSON.stringify(answer(a)));
  const receipt = await runDiscuss(['submit', h.id, '--response-file', 'response.json'], h.service) as { turnId: string };
  assert.equal(receipt.turnId, a.turnId);
  await stopDiscussion(h.service, h.id);
  const followup = await addInput({ ...h.service, launchRunner: async () => undefined }, h.id, 'Follow up.');
  assert.equal(followup.linked, true);
  if ('previous' in followup) {
    assert.deepEqual((await readRecord(followup.discussion.dir))!.config.participants, setup.participants);
    await stopDiscussion(h.service, followup.discussion.id);
  }
});

test('recovery after ingestion does not execute or record the caller assessment twice', darwinOnly, async (t) => {
  const h = await fixture(t, false);
  const a = await assignment(h);
  const response = answer(a);
  const receipt = await submitCaller(h.service, h.id, response);
  const state = (await readState(h.dir))!;
  assert.ok(recordResponse(state.protocol, a.turnId, response).accepted);
  state.turns[a.turnId] = { attempt: 1, generation: 1, participant: caller.id, engine: null, sessionId: null, resume: false, status: 'finished', assignedAt: new Date().toISOString() };
  await writeJsonAtomic(paths.state(h.dir), state);
  await resumeDiscussion(h.service, h.id, {});
  await complete(h);
  assert.deepEqual(await submitCaller(h.service, h.id, response), receipt);
  const final = (await readState(h.dir))!;
  assert.equal(Object.values(final.protocol.turns).filter((turn) => turn.participant === caller.id && turn.kind === 'assess').length, 1);
});

test('substantive context drift requires caller drafting and ratification against the new snapshot', darwinOnly, async (t) => {
  const h = await fixture(t, false);
  const deps = systemRunnerDeps();
  let boundaries = 0;
  const runner = runRunner(h.dir, 1, {
    ...deps, tickMs: 50,
    spawnWorker: async (script, log) => {
      const fd = openSync(log, 'a', 0o600);
      try { spawn('/bin/sh', [script], { detached: true, stdio: ['ignore', fd, fd], env: h.fakes.env }).unref(); }
      finally { closeSync(fd); }
    },
    rebuildSnapshot: async (record) => {
      const snapshot = await deps.rebuildSnapshot(record);
      if (++boundaries < 3) return snapshot;
      return { id: 'ctx-new', manifest: { ...snapshot.manifest, rawHash: 'new', semanticHash: 'new' }, bundle: `${snapshot.bundle}\nNew constraint.` };
    },
  });
  await complete(h);
  await runner;
  const state = (await readState(h.dir))!;
  assert.equal(state.protocol.outcome?.kind, 'agreed');
  assert.equal(state.protocol.candidates.length, 2);
  assert.equal(state.protocol.candidates.at(-1)!.snapshotId, 'ctx-new');
  assert.ok(state.protocol.decisions.every((decision) => state.protocol.turns[decision.turnId]!.snapshotId === 'ctx-new'));
});

test('an assigned caller turn deadline survives recovery independently of the total limit', darwinOnly, async (t) => {
  const h = await fixture(t, false);
  const a = await assignment(h);
  const state = (await readState(h.dir))!;
  state.deadline = new Date(Date.now() + 120_000).toISOString();
  state.turns[a.turnId] = { attempt: 1, generation: 1, participant: caller.id, engine: null, sessionId: null, resume: false, status: 'assigned', assignedAt: new Date(Date.now() - 61_000).toISOString() };
  await writeJsonAtomic(paths.state(h.dir), state);
  await assert.rejects(submitCaller(h.service, h.id, answer(a)), /not accepting/);
  await resumeDiscussion(h.service, h.id, {});
  const finished = await waitDiscussion(h.service, h.id, { timeoutSeconds: 10, pollMs: 50 });
  assert.equal(finished.discussion.outcome?.kind, 'unresolved');
  assert.match(finished.discussion.outcome!.reason, /waiting deadline/);
});
