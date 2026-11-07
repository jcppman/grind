import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Deterministic stand-ins for the Claude and Codex CLIs. They
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

export interface Fakes {
  root: string;
  claude: string;
  codex: string;
  plan: string;
  log: string;
  env: NodeJS.ProcessEnv;
  setPlan(plan: { participants?: Record<string, Record<string, string>>; content?: string }): Promise<void>;
  invocations(): Promise<Array<Record<string, unknown>>>;
  cleanup(): Promise<void>;
}

async function script(file: string, body: string, env: Record<string, string> = {}): Promise<void> {
  const exports = Object.entries(env).map(([key, value]) => `process.env.${key} = ${JSON.stringify(value)};`).join('\n');
  await writeFile(file, `#!${process.execPath}\n${exports}\n${body}`);
  await chmod(file, 0o755);
}

export async function makeFakes(): Promise<Fakes> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'grind-discuss-')));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const plan = path.join(root, 'plan.json');
  const log = path.join(root, 'invocations.jsonl');
  const claude = path.join(bin, 'claude');
  const codex = path.join(bin, 'codex');
  await script(claude, FAKE_ENGINE, { FAKE_ENGINE_NAME: 'claude' });
  await script(codex, FAKE_ENGINE, { FAKE_ENGINE_NAME: 'codex' });
  await writeFile(log, '');
  const fakes: Fakes = {
    root, claude, codex, plan, log,
    env: {
      ...process.env,
      HOME: process.env['HOME'] ?? root,
      PATH: process.env['PATH'] ?? '',
      XDG_STATE_HOME: path.join(root, 'state'),
      XDG_CONFIG_HOME: path.join(root, 'config'),
      FAKE_DISCUSS_PLAN: plan,
    },
    async setPlan(value) {
      await writeFile(plan, JSON.stringify({ log, ...value }));
    },
    async invocations() {
      return (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
  delete fakes.env['CLAUDE_CONFIG_DIR'];
  delete fakes.env['GRIND_DISCUSSION_PARTICIPANT'];
  await fakes.setPlan({});
  return fakes;
}

/** Writes a personal discussions configuration that pins both engines to the fakes. */
export async function writePersonalConfig(fakes: Fakes, config: Record<string, unknown>): Promise<void> {
  const dir = path.join(fakes.env['XDG_CONFIG_HOME']!, 'grind');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'discussions.json'), JSON.stringify({ engines: { claude: { executable: fakes.claude }, codex: { executable: fakes.codex } }, ...config }));
}
