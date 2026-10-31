import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Deterministic stand-ins for the Claude and Codex CLIs and for cmux. They
 * speak the same output formats the adapters parse, record every invocation,
 * and follow a per-participant behavior plan so tests never call a model.
 */
const FAKE_ENGINE = String.raw`
const fs = require('node:fs');
const crypto = require('node:crypto');
const engine = process.env.FAKE_ENGINE_NAME;
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('fake ' + engine + ' 1.0'); process.exit(0); }
const plan = JSON.parse(fs.readFileSync(process.env.FAKE_DISCUSS_PLAN, 'utf8'));
const brief = fs.readFileSync(0, 'utf8');
const marker = 'Copy these fields exactly:\n';
const contract = JSON.parse(brief.slice(brief.indexOf(marker) + marker.length).split('\n')[0]);
const targets = (brief.match(/- Authorized document targets: ([^\n(]+)/) || [])[1].trim().split(', ');
const after = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const sessionId = engine === 'claude' ? (after('--session-id') || after('--resume')) : (args[1] === 'resume' ? args[2] : crypto.randomUUID());
fs.appendFileSync(plan.log, JSON.stringify({ engine, participant: contract.participant, phase: contract.phase, turnId: contract.turnId, args, cwd: process.cwd(), marker: process.env.GRIND_DISCUSSION_PARTICIPANT || null, claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || null, sessionId, snapshotId: contract.snapshotId, init: (brief.match(/- Owning init: ([^\n]+)/) || [])[1] || null, bundleHasIntent: brief.includes('### intent: ') }) + '\n');
const behavior = ((plan.participants || {})[contract.participant] || {})[contract.phase] || 'ok';
const count = (key) => { const file = plan.log + '.' + key; const n = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0; fs.writeFileSync(file, String(n + 1)); return n; };
if (behavior === 'hang') { setInterval(() => {}, 1000); return; }
if (behavior === 'crash') { process.stderr.write('fake crash\n'); process.exit(3); }
let body;
if (contract.phase === 'assess') body = { summary: 'assessment by ' + contract.participant, findings: [{ id: contract.participant + '-f1', kind: 'finding', text: 'fact from ' + contract.participant, evidence: ['brief'] }] };
else if (contract.phase === 'draft') body = { summary: 'draft ' + contract.revision, documents: targets.map((target) => ({ target, content: (plan.content || 'fake plan') + ' revision ' + contract.revision + '\n' })), assumptions: ['assumption ' + contract.revision], dispositions: [] };
else {
  let choice = behavior === 'ok' ? 'accept' : behavior;
  if (behavior === 'object_once') choice = count(contract.participant + '-objected') === 0 ? 'object' : 'accept';
  if (behavior === 'question_once') choice = count(contract.participant + '-asked') === 0 ? 'question' : 'accept';
  body = choice === 'accept'
    ? { decision: 'accept', candidateHash: contract.candidateHash, objections: [] }
    : { decision: 'object', candidateHash: contract.candidateHash, objections: [{ id: contract.participant + '-o' + contract.revision, kind: choice === 'question' ? 'user_question' : 'objection', text: choice === 'question' ? 'Which option does the user want?' : 'needs change', evidence: [] }] };
}
let output = { ...contract, ...body };
delete output.candidateHash;
if (contract.phase === 'ratify') output.candidateHash = body.candidateHash;
if (behavior === 'garbage') output = { nonsense: true };
if (behavior === 'wrong_turn') output = { ...output, turnId: 'tother' };
if (engine === 'claude') {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-claude-model' }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(output), structured_output: output }));
} else {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: sessionId }));
  fs.writeFileSync(after('-o'), JSON.stringify(output));
  console.log(JSON.stringify({ type: 'turn.completed' }));
}
`;

const FAKE_CMUX = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2).filter((arg, i, all) => arg !== '--json' && arg !== '--id-format' && all[i - 1] !== '--id-format');
const log = process.env.FAKE_CMUX_LOG;
fs.appendFileSync(log, JSON.stringify({ args, surface: process.env.CMUX_SURFACE_ID || null }) + '\n');
if (process.env.FAKE_CMUX_MODE !== 'ok') { process.stderr.write('Error: ERROR: Access denied - only processes started inside cmux can connect\n'); process.exit(1); }
const after = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const counter = log + '.n';
const next = () => { const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1; fs.writeFileSync(counter, String(n)); return n; };
if (args[0] === 'identify') { console.log(JSON.stringify({ socket_path: 'fake' })); process.exit(0); }
if (args[0] === 'new-workspace' || args[0] === 'new-pane') {
  const n = next();
  const workspace = args[0] === 'new-workspace' ? 'workspace:' + n : after('--workspace');
  const surface = 'surface:' + n;
  const out = fs.openSync(log + '.' + surface.replace(':', '-') + '.out', 'a');
  spawn('/bin/sh', ['-c', after('--command')], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, CMUX_SURFACE_ID: surface, CMUX_WORKSPACE_ID: workspace } }).unref();
  console.log(JSON.stringify({ workspace_ref: workspace, surface_ref: surface }));
  process.exit(0);
}
if (args[0] === 'list-workspaces') {
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  console.log(JSON.stringify({ workspaces: Array.from({ length: n }, (_, i) => ({ id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), ref: 'workspace:' + (i + 1) })) }));
  process.exit(0);
}
if (args[0] === 'rename-tab' || args[0] === 'close-workspace') { console.log('{}'); process.exit(0); }
process.stderr.write('unsupported fake cmux command ' + args[0] + '\n');
process.exit(2);
`;

export interface Fakes {
  root: string;
  claude: string;
  codex: string;
  cmux: string;
  plan: string;
  log: string;
  cmuxLog: string;
  env: NodeJS.ProcessEnv;
  setPlan(plan: { participants?: Record<string, Record<string, string>>; content?: string }): Promise<void>;
  invocations(): Promise<Array<Record<string, unknown>>>;
  cmuxCalls(): Promise<Array<{ args: string[]; surface: string | null }>>;
  cleanup(): Promise<void>;
}

async function script(file: string, body: string, env: Record<string, string> = {}): Promise<void> {
  const exports = Object.entries(env).map(([key, value]) => `process.env.${key} = ${JSON.stringify(value)};`).join('\n');
  await writeFile(file, `#!${process.execPath}\n${exports}\n${body}`);
  await chmod(file, 0o755);
}

export async function makeFakes(options: { cmuxMode?: 'ok' | 'denied' } = {}): Promise<Fakes> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'grind-discuss-')));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const plan = path.join(root, 'plan.json');
  const log = path.join(root, 'invocations.jsonl');
  const cmuxLog = path.join(root, 'cmux.jsonl');
  const claude = path.join(bin, 'claude');
  const codex = path.join(bin, 'codex');
  const cmux = path.join(bin, 'cmux');
  await script(claude, FAKE_ENGINE, { FAKE_ENGINE_NAME: 'claude' });
  await script(codex, FAKE_ENGINE, { FAKE_ENGINE_NAME: 'codex' });
  await script(cmux, FAKE_CMUX);
  await writeFile(log, '');
  await writeFile(cmuxLog, '');
  const fakes: Fakes = {
    root, claude, codex, cmux, plan, log, cmuxLog,
    env: {
      ...process.env,
      HOME: process.env['HOME'] ?? root,
      PATH: process.env['PATH'] ?? '',
      XDG_STATE_HOME: path.join(root, 'state'),
      XDG_CONFIG_HOME: path.join(root, 'config'),
      FAKE_DISCUSS_PLAN: plan,
      FAKE_CMUX_LOG: cmuxLog,
      FAKE_CMUX_MODE: options.cmuxMode ?? 'denied',
      GRIND_CMUX: cmux,
    },
    async setPlan(value) {
      await writeFile(plan, JSON.stringify({ log, ...value }));
    },
    async invocations() {
      return (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    async cmuxCalls() {
      return (await readFile(cmuxLog, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; surface: string | null });
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
  delete fakes.env['CLAUDE_CONFIG_DIR'];
  delete fakes.env['GRIND_DISCUSSION_PARTICIPANT'];
  delete fakes.env['CMUX_SURFACE_ID'];
  delete fakes.env['CMUX_WORKSPACE_ID'];
  await fakes.setPlan({});
  return fakes;
}

/** Writes a personal discussions configuration that pins both engines to the fakes. */
export async function writePersonalConfig(fakes: Fakes, config: Record<string, unknown>): Promise<void> {
  const dir = path.join(fakes.env['XDG_CONFIG_HOME']!, 'grind');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'discussions.json'), JSON.stringify({ engines: { claude: { executable: fakes.claude }, codex: { executable: fakes.codex } }, ...config }));
}
