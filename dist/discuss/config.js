import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrindError } from '../errors.js';
import { isRecord } from '../frontmatter.js';
export const ENGINES = ['claude', 'codex'];
export const PRESENTATIONS = ['cmux', 'headless'];
export const MAX_PARTICIPANTS = 8;
export const BUILT_IN = {
    defaults: { preset: null, presentation: 'cmux', maxRounds: 3, maxConcurrent: 2, turnTimeoutSeconds: 900, totalTimeoutSeconds: 3600 },
    roles: {},
    presets: {},
    engines: {},
};
const DEFAULT_KEYS = ['preset', 'presentation', 'maxRounds', 'maxConcurrent', 'turnTimeoutSeconds', 'totalTimeoutSeconds'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function personalConfigPath(env = process.env) {
    const base = env['XDG_CONFIG_HOME'] && path.isAbsolute(env['XDG_CONFIG_HOME']) ? env['XDG_CONFIG_HOME'] : path.join(os.homedir(), '.config');
    return path.join(base, 'grind', 'discussions.json');
}
function invalid(where, message) {
    throw new GrindError('DISCUSSION_CONFIG_INVALID', `${where}: ${message}`, { path: where });
}
function onlyKeys(value, allowed, where) {
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            invalid(`${where}.${key}`, 'unknown field');
}
function positiveInteger(value, where) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
        invalid(where, 'must be a positive integer');
    return value;
}
function nonEmptyString(value, where) {
    if (typeof value !== 'string' || value.trim() === '')
        invalid(where, 'must be a nonempty string');
    return value;
}
function parseDefaults(value, where) {
    if (!isRecord(value))
        invalid(where, 'must be an object');
    onlyKeys(value, DEFAULT_KEYS, where);
    const out = {};
    if (value['preset'] !== undefined)
        out.preset = nonEmptyString(value['preset'], `${where}.preset`);
    if (value['presentation'] !== undefined) {
        if (!PRESENTATIONS.includes(value['presentation']))
            invalid(`${where}.presentation`, 'must be cmux or headless');
        out.presentation = value['presentation'];
    }
    for (const key of ['maxRounds', 'maxConcurrent', 'turnTimeoutSeconds', 'totalTimeoutSeconds']) {
        if (value[key] !== undefined)
            out[key] = positiveInteger(value[key], `${where}.${key}`);
    }
    return out;
}
function parseParticipant(value, where) {
    if (!isRecord(value))
        invalid(where, 'must be an object');
    onlyKeys(value, ['id', 'engine', 'model', 'role'], where);
    const id = nonEmptyString(value['id'], `${where}.id`);
    if (!ID.test(id))
        invalid(`${where}.id`, 'must use letters, digits, - or _');
    if (!ENGINES.includes(value['engine']))
        invalid(`${where}.engine`, `must be one of ${ENGINES.join(', ')}`);
    return { id, engine: value['engine'], model: nonEmptyString(value['model'], `${where}.model`), role: nonEmptyString(value['role'], `${where}.role`) };
}
function parsePreset(value, where) {
    if (!isRecord(value))
        invalid(where, 'must be an object');
    onlyKeys(value, ['participants', 'writer'], where);
    if (!Array.isArray(value['participants']))
        invalid(`${where}.participants`, 'must be an array');
    return {
        participants: value['participants'].map((item, index) => parseParticipant(item, `${where}.participants[${index}]`)),
        writer: nonEmptyString(value['writer'], `${where}.writer`),
    };
}
/** Parses one configuration layer; `engines` is accepted only from personal configuration. */
export function parseLayer(value, where, kind) {
    if (!isRecord(value))
        invalid(where, 'must be an object');
    onlyKeys(value, kind === 'personal' ? ['schemaVersion', 'defaults', 'roles', 'presets', 'engines'] : ['schemaVersion', 'defaults', 'roles', 'presets'], where);
    if (value['schemaVersion'] !== undefined && value['schemaVersion'] !== 1)
        invalid(`${where}.schemaVersion`, 'must be 1');
    const layer = { defaults: {}, roles: {}, presets: {}, engines: {} };
    if (value['defaults'] !== undefined)
        layer.defaults = parseDefaults(value['defaults'], `${where}.defaults`);
    for (const section of ['roles', 'presets']) {
        const entries = value[section];
        if (entries === undefined)
            continue;
        if (!isRecord(entries))
            invalid(`${where}.${section}`, 'must be an object');
        for (const [name, entry] of Object.entries(entries)) {
            const at = `${where}.${section}.${name}`;
            if (!ID.test(name))
                invalid(at, 'name must use letters, digits, - or _');
            if (section === 'roles') {
                if (!isRecord(entry))
                    invalid(at, 'must be an object');
                onlyKeys(entry, ['instructions'], at);
                layer.roles[name] = { instructions: nonEmptyString(entry['instructions'], `${at}.instructions`) };
            }
            else
                layer.presets[name] = parsePreset(entry, at);
        }
    }
    if (value['engines'] !== undefined) {
        const engines = value['engines'];
        if (!isRecord(engines))
            invalid(`${where}.engines`, 'must be an object');
        for (const [engine, settings] of Object.entries(engines)) {
            const at = `${where}.engines.${engine}`;
            if (!ENGINES.includes(engine))
                invalid(at, 'unknown engine');
            if (!isRecord(settings))
                invalid(at, 'must be an object');
            onlyKeys(settings, ['executable'], at);
            const executable = nonEmptyString(settings['executable'], `${at}.executable`);
            if (!path.isAbsolute(executable))
                invalid(`${at}.executable`, 'must be an absolute path');
            layer.engines[engine] = { executable };
        }
    }
    return layer;
}
/** Applies layers in increasing precedence: named entries replace whole entries, defaults merge by field. */
export function mergeLayers(layers) {
    const merged = { defaults: { ...BUILT_IN.defaults }, roles: {}, presets: {}, engines: {} };
    const origins = { roles: {}, presets: {} };
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
async function readJson(file) {
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        invalid(file, `is not valid JSON: ${error.message}`);
    }
}
/** Reads personal configuration and the `discussions` section of the workspace configuration. */
export async function loadLayeredConfig(options) {
    const personalPath = personalConfigPath(options.env);
    const sources = [];
    const layers = [];
    const personal = await readJson(personalPath);
    sources.push({ kind: 'personal', path: personalPath, present: personal !== undefined });
    if (personal !== undefined)
        layers.push({ config: parseLayer(personal, personalPath, 'personal'), where: personalPath });
    if (options.workspaceConfigPath !== null) {
        const workspace = await readJson(options.workspaceConfigPath);
        const section = isRecord(workspace) ? workspace['discussions'] : undefined;
        sources.push({ kind: 'workspace', path: options.workspaceConfigPath, present: section !== undefined });
        const where = `${options.workspaceConfigPath}#discussions`;
        if (section !== undefined)
            layers.push({ config: parseLayer(section, where, 'workspace'), where });
    }
    const { origins, ...merged } = mergeLayers(layers);
    return { sources, merged, origins };
}
/** Selects a preset and resolves defaults and overrides into a validated effective configuration. */
export function resolveEffective(layered, overrides = {}) {
    const defaults = { ...layered.merged.defaults, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) };
    const presetName = defaults.preset;
    if (!presetName)
        throw new GrindError('DISCUSSION_CONFIG_INVALID', 'No preset selected; pass --preset or set defaults.preset', { presets: Object.keys(layered.merged.presets) });
    const preset = layered.merged.presets[presetName];
    if (!preset)
        throw new GrindError('DISCUSSION_CONFIG_INVALID', `Unknown preset "${presetName}"`, { presets: Object.keys(layered.merged.presets) });
    const where = layered.origins.presets[presetName] ?? `presets.${presetName}`;
    const limits = {
        maxRounds: positiveInteger(defaults.maxRounds, 'defaults.maxRounds'),
        maxConcurrent: positiveInteger(defaults.maxConcurrent, 'defaults.maxConcurrent'),
        turnTimeoutSeconds: positiveInteger(defaults.turnTimeoutSeconds, 'defaults.turnTimeoutSeconds'),
        totalTimeoutSeconds: positiveInteger(defaults.totalTimeoutSeconds, 'defaults.totalTimeoutSeconds'),
    };
    if (preset.participants.length < 2)
        invalid(`${where}.participants`, 'requires at least two participants');
    if (preset.participants.length > MAX_PARTICIPANTS)
        invalid(`${where}.participants`, `allows at most ${MAX_PARTICIPANTS} participants`);
    const ids = new Set();
    const participants = preset.participants.map((participant, index) => {
        if (ids.has(participant.id))
            invalid(`${where}.participants[${index}].id`, `duplicate participant "${participant.id}"`);
        ids.add(participant.id);
        const role = layered.merged.roles[participant.role];
        if (!role)
            invalid(`${where}.participants[${index}].role`, `undefined role "${participant.role}"`);
        return { ...participant, instructions: role.instructions };
    });
    if (!ids.has(preset.writer))
        invalid(`${where}.writer`, `"${preset.writer}" is not a participant`);
    // A shared default may name more workers than a small preset has; never run more than one per participant.
    limits.maxConcurrent = Math.min(limits.maxConcurrent, participants.length);
    if (limits.turnTimeoutSeconds > limits.totalTimeoutSeconds)
        invalid('defaults.turnTimeoutSeconds', 'must not exceed totalTimeoutSeconds');
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
//# sourceMappingURL=config.js.map