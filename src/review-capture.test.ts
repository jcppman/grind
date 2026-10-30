import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { captureFromCmux, chooseDestination, locateQuote, type CmuxRunner } from './review-capture.ts';
import { currentInit } from './review-current.ts';
import { readDraft, registerSession, type ReviewStore, type SessionRegistration } from './review-store.ts';
import { git, makeCheckout, makeTempWorkspace, openLedger, writeInitiative } from './test-helpers.ts';

test('a quote gets line numbers only when the file on disk shows where it is', () => {
  const content = 'Title\r\n\r\nThe plan is good.\nRepeat me.\nRepeat me.\nLast line';
  assert.deepEqual(locateQuote(content, 'plan is good.').lines, { start: 3, end: 3 });
  assert.deepEqual(locateQuote(content, 'good.\nRepeat me.\nRepeat').lines, { start: 3, end: 5 });
  const reported = locateQuote(content, 'Repeat me.', { start: 5, end: 5 });
  assert.deepEqual([reported.location, reported.lines], ['exact', { start: 5, end: 5 }]);
  assert.deepEqual([locateQuote(content, 'Repeat me.').location, locateQuote(content, 'Repeat me.').lines], ['ambiguous', null]);
  assert.deepEqual([locateQuote(content, 'The plan is great').location, locateQuote(content, 'The plan is great').lines], ['unmatched', null]);
  assert.equal(locateQuote(content, 'Last line', { start: 1, end: 1 }).lines?.start, 6);
});

function registration(sessionId: string, workspaceId: string, surfaceId: string | null): SessionRegistration {
  return {
    schemaVersion: 1, sessionId, cwd: '/nowhere', workspace: null, cmux: { workspaceId, surfaceId }, pid: process.pid, host: os.hostname(),
    registeredAt: new Date().toISOString(), endedAt: null, binding: null,
  };
}

test('the destination is the one live session in the caller’s cmux workspace, never a guess', () => {
  const sessions = [registration('a', 'W1', 'S1'), registration('b', 'W2', 'S2'), registration('c', 'W2', 'S3')];
  assert.equal(chooseDestination(sessions, 'W1').sessionId, 'a');
  assert.throws(() => chooseDestination(sessions, 'W2'), (error: { code: string; details: { candidates: unknown[] } }) => error.code === 'REVIEW_DESTINATION' && error.details.candidates.length === 2);
  assert.throws(() => chooseDestination(sessions, 'W3'), { code: 'REVIEW_DESTINATION' });
  assert.equal(chooseDestination(sessions, 'W2', 'c').sessionId, 'c');
  assert.throws(() => chooseDestination(sessions, 'W1', 'gone'), { code: 'REVIEW_DESTINATION' });
});

function fakeCmux(tree: unknown, selections: Record<string, unknown>): { runner: CmuxRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: CmuxRunner = async (args) => {
    calls.push([...args]);
    if (args.includes('tree')) return JSON.stringify(tree);
    const surface = args[args.indexOf('--surface') + 1] as string;
    if (!(surface in selections)) throw Object.assign(new Error('not found'), { stderr: 'Error: not_found' });
    return JSON.stringify(selections[surface]);
  };
  return { runner, calls };
}

async function tempStore(t: { after: (fn: () => Promise<void>) => void }): Promise<ReviewStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'grind-capture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root };
}

test('a cmux capture adds the document selection to the workspace’s session without sending anything', async (t) => {
  const store = await tempStore(t);
  const doc = path.join(store.root, 'plan.md');
  await writeFile(doc, '# Plan\n\nShip the store first.\n');
  await registerSession(store, { sessionId: 'claude-1', cwd: store.root, workspace: null, cmux: { workspaceId: 'W1', surfaceId: 'T1' }, pid: process.pid, host: os.hostname() });
  await registerSession(store, { sessionId: 'claude-2', cwd: store.root, workspace: null, cmux: { workspaceId: 'W2', surfaceId: 'T2' }, pid: process.pid, host: os.hostname() });
  const tree = { windows: [{ workspaces: [{ id: 'W1', panes: [{ surfaces: [{ id: 'T1', type: 'terminal' }, { id: 'M1', type: 'markdown', selected_in_pane: true }, { id: 'M2', type: 'markdown' }] }] }] }] };
  const base = { kind: 'markdown', workspace_id: 'W1', file_path: doc };
  const { runner } = fakeCmux(tree, {
    M1: { ...base, has_selection: true, surface_id: 'M1', text: 'store first' },
    M2: { ...base, has_selection: false, surface_id: 'M2', text: '' },
    T1: { has_selection: true, kind: 'terminal', surface_id: 'T1', workspace_id: 'W1', text: 'reply text' },
  });
  const env = { CMUX_WORKSPACE_ID: 'W1', CMUX_SURFACE_ID: 'NEWTAB' };

  const result = await captureFromCmux(store, { env, runner });
  assert.equal(result.sessionId, 'claude-1');
  assert.deepEqual(result.comment.source, { kind: 'markdown', path: doc, surfaceId: 'M1', workspaceId: 'W1', lines: { start: 3, end: 3 }, location: 'exact', contentHash: (result.comment.source as { contentHash: string }).contentHash });
  assert.equal(result.comment.quote, 'store first');
  assert.equal((await readDraft(store, 'claude-2')), null);

  const bothSelected = fakeCmux(tree, {
    M1: { ...base, has_selection: true, surface_id: 'M1', text: 'store first' },
    M2: { ...base, has_selection: true, surface_id: 'M2', text: 'Plan' },
  });
  await assert.rejects(captureFromCmux(store, { env, runner: bothSelected.runner }), { code: 'REVIEW_CAPTURE_FAILED' });

  const terminalOnly = fakeCmux(tree, {
    M1: { ...base, has_selection: false, surface_id: 'M1', text: '' },
    M2: { ...base, has_selection: false, surface_id: 'M2', text: '' },
    T1: { has_selection: true, kind: 'terminal', surface_id: 'T1', workspace_id: 'W1', text: 'reply text' },
  });
  const fallback = await captureFromCmux(store, { env, runner: terminalOnly.runner });
  assert.deepEqual(fallback.comment.source, { kind: 'terminal', surfaceId: 'T1', workspaceId: 'W1', sessionId: 'claude-1' });
  assert.equal((await readDraft(store, 'claude-1'))?.comments.length, 2);

  await assert.rejects(captureFromCmux(store, { env: {}, runner }), { code: 'REVIEW_CAPTURE_FAILED' });
});

test('the current init is only the bound init, never the checkout it runs in', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  const app = await makeCheckout(ws, 'app', 'feature');
  await writeInitiative(ws, 'alpha', { ledger: openLedger([{ path: 'app', branch: 'feature' }]) });
  await writeInitiative(ws, 'beta', { ledger: openLedger() });

  const unbound = await currentInit(app);
  assert.deepEqual([unbound.state, unbound.workspace], ['none', ws.root]);
  const byAgent = await currentInit(app, { binding: { workspace: ws.root, initiative: 'beta', setBy: 'agent' } });
  assert.deepEqual([byAgent.state, byAgent.state === 'resolved' && byAgent.initiative, byAgent.state === 'resolved' && byAgent.setBy], ['resolved', 'beta', 'agent']);
  const legacy = await currentInit(app, { binding: { workspace: ws.root, initiative: 'alpha' } });
  assert.deepEqual([legacy.state === 'resolved' && legacy.setBy, legacy.state === 'resolved' && legacy.currentTask], ['user', 'Do the thing']);

  assert.equal((await currentInit(os.tmpdir())).state, 'none');
  const broken = await currentInit(app, { binding: { workspace: ws.root, initiative: 'missing' } });
  assert.equal(broken.state, 'unavailable');
});
