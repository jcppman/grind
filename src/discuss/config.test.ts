import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadLayeredConfig, personalConfigPath, resolveEffective } from './config.ts';
import { loadWorkspace } from '../workspace.ts';
import { makeTempWorkspace } from '../test-helpers.ts';

const roles = { architect: { instructions: 'Design.' }, critic: { instructions: 'Critique.' }, operator: { instructions: 'Operate.' } };
const pair = { participants: [{ id: 'a', engine: 'claude', model: 'opus', role: 'architect' }, { id: 'c', engine: 'codex', model: 'gpt', role: 'critic' }], writer: 'a' };

async function fixture(t: { after: (fn: () => Promise<void>) => void }, personal: unknown, workspace: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'grind-discuss-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: path.join(dir, 'xdg') };
  if (personal !== undefined) {
    await mkdir(path.join(dir, 'xdg', 'grind'), { recursive: true });
    await writeFile(path.join(dir, 'xdg', 'grind', 'discussions.json'), JSON.stringify(personal));
  }
  const workspaceConfigPath = path.join(dir, 'grind-workspace.json');
  await writeFile(workspaceConfigPath, JSON.stringify({ stateRepository: './state', ...(workspace === undefined ? {} : { discussions: workspace }) }));
  return { env, workspaceConfigPath };
}

test('personal configuration defaults to ~/.config and honours an absolute XDG_CONFIG_HOME', () => {
  assert.equal(personalConfigPath({}), path.join(os.homedir(), '.config', 'grind', 'discussions.json'));
  assert.equal(personalConfigPath({ XDG_CONFIG_HOME: 'relative' }), path.join(os.homedir(), '.config', 'grind', 'discussions.json'));
  assert.equal(personalConfigPath({ XDG_CONFIG_HOME: '/x' }), '/x/grind/discussions.json');
});

test('workspace presets replace whole personal presets, defaults merge by field, and overrides win last', async (t) => {
  const { env, workspaceConfigPath } = await fixture(t,
    { schemaVersion: 1, defaults: { preset: 'design', maxRounds: 5, turnTimeoutSeconds: 100 }, roles, presets: { design: { participants: [...pair.participants, { id: 'o', engine: 'claude', model: 'opus', role: 'operator' }], writer: 'o' } } },
    { defaults: { maxRounds: 2 }, presets: { design: pair } });
  const layered = await loadLayeredConfig({ workspaceConfigPath, env });
  const effective = resolveEffective(layered);
  assert.deepEqual(effective.participants.map((p) => p.id), ['a', 'c'], 'participant arrays replace, never append');
  assert.equal(effective.writer, 'a');
  assert.equal(effective.limits.maxRounds, 2);
  assert.equal(effective.limits.turnTimeoutSeconds, 100);
  assert.equal(effective.limits.maxConcurrent, 2, 'built-in default fills the gap');
  assert.equal(effective.participants[1]!.instructions, 'Critique.');
  assert.equal(resolveEffective(layered, { maxRounds: 1, presentation: 'headless' }).limits.maxRounds, 1);
  assert.equal(resolveEffective(layered, { presentation: 'headless' }).presentation, 'headless');
  assert.equal(resolveEffective(layered, { maxConcurrent: 5 }).limits.maxConcurrent, 2, 'concurrency never exceeds the participant count');
});

test('a workspace role replaces the personal role of the same name', async (t) => {
  const { env, workspaceConfigPath } = await fixture(t, { roles, presets: { design: pair } }, { roles: { critic: { instructions: 'Workspace critic.' } } });
  const effective = resolveEffective(await loadLayeredConfig({ workspaceConfigPath, env }), { preset: 'design' });
  assert.equal(effective.participants.find((p) => p.id === 'c')!.instructions, 'Workspace critic.');
});

test('validation rejects bad participants, writers, roles, limits and unknown fields with their source path', async (t) => {
  const cases: Array<[unknown, unknown, RegExp]> = [
    [{ roles, presets: { design: { participants: [pair.participants[0]], writer: 'a' } } }, undefined, /at least two participants/],
    [{ roles, presets: { design: { participants: [pair.participants[0], pair.participants[0]], writer: 'a' } } }, undefined, /duplicate participant "a"/],
    [{ roles, presets: { design: { ...pair, writer: 'zed' } } }, undefined, /writer.*not a participant/],
    [{ roles: { architect: roles.architect }, presets: { design: pair } }, undefined, /undefined role "critic"/],
    [{ roles, presets: { design: pair }, defaults: { maxRounds: 0 } }, undefined, /maxRounds: must be a positive integer/],
    [{ roles, presets: { design: pair }, extra: true }, undefined, /discussions\.json\.extra: unknown field/],
    [{ roles, presets: { design: pair } }, { engines: { claude: { executable: '/bin/sh' } } }, /#discussions\.engines: unknown field/],
    [{ roles, presets: { design: { participants: [{ ...pair.participants[0], engine: 'gemini' }, pair.participants[1]], writer: 'a' } } }, undefined, /engine: must be one of claude, codex/],
    [{ roles, presets: { design: pair }, engines: { claude: { executable: 'claude' } } }, undefined, /executable: must be an absolute path/],
    [{ roles, presets: { design: { participants: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, engine: 'codex', model: 'm', role: 'critic' })), writer: 'p0' } } }, undefined, /at most 8 participants/],
  ];
  for (const [personal, workspace, pattern] of cases) {
    const { env, workspaceConfigPath } = await fixture(t, personal, workspace);
    await assert.rejects(async () => resolveEffective(await loadLayeredConfig({ workspaceConfigPath, env }), { preset: 'design' }), pattern);
  }
});

test('discussions configuration does not disturb existing workspace resolution', async (t) => {
  const ws = await makeTempWorkspace();
  t.after(ws.cleanup);
  await writeFile(path.join(ws.root, 'grind-workspace.json'), JSON.stringify({ stateRepository: './grind-state', discussions: { defaults: { maxRounds: 2 } } }));
  const workspace = await loadWorkspace({ cwd: ws.root });
  assert.equal(workspace.stateDir, ws.stateDir);
  const layered = await loadLayeredConfig({ workspaceConfigPath: workspace.configPath, env: { XDG_CONFIG_HOME: path.join(ws.root, 'none') } });
  assert.equal(layered.merged.defaults.maxRounds, 2);
  assert.deepEqual(layered.sources.map((s) => [s.kind, s.present]), [['personal', false], ['workspace', true]]);
});
