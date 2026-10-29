import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrindError } from '../errors.ts';
import { isRecord } from '../frontmatter.ts';

export const ENGINES = ['claude', 'codex'] as const;
export type Engine = (typeof ENGINES)[number];
export const PRESENTATIONS = ['cmux', 'headless'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];
export const MAX_PARTICIPANTS = 8;

export interface Limits {
  maxRounds: number;
  maxConcurrent: number;
  turnTimeoutSeconds: number;
  totalTimeoutSeconds: number;
}

export interface Defaults extends Limits {
  preset: string | null;
  presentation: Presentation;
}

export interface Role {
  instructions: string;
}

export interface Participant {
  id: string;
  engine: Engine;
  model: string;
  role: string;
}

export interface Preset {
  participants: Participant[];
  writer: string;
}

export interface EngineSettings {
  executable: string;
}

export interface DiscussionsConfig {
  defaults: Partial<Defaults>;
  roles: Record<string, Role>;
  presets: Record<string, Preset>;
  engines: Partial<Record<Engine, EngineSettings>>;
}

export interface ConfigSource {
  kind: 'personal' | 'workspace';
  path: string;
  present: boolean;
}

export interface LayeredConfig {
  sources: ConfigSource[];
  merged: DiscussionsConfig;
  /** Where each role and preset entry was last defined. */
  origins: { roles: Record<string, string>; presets: Record<string, string> };
}

export interface Overrides extends Partial<Defaults> {
  preset?: string;
}

export interface EffectiveConfig {
  preset: string;
  participants: Array<Participant & { instructions: string }>;
  writer: string;
  presentation: Presentation;
  limits: Limits;
  engines: Partial<Record<Engine, EngineSettings>>;
  sources: ConfigSource[];
}

export const BUILT_IN: DiscussionsConfig = {
  defaults: { preset: null, presentation: 'cmux', maxRounds: 3, maxConcurrent: 2, turnTimeoutSeconds: 900, totalTimeoutSeconds: 3600 },
  roles: {},
  presets: {},
  engines: {},
};

const DEFAULT_KEYS = ['preset', 'presentation', 'maxRounds', 'maxConcurrent', 'turnTimeoutSeconds', 'totalTimeoutSeconds'] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function personalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['XDG_CONFIG_HOME'] && path.isAbsolute(env['XDG_CONFIG_HOME']) ? env['XDG_CONFIG_HOME'] : path.join(os.homedir(), '.config');
  return path.join(base, 'grind', 'discussions.json');
}

function invalid(where: string, message: string): never {
  throw new GrindError('DISCUSSION_CONFIG_INVALID', `${where}: ${message}`, { path: where });
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${where}.${key}`, 'unknown field');
}

function positiveInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid(where, 'must be a positive integer');
  return value;
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(where, 'must be a nonempty string');
  return value;
}

function parseDefaults(value: unknown, where: string): Partial<Defaults> {
  if (!isRecord(value)) invalid(where, 'must be an object');
  onlyKeys(value, DEFAULT_KEYS, where);
  const out: Partial<Defaults> = {};
  if (value['preset'] !== undefined) out.preset = nonEmptyString(value['preset'], `${where}.preset`);
  if (value['presentation'] !== undefined) {
    if (!(PRESENTATIONS as readonly unknown[]).includes(value['presentation'])) invalid(`${where}.presentation`, 'must be cmux or headless');
    out.presentation = value['presentation'] as Presentation;
  }
  for (const key of ['maxRounds', 'maxConcurrent', 'turnTimeoutSeconds', 'totalTimeoutSeconds'] as const) {
    if (value[key] !== undefined) out[key] = positiveInteger(value[key], `${where}.${key}`);
  }
  return out;
}

function parseParticipant(value: unknown, where: string): Participant {
  if (!isRecord(value)) invalid(where, 'must be an object');
  onlyKeys(value, ['id', 'engine', 'model', 'role'], where);
  const id = nonEmptyString(value['id'], `${where}.id`);
  if (!ID.test(id)) invalid(`${where}.id`, 'must use letters, digits, - or _');
  if (!(ENGINES as readonly unknown[]).includes(value['engine'])) invalid(`${where}.engine`, `must be one of ${ENGINES.join(', ')}`);
  return { id, engine: value['engine'] as Engine, model: nonEmptyString(value['model'], `${where}.model`), role: nonEmptyString(value['role'], `${where}.role`) };
}

function parsePreset(value: unknown, where: string): Preset {
  if (!isRecord(value)) invalid(where, 'must be an object');
  onlyKeys(value, ['participants', 'writer'], where);
  if (!Array.isArray(value['participants'])) invalid(`${where}.participants`, 'must be an array');
  return {
    participants: value['participants'].map((item, index) => parseParticipant(item, `${where}.participants[${index}]`)),
    writer: nonEmptyString(value['writer'], `${where}.writer`),
  };
}

/** Parses one configuration layer; `engines` is accepted only from personal configuration. */
export function parseLayer(value: unknown, where: string, kind: ConfigSource['kind']): DiscussionsConfig {
  if (!isRecord(value)) invalid(where, 'must be an object');
  onlyKeys(value, kind === 'personal' ? ['schemaVersion', 'defaults', 'roles', 'presets', 'engines'] : ['schemaVersion', 'defaults', 'roles', 'presets'], where);
  if (value['schemaVersion'] !== undefined && value['schemaVersion'] !== 1) invalid(`${where}.schemaVersion`, 'must be 1');
  const layer: DiscussionsConfig = { defaults: {}, roles: {}, presets: {}, engines: {} };
  if (value['defaults'] !== undefined) layer.defaults = parseDefaults(value['defaults'], `${where}.defaults`);
  for (const section of ['roles', 'presets'] as const) {
    const entries = value[section];
    if (entries === undefined) continue;
    if (!isRecord(entries)) invalid(`${where}.${section}`, 'must be an object');
    for (const [name, entry] of Object.entries(entries)) {
      const at = `${where}.${section}.${name}`;
      if (!ID.test(name)) invalid(at, 'name must use letters, digits, - or _');
      if (section === 'roles') {
        if (!isRecord(entry)) invalid(at, 'must be an object');
        onlyKeys(entry, ['instructions'], at);
        layer.roles[name] = { instructions: nonEmptyString(entry['instructions'], `${at}.instructions`) };
      } else layer.presets[name] = parsePreset(entry, at);
    }
  }
  if (value['engines'] !== undefined) {
    const engines = value['engines'];
    if (!isRecord(engines)) invalid(`${where}.engines`, 'must be an object');
    for (const [engine, settings] of Object.entries(engines)) {
      const at = `${where}.engines.${engine}`;
      if (!(ENGINES as readonly string[]).includes(engine)) invalid(at, 'unknown engine');
      if (!isRecord(settings)) invalid(at, 'must be an object');
      onlyKeys(settings, ['executable'], at);
      const executable = nonEmptyString(settings['executable'], `${at}.executable`);
      if (!path.isAbsolute(executable)) invalid(`${at}.executable`, 'must be an absolute path');
      layer.engines[engine as Engine] = { executable };
    }
  }
  return layer;
}

/** Applies layers in increasing precedence: named entries replace whole entries, defaults merge by field. */
export function mergeLayers(layers: ReadonlyArray<{ config: DiscussionsConfig; where: string }>): LayeredConfig['merged'] & { origins: LayeredConfig['origins'] } {
  const merged: DiscussionsConfig = { defaults: { ...BUILT_IN.defaults }, roles: {}, presets: {}, engines: {} };
  const origins: LayeredConfig['origins'] = { roles: {}, presets: {} };
  for (const { config, where } of layers) {
    Object.assign(merged.defaults, config.defaults);
    for (const [name, role] of Object.entries(config.roles)) {
      merged.roles[name] = role;
      origins.roles[name] = `${where}.roles.${name}`;
    }
    for (const [name, preset] of Object.entries(config.presets)) {
      merged.presets[name] = preset;
      origins.presets[name] = `${where}.presets.${name}`;
    }
    Object.assign(merged.engines, config.engines);
  }
  return { ...merged, origins };
}

async function readJson(file: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    invalid(file, `is not valid JSON: ${(error as Error).message}`);
  }
}

/** Reads personal configuration and the `discussions` section of the workspace configuration. */
export async function loadLayeredConfig(options: { workspaceConfigPath: string | null; env?: NodeJS.ProcessEnv }): Promise<LayeredConfig> {
  const personalPath = personalConfigPath(options.env);
  const sources: ConfigSource[] = [];
  const layers: Array<{ config: DiscussionsConfig; where: string }> = [];
  const personal = await readJson(personalPath);
  sources.push({ kind: 'personal', path: personalPath, present: personal !== undefined });
  if (personal !== undefined) layers.push({ config: parseLayer(personal, personalPath, 'personal'), where: personalPath });
  if (options.workspaceConfigPath !== null) {
    const workspace = await readJson(options.workspaceConfigPath);
    const section = isRecord(workspace) ? workspace['discussions'] : undefined;
    sources.push({ kind: 'workspace', path: options.workspaceConfigPath, present: section !== undefined });
    const where = `${options.workspaceConfigPath}#discussions`;
    if (section !== undefined) layers.push({ config: parseLayer(section, where, 'workspace'), where });
  }
  const { origins, ...merged } = mergeLayers(layers);
  return { sources, merged, origins };
}

/** Selects a preset and resolves defaults and overrides into a validated effective configuration. */
export function resolveEffective(layered: LayeredConfig, overrides: Overrides = {}): EffectiveConfig {
  const defaults = { ...layered.merged.defaults, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) } as Partial<Defaults>;
  const presetName = defaults.preset;
  if (!presetName) throw new GrindError('DISCUSSION_CONFIG_INVALID', 'No preset selected; pass --preset or set defaults.preset', { presets: Object.keys(layered.merged.presets) });
  const preset = layered.merged.presets[presetName];
  if (!preset) throw new GrindError('DISCUSSION_CONFIG_INVALID', `Unknown preset "${presetName}"`, { presets: Object.keys(layered.merged.presets) });
  const where = layered.origins.presets[presetName] ?? `presets.${presetName}`;
  const limits: Limits = {
    maxRounds: positiveInteger(defaults.maxRounds, 'defaults.maxRounds'),
    maxConcurrent: positiveInteger(defaults.maxConcurrent, 'defaults.maxConcurrent'),
    turnTimeoutSeconds: positiveInteger(defaults.turnTimeoutSeconds, 'defaults.turnTimeoutSeconds'),
    totalTimeoutSeconds: positiveInteger(defaults.totalTimeoutSeconds, 'defaults.totalTimeoutSeconds'),
  };
  if (preset.participants.length < 2) invalid(`${where}.participants`, 'requires at least two participants');
  if (preset.participants.length > MAX_PARTICIPANTS) invalid(`${where}.participants`, `allows at most ${MAX_PARTICIPANTS} participants`);
  const ids = new Set<string>();
  const participants = preset.participants.map((participant, index) => {
    if (ids.has(participant.id)) invalid(`${where}.participants[${index}].id`, `duplicate participant "${participant.id}"`);
    ids.add(participant.id);
    const role = layered.merged.roles[participant.role];
    if (!role) invalid(`${where}.participants[${index}].role`, `undefined role "${participant.role}"`);
    return { ...participant, instructions: role.instructions };
  });
  if (!ids.has(preset.writer)) invalid(`${where}.writer`, `"${preset.writer}" is not a participant`);
  // A shared default may name more workers than a small preset has; never run more than one per participant.
  limits.maxConcurrent = Math.min(limits.maxConcurrent, participants.length);
  if (limits.turnTimeoutSeconds > limits.totalTimeoutSeconds) invalid('defaults.turnTimeoutSeconds', 'must not exceed totalTimeoutSeconds');
  return {
    preset: presetName,
    participants,
    writer: preset.writer,
    presentation: defaults.presentation ?? 'cmux',
    limits,
    engines: layered.merged.engines,
    sources: layered.sources,
  };
}
