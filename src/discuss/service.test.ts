import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { makeTempWorkspace, openLedger, writeInitiative } from '../test-helpers.ts';
import { attemptFiles, paths } from './runtime.ts';
import { addInput, discussionResult, discussionStatus, resumeDiscussion, startDiscussion, stopDiscussion, systemServiceEnv, waitDiscussion } from './service.ts';
import { discussionsRoot, isSameProcess, readJson, type ProcessIdentity } from './store.ts';
import { makeFakes, writePersonalConfig, type Fakes } from './test-fakes.ts';

const darwinOnly = { skip: process.platform !== 'darwin' ? 'discussion execution is macOS-only' : false };

const roles = {
  architect: { instructions: 'Develop a concrete design.' },
  critic: { instructions: 'Find failure cases.' },
  operator: { instructions: 'Evaluate operations.' },
};
const pair = { participants: [{ id: 'architect', engine: 'claude', model: 'opus', role: 'architect' }, { id: 'critic', engine: 'codex', model: 'gpt-x', role: 'critic' }], writer: 'architect' };
const trio = { participants: [...pair.participants, { id: 'operator', engine: 'claude', model: 'sonnet', role: 'operator' }], writer: 'architect' };

async function setup(t: TestContext, options: { cmuxMode?: 'ok' | 'denied'; defaults?: Record<string, unknown> } = {}) {
  const fakes = await makeFakes(options.cmuxMode === undefined ? {} : { cmuxMode: options.cmuxMode });
  t.after(async () => {
    await stopAll(fakes);
    await fakes.cleanup();
  });
  await writePersonalConfig(fakes, { roles, presets: { pair, trio }, defaults: { preset: 'pair', presentation: 'headless', turnTimeoutSeconds: 60, totalTimeoutSeconds: 120, ...options.defaults } });
  const work = path.join(fakes.root, 'work');
  await mkdir(work);
  await writeFile(path.join(work, 'brief.md'), 'Decide the plan.\n');
  await writeFile(path.join(work, 'plan.md'), 'original plan\n');
  return { fakes, work, service: systemServiceEnv(work, fakes.env) };
}

async function stopAll(fakes: Fakes) {
  const root = discussionsRoot(fakes.env);
  for (const id of await readdir(root).catch(() => [] as string[])) {
    const state = await readJson<{ status: string }>(path.join(root, id, 'state.json'));
    if (state && state.status === 'running') await stopDiscussion(systemServiceEnv(fakes.root, fakes.env), id).catch(() => undefined);
  }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out; last value ${JSON.stringify(value).slice(0, 2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('two engines reach agreement on a revised candidate, apply it, and the initiator returns before completion', darwinOnly, async (t) => {
  const { fakes, work, service } = await setup(t);
  await fakes.setPlan({ participants: { critic: { ratify: 'object_once' } }, content: 'agreed plan' });
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: ['plan.md'], noInit: true });
  assert.equal(started.status, 'running');
  assert.equal(started.resultAvailable, false, 'start returns while the detached runner works');
  const status = await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'completed');
  assert.equal(status.outcome?.kind, 'agreed');
  const result = await discussionResult(service, started.id) as Record<string, any>;
  assert.equal(result['agreed'], true);
  assert.equal(result['applied'], true);
  assert.equal(result['proposal'].revision, 2);
  assert.equal(await readFile(path.join(work, 'plan.md'), 'utf8'), 'agreed plan revision 2\n');
  assert.ok(result['participants'].every((p: any) => p.decision?.decision === 'accept' && p.decision.revision === 2 && p.decision.candidateHash === result['proposal'].hash));

  const calls = await fakes.invocations();
  const claude = calls.filter((call) => call['engine'] === 'claude');
  const codex = calls.filter((call) => call['engine'] === 'codex');
  const claudeArgs = claude.map((call) => call['args'] as string[]);
  assert.equal(claudeArgs[0]![claudeArgs[0]!.indexOf('--session-id') - 0], '--session-id');
  const sessionId = claudeArgs[0]![claudeArgs[0]!.indexOf('--session-id') + 1];
  assert.ok(claudeArgs.slice(1).every((args) => args[args.indexOf('--resume') + 1] === sessionId), 'later Claude turns resume the explicit session');
  assert.ok(claudeArgs.every((args) => args.includes('--restricted') && args[args.indexOf('--tools') + 1] === 'Read,Grep,Glob' && args[args.indexOf('--permission-mode') + 1] === 'dontAsk'));
  const codexArgs = codex.map((call) => call['args'] as string[]);
  assert.deepEqual(codexArgs[0]!.slice(0, 2), ['exec', '-C']);
  const thread = codex[0]!['sessionId'];
  assert.ok(codexArgs.slice(1).every((args) => args[1] === 'resume' && args[2] === thread), 'later Codex turns resume the reported thread');
  assert.ok(codexArgs.every((args) => args.includes('sandbox_mode="read-only"')));
  assert.ok(calls.every((call) => typeof call['marker'] === 'string' && (call['marker'] as string).startsWith(`${started.id}:`)));
  assert.ok(calls.every((call) => call['init'] === 'NONE (general discussion; no init objectives apply)'));
});

test('three participants with a one-round bound end unresolved on a user question without touching the target', darwinOnly, async (t) => {
  const { fakes, work, service } = await setup(t);
  await fakes.setPlan({ participants: { operator: { ratify: 'question' } } });
  const started = await startDiscussion(service, { briefFile: 'brief.md', preset: 'trio', maxRounds: 1, targets: ['plan.md'], noInit: true });
  await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'completed');
  const result = await discussionResult(service, started.id) as Record<string, any>;
  assert.equal(result['outcome'].kind, 'unresolved');
  assert.equal(result['agreed'], false);
  assert.equal(result['application'].status, 'not_applied');
  assert.deepEqual(result['unresolvedIssues'].map((issue: any) => [issue.participant, issue.kind]), [['operator', 'user_question']]);
  assert.equal(result['participants'].length, 3);
  assert.equal(await readFile(path.join(work, 'plan.md'), 'utf8'), 'original plan\n');
});

test('a question with rounds left waits for user input, then the input resumes the same discussion', darwinOnly, async (t) => {
  const { fakes, work, service } = await setup(t);
  await fakes.setPlan({ participants: { critic: { ratify: 'question_once' } } });
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  const waiting = await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'needs_input');
  assert.equal(waiting.questions[0]!.text, 'Which option does the user want?');
  await writeFile(path.join(work, 'answer.md'), 'Use option A.\n');
  const added = await addInput(service, started.id, 'Use option A.\n');
  assert.equal(added.linked, false);
  await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'completed');
  const result = await discussionResult(service, started.id) as Record<string, any>;
  assert.equal(result['outcome'].kind, 'agreed');
  assert.equal(result['application'].status, 'not_requested');
  assert.equal(result['userInput'][0].text, 'Use option A.\n');
  assert.equal(result['proposal'].documents[0].target, 'proposal');
});

test('without cmux the start waits for an explicit presentation choice before launching anyone', darwinOnly, async (t) => {
  const { fakes, service } = await setup(t, { defaults: { presentation: 'cmux' } });
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  assert.equal(started.status, 'needs_presentation_choice');
  assert.match(started.nextCommand, /--presentation headless/);
  assert.equal((await fakes.invocations()).length, 0);
  await assert.rejects(resumeDiscussion(service, started.id, {}), /Choose a presentation explicitly/);
  const resumed = await resumeDiscussion(service, started.id, { presentation: 'headless' });
  assert.equal(resumed.resumed, true);
  const done = await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'completed');
  assert.equal(done.presentation.kind, 'headless');
  assert.equal(done.outcome?.kind, 'agreed');
});

test('cmux presentation opens one labelled workspace with a worker surface per participant and closes it when final', darwinOnly, async (t) => {
  const { fakes, service } = await setup(t, { cmuxMode: 'ok', defaults: { presentation: 'cmux' } });
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  assert.equal(started.status, 'running');
  const done = await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'completed');
  assert.equal(done.outcome?.kind, 'agreed');
  const workspace = '00000000-0000-4000-8000-000000000001';
  assert.equal(done.presentation.workspace, workspace);
  const calls = await waitFor(() => fakes.cmuxCalls(), (value) => value.some((call) => call.args[0] === 'close-workspace'));
  assert.deepEqual(calls.filter((call) => call.args[0] === 'close-workspace').map((call) => call.args), [['close-workspace', '--workspace', workspace]]);
  const pane = calls.find((call) => call.args[0] === 'new-pane')!.args;
  assert.equal(pane[pane.indexOf('--workspace') + 1], workspace);
  const opened = calls.filter((call) => call.args[0] === 'new-workspace' || call.args[0] === 'new-pane');
  assert.deepEqual(opened.map((call) => call.args[0]), ['new-workspace', 'new-pane']);
  assert.ok(opened.every((call) => /^sh '.*launch-g1\.sh'$/.test(call.args[call.args.indexOf('--command') + 1]!)), 'startup commands stay short');
  assert.ok(opened.every((call) => call.args[call.args.indexOf('--focus') + 1] === 'false'));
  const renames = calls.filter((call) => call.args[0] === 'rename-tab');
  assert.deepEqual(renames.map((call) => call.surface).sort(), ['surface:1', 'surface:2']);
  assert.ok(renames.some((call) => call.args.at(-1)!.includes('critic (critic, codex)')));
});

test('stop cancels a running discussion and terminates only its own engine processes', darwinOnly, async (t) => {
  const { fakes, service } = await setup(t);
  await fakes.setPlan({ participants: { architect: { assess: 'hang' }, critic: { assess: 'hang' } } });
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: ['plan.md'], noInit: true });
  const dir = started.dir;
  const running = await waitFor(async () => {
    const state = await readJson<{ turns: Record<string, { attempt: number }> }>(paths.state(dir));
    const files = await Promise.all(Object.entries(state?.turns ?? {}).map(([id, turn]) => readJson<{ identity: ProcessIdentity }>(attemptFiles.running(paths.attempt(dir, id, turn.attempt)))));
    return files.filter((file) => file?.identity);
  }, (value) => value.length === 2);
  const stopped = await stopDiscussion(service, started.id);
  assert.notEqual(stopped.stopped, false);
  const done = await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'cancelled');
  assert.equal(done.outcome?.kind, 'cancelled');
  for (const file of running) await waitFor(() => isSameProcess(file!.identity), (alive) => !alive, 10_000);
  assert.equal(await readFile(path.join(fakes.root, 'work', 'plan.md'), 'utf8'), 'original plan\n');
});

test('a timed-out or malformed participant fails the discussion without an automatic resend', darwinOnly, async (t) => {
  const { fakes, service } = await setup(t, { defaults: { turnTimeoutSeconds: 1 } });
  await fakes.setPlan({ participants: { critic: { assess: 'hang' } } });
  const slow = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  const timedOut = await waitFor(() => discussionStatus(service, slow.id), (value) => value.status === 'completed', 20_000);
  assert.equal(timedOut.outcome?.kind, 'failed');
  assert.match(timedOut.outcome!.reason, /critic.*exceeded 1s/);

  await fakes.setPlan({ participants: { critic: { assess: 'garbage' } } });
  const bad = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  const malformed = await waitFor(() => discussionStatus(service, bad.id), (value) => value.status === 'completed');
  assert.equal(malformed.outcome?.kind, 'failed');
  assert.match(malformed.outcome!.reason, /malformed response/);
  const criticCalls = (await fakes.invocations()).filter((call) => call['participant'] === 'critic' && (call['turnId'] as string).startsWith(bad.id) === false);
  assert.ok(criticCalls.length >= 1);
  const badAttempts = (await discussionStatus(service, bad.id)).turns.filter((turn) => turn.participant === 'critic');
  assert.deepEqual(badAttempts.map((turn) => turn.attempt), [1]);
});

test('start refuses unsupported platforms before creating any state', async (t) => {
  const { fakes, service } = await setup(t);
  await assert.rejects(startDiscussion({ ...service, platform: 'linux' }, { briefFile: 'brief.md', targets: [], noInit: true }), (error: any) => error.code === 'UNSUPPORTED_PLATFORM');
  await assert.rejects(resumeDiscussion({ ...service, platform: 'win32' }, 'd-20261029-000000-abcdef', {}), (error: any) => error.code === 'UNSUPPORTED_PLATFORM');
  assert.deepEqual(await readdir(discussionsRoot(fakes.env)).catch(() => []), []);
});

test('every participant receives the owning init context and the same snapshot', darwinOnly, async (t) => {
  const { fakes } = await setup(t);
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeInitiative(ws, 'app/feature', { ledger: openLedger([], { body: '\n## Working state\n\nKeep the API stable.\n' }) });
  const service = systemServiceEnv(ws.root, fakes.env);
  await writeFile(path.join(ws.root, 'brief.md'), 'Review the plan.\n');
  const started = await startDiscussion(service, { briefFile: 'brief.md', init: 'feature', targets: [] });
  assert.equal(started.init?.id, 'app/feature');
  assert.equal(started.init?.source, 'explicit');
  await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'completed');
  const calls = await fakes.invocations();
  assert.ok(calls.every((call) => call['init'] === `app/feature (workspace ${ws.root})` && call['bundleHasIntent'] === true));
  assert.equal(new Set(calls.map((call) => call['snapshotId'])).size, 1);
  const result = await discussionResult(service, started.id) as Record<string, any>;
  assert.deepEqual(result['context'].artifacts.map((item: any) => item.label).slice(0, 2), ['intent', 'ledger']);
});

test('denied process inspection preserves status and prevents recovery; confirmed exit allows recovery', darwinOnly, async (t) => {
  const { service } = await setup(t);
  let launches = 0;
  service.launchRunner = async () => { launches += 1; };
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  const stateFile = paths.state(started.dir);
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.runner = { pid: 123, started: 'original' };
  await writeFile(stateFile, JSON.stringify(state));
  const before = await readFile(stateFile, 'utf8');
  const { createProcessProbe } = await import('./store.ts');
  service.probe = createProcessProbe(async () => { throw { code: 'EPERM' }; });
  const unknown = await discussionStatus(service, started.id);
  assert.equal(unknown.status, 'running');
  assert.equal(unknown.runnerAlive, null);
  assert.match(unknown.inspectionError!, /permission/);
  assert.match(unknown.nextCommand, /discuss status/);
  await assert.rejects(resumeDiscussion(service, started.id, {}), { code: 'PROCESS_INSPECTION_FAILED' });
  assert.equal(await readFile(stateFile, 'utf8'), before);
  assert.equal(launches, 1);

  service.probe = createProcessProbe(async () => 'original');
  assert.equal((await discussionStatus(service, started.id)).runnerAlive, true);
  assert.equal((await resumeDiscussion(service, started.id, {})).resumed, false);
  assert.equal(launches, 1);

  service.probe = createProcessProbe(async () => '');
  const exited = await discussionStatus(service, started.id);
  assert.equal(exited.status, 'interrupted');
  assert.equal(exited.runnerAlive, false);
  assert.equal(exited.inspectionError, null);
  assert.match(exited.nextCommand, /discuss resume/);
  assert.equal((await resumeDiscussion(service, started.id, {})).resumed, true);
  assert.equal(launches, 2);
});

async function generation(dir: string): Promise<number> {
  return (await readJson<{ generation: number }>(paths.state(dir)))!.generation;
}

test('wait returns the final result once, and an already-finished discussion returns at once without new work', darwinOnly, async (t) => {
  const { fakes, service } = await setup(t);
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: ['plan.md'], noInit: true });
  const waited = await waitDiscussion(service, started.id, { timeoutSeconds: 60 });
  assert.equal(waited.reason, 'final');
  assert.equal(waited.discussion.status, 'completed');
  assert.equal(waited.result?.['agreed'], true);
  assert.equal(waited.nextCommand, null);
  assert.deepEqual(waited.result, await discussionResult(service, started.id));

  const calls = (await fakes.invocations()).length;
  const before = await generation(started.dir);
  const again = await waitDiscussion(service, started.id, { timeoutSeconds: 1 });
  assert.equal(again.reason, 'final');
  assert.equal((await fakes.invocations()).length, calls);
  assert.equal(await generation(started.dir), before);
});

test('wait returns promptly when the discussion needs input or a presentation choice, without resuming it', darwinOnly, async (t) => {
  const { fakes, service } = await setup(t);
  await fakes.setPlan({ participants: { critic: { ratify: 'question_once' } } });
  const asking = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  const waited = await waitDiscussion(service, asking.id, { timeoutSeconds: 60 });
  assert.equal(waited.reason, 'attention');
  assert.equal(waited.discussion.status, 'needs_input');
  assert.equal(waited.discussion.questions[0]!.text, 'Which option does the user want?');
  assert.match(waited.nextCommand!, /discuss input/);
  assert.equal(waited.result, null);
  const calls = (await fakes.invocations()).length;
  const before = await generation(asking.dir);
  assert.equal((await waitDiscussion(service, asking.id, { timeoutSeconds: 1 })).reason, 'attention');
  assert.equal((await fakes.invocations()).length, calls);
  assert.equal(await generation(asking.dir), before);

  const { service: cmuxService } = await setup(t, { defaults: { presentation: 'cmux' } });
  const choosing = await startDiscussion(cmuxService, { briefFile: 'brief.md', targets: [], noInit: true });
  const choice = await waitDiscussion(cmuxService, choosing.id, { timeoutSeconds: 60 });
  assert.equal(choice.reason, 'attention');
  assert.match(choice.nextCommand!, /--presentation headless/);
});

test('timeout and caller cancellation end only the wait; the discussion keeps its runner and turns', darwinOnly, async (t) => {
  const { fakes, service } = await setup(t);
  await fakes.setPlan({ participants: { architect: { assess: 'hang' }, critic: { assess: 'hang' } } });
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  await waitFor(() => discussionStatus(service, started.id), (value) => value.runnerAlive === true && value.turns.length === 2);
  const timedOut = await waitDiscussion(service, started.id, { timeoutSeconds: 1, pollMs: 100 });
  assert.equal(timedOut.reason, 'timeout');
  assert.equal(timedOut.discussion.status, 'running');
  assert.match(timedOut.nextCommand!, /discuss status/);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const cancelled = await waitDiscussion(service, started.id, { timeoutSeconds: 60, signal: controller.signal });
  assert.equal(cancelled.reason, 'caller_cancelled');
  assert.ok(cancelled.waitedSeconds < 5);

  const status = await discussionStatus(service, started.id);
  assert.equal(status.status, 'running');
  assert.equal(status.runnerAlive, true);
  assert.deepEqual(status.turns.map((turn) => turn.attempt), [1, 1]);
  assert.equal(await generation(started.dir), 1);
  assert.equal((await fakes.invocations()).length, 2);
  await stopDiscussion(service, started.id);
  await waitFor(() => discussionStatus(service, started.id), (value) => value.status === 'cancelled');
});

test('wait settles on the result file whichever of state and result is written first', darwinOnly, async (t) => {
  const { service } = await setup(t);
  service.launchRunner = async () => undefined;
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  const stateFile = paths.state(started.dir);
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.runner = { pid: process.pid, started: 'self' };
  service.probe = { identify: async (pid) => ({ pid, started: 'self' }) };

  state.status = 'cancelled';
  await writeFile(stateFile, JSON.stringify(state));
  const unstored = await waitDiscussion(service, started.id, { timeoutSeconds: 1, pollMs: 100 });
  assert.equal(unstored.reason, 'final', 'a final state whose result was never stored still ends as final');
  assert.equal(unstored.result?.['final'], false);
  const pending = waitDiscussion(service, started.id, { timeoutSeconds: 30, pollMs: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = { id: started.id, outcome: { kind: 'cancelled' }, agreed: false };
  await writeFile(paths.result(started.dir), JSON.stringify(result));
  const settled = await pending;
  assert.equal(settled.reason, 'final');
  assert.deepEqual(settled.result, result);
  assert.ok(settled.waitedSeconds < 5, 'the directory change wakes the wait before its poll interval');

  state.status = 'running';
  await writeFile(stateFile, JSON.stringify(state));
  assert.equal((await waitDiscussion(service, started.id, { timeoutSeconds: 1 })).reason, 'final');
});

test('wait treats denied inspection and a starting runner as running, and reports only a confirmed exit', darwinOnly, async (t) => {
  const { service } = await setup(t);
  let launches = 0;
  service.launchRunner = async () => { launches += 1; };
  const started = await startDiscussion(service, { briefFile: 'brief.md', targets: [], noInit: true });
  const stateFile = paths.state(started.dir);

  const starting = await waitDiscussion(service, started.id, { timeoutSeconds: 1, pollMs: 100 });
  assert.equal(starting.reason, 'timeout', 'a runner that has not registered yet is not an interruption');
  assert.equal(starting.discussion.runnerStarting, true);

  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.updatedAt = new Date(Date.now() - 60_000).toISOString();
  await writeFile(stateFile, JSON.stringify(state));
  const neverStarted = await waitDiscussion(service, started.id, { timeoutSeconds: 1 });
  assert.equal(neverStarted.reason, 'attention');
  assert.equal(neverStarted.discussion.status, 'interrupted');

  state.runner = { pid: 123, started: 'original' };
  await writeFile(stateFile, JSON.stringify(state));
  const before = await readFile(stateFile, 'utf8');
  const { createProcessProbe } = await import('./store.ts');
  service.probe = createProcessProbe(async () => { throw { code: 'EPERM' }; });
  const denied = await waitDiscussion(service, started.id, { timeoutSeconds: 1, pollMs: 100 });
  assert.equal(denied.reason, 'timeout');
  assert.equal(denied.discussion.status, 'running');
  assert.equal(denied.discussion.runnerAlive, null);
  assert.match(denied.discussion.inspectionError!, /permission/);
  assert.match(denied.nextCommand!, /discuss status/);
  assert.equal(await readFile(stateFile, 'utf8'), before);

  service.probe = createProcessProbe(async () => '');
  const exited = await waitDiscussion(service, started.id, { timeoutSeconds: 60 });
  assert.equal(exited.reason, 'attention');
  assert.equal(exited.discussion.status, 'interrupted');
  assert.match(exited.nextCommand!, /discuss resume/);
  assert.equal(await readFile(stateFile, 'utf8'), before);
  assert.equal(launches, 1);
});
