import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { assertParticipantMayRun, parseDiscussArgs } from './cli.ts';
import { engineArgs, isCmuxShim, parseEngineOutput } from './engines.ts';

const exec = promisify(execFile);

test('every repeated --update-plan target is collected in order', () => {
  const args = parseDiscussArgs(['start', '--update-plan', 'a.md', '--brief-file', 'b.md', '--update-plan', 'c.md', '--update-plan', 'a/d.md']);
  assert.deepEqual(args.updatePlan, ['a.md', 'c.md', 'a/d.md']);
  assert.equal(args.values['--brief-file'], 'b.md');
  assert.throws(() => parseDiscussArgs(['start', '--preset', 'a', '--preset', 'b']), /only once/);
  assert.throws(() => parseDiscussArgs(['start', '--update-plan']), /requires a value/);
  assert.throws(() => parseDiscussArgs(['start', '--update-plan', '--json']), /requires a value/);
});

test('participants may inspect but not mutate Grind state', () => {
  const marker = 'd-1:critic';
  for (const argv of [['status', 'x'], ['context', '--json'], ['list'], ['--workspace', 'save', 'inspect'], ['note', 'list'], ['discuss', 'status', 'd'], ['discuss', 'result', 'd', '--json']]) {
    assert.doesNotThrow(() => assertParticipantMayRun(argv, marker), argv.join(' '));
  }
  for (const argv of [['save', '--message', 'x'], ['close'], ['switch', 'a'], ['worktree', 'a'], ['create', 'x'], ['note', 'add', 'f', '1', 'c'], ['discuss', 'start'], ['discuss', 'input', 'd'], ['review', 'add'], ['--workspace', 'status', 'save']]) {
    assert.throws(() => assertParticipantMayRun(argv, marker), (error: any) => error.code === 'PARTICIPANT_FORBIDDEN', argv.join(' '));
  }
  assert.doesNotThrow(() => assertParticipantMayRun(['save', '--message', 'x'], null));
});

test('the CLI refuses a mutating command under the participant marker before touching state', async () => {
  const cli = path.resolve(import.meta.dirname, '..', 'cli.ts');
  const run = await exec(process.execPath, [cli, 'save', '--message', 'x', '--json'], { env: { ...process.env, GRIND_DISCUSSION_PARTICIPANT: 'd-1:critic' } }).catch((error) => error);
  assert.equal(JSON.parse(run.stdout).error.code, 'PARTICIPANT_FORBIDDEN');
});

test('engine arguments keep participants read-only on first launch and resume', () => {
  const base = { model: 'm', cwd: '/w', readableRoots: ['/r1', '/r2'], schema: {}, schemaFile: '/s.json', lastMessageFile: '/l.txt' };
  const claudeFirst = engineArgs({ ...base, engine: 'claude', sessionId: 'sid', resume: false });
  assert.deepEqual(claudeFirst.slice(0, 5), ['-p', '--model', 'm', '--session-id', 'sid']);
  assert.deepEqual(claudeFirst.filter((arg, i) => claudeFirst[i - 1] === '--add-dir'), ['/r1', '/r2']);
  const claudeResume = engineArgs({ ...base, engine: 'claude', sessionId: 'sid', resume: true });
  assert.deepEqual(claudeResume.slice(3, 5), ['--resume', 'sid']);
  assert.throws(() => engineArgs({ ...base, engine: 'claude', sessionId: null, resume: false }), /explicit session ID/);
  assert.deepEqual(engineArgs({ ...base, engine: 'codex', sessionId: null, resume: false }).slice(0, 3), ['exec', '-C', '/w']);
  const codexResume = engineArgs({ ...base, engine: 'codex', sessionId: 'thread', resume: true });
  assert.deepEqual(codexResume.slice(0, 3), ['exec', 'resume', 'thread']);
  assert.ok(codexResume.includes('sandbox_mode="read-only"') && codexResume.at(-1) === '-');
  assert.equal(isCmuxShim('/Applications/cmux.app/Contents/Resources/bin/claude'), true);
  assert.equal(isCmuxShim('/opt/x/cmux-claude-wrapper'), true);
  assert.equal(isCmuxShim('/Users/me/.local/bin/claude'), false);
});

test('engine output parsing distinguishes structured answers, errors and interrupted streams', () => {
  const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-x' });
  const ok = parseEngineOutput('claude', `${init}\n${JSON.stringify({ type: 'result', is_error: false, structured_output: { a: 1 } })}\n`, null);
  assert.deepEqual(ok, { sessionId: 's1', model: 'claude-x', output: { a: 1 }, error: null });
  assert.equal(parseEngineOutput('claude', `${init}\n${JSON.stringify({ type: 'result', is_error: false, result: '```json\n{"b":2}\n```' })}\n`, null).output!.constructor, Object);
  assert.match(parseEngineOutput('claude', `${init}\n{"type":"res`, null).error!, /no result/);
  assert.match(parseEngineOutput('claude', `${init}\n${JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns' })}\n`, null).error!, /error_max_turns/);
  const codex = parseEngineOutput('codex', '{"type":"thread.started","thread_id":"t1"}\n{"type":"turn.completed"}\n', '{"c":3}');
  assert.deepEqual(codex, { sessionId: 't1', model: null, output: { c: 3 }, error: null });
  assert.match(parseEngineOutput('codex', '{"type":"thread.started","thread_id":"t1"}\n{"type":"turn.failed","error":{"message":"quota"}}\n', null).error!, /quota/);
});
