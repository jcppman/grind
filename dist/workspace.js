import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.js';
import { gitToplevel } from './git.js';
import { isRecord } from './frontmatter.js';
import { isDirectory, pathExists, pathsBelow } from './paths.js';
export const WORKSPACE_CONFIG_FILENAME = 'grind-workspace.json';
export const INITIATIVES_FOLDER = 'initiatives';
/** Nearest configuration file at or above `startDir`, or null. */
export async function findWorkspaceConfig(startDir) {
    let current = path.resolve(startDir);
    for (;;) {
        const candidate = path.join(current, WORKSPACE_CONFIG_FILENAME);
        if (await pathExists(candidate))
            return candidate;
        const parent = path.dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
export async function loadWorkspace(options) {
    const configPath = await locateConfig(options);
    const root = await realpath(path.dirname(configPath));
    const { stateRepository } = await readWorkspaceSettings(configPath);
    const stateDir = path.resolve(root, stateRepository);
    if (!(await isDirectory(stateDir))) {
        throw new GrindError('STATE_REPOSITORY_INVALID', `State directory ${stateDir} does not exist; milestone 1 requires an existing directory`, { stateDir });
    }
    const realStateDir = await realpath(stateDir);
    const stateGitRoot = await gitToplevel(realStateDir);
    if (stateGitRoot === null) {
        throw new GrindError('STATE_REPOSITORY_INVALID', `State directory ${realStateDir} is not inside an initialized Git repository`, { stateDir: realStateDir });
    }
    return {
        root,
        configPath,
        stateDir: realStateDir,
        stateGitRoot,
        initiativesDir: path.join(realStateDir, INITIATIVES_FOLDER),
    };
}
async function locateConfig(options) {
    if (options.workspace !== undefined) {
        const explicit = path.resolve(options.cwd, options.workspace, WORKSPACE_CONFIG_FILENAME);
        if (!(await pathExists(explicit))) {
            throw new GrindError('WORKSPACE_NOT_FOUND', `No ${WORKSPACE_CONFIG_FILENAME} in ${path.dirname(explicit)}`, { workspace: options.workspace });
        }
        return explicit;
    }
    const found = await findWorkspaceConfig(options.cwd);
    if (found === null) {
        throw new GrindError('WORKSPACE_NOT_FOUND', `No ${WORKSPACE_CONFIG_FILENAME} found at or above ${options.cwd}; pass --workspace <directory>`, { cwd: options.cwd });
    }
    return found;
}
export async function readWorkspaceSettings(configPath) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(configPath, 'utf8'));
    }
    catch (error) {
        throw new GrindError('WORKSPACE_CONFIG_INVALID', `${configPath} is not valid JSON: ${error.message}`, { configPath });
    }
    if (!isRecord(parsed)) {
        throw new GrindError('WORKSPACE_CONFIG_INVALID', `${configPath} must contain a JSON object`, {
            configPath,
        });
    }
    const stateRepository = parsed['stateRepository'];
    if (typeof stateRepository !== 'string' || stateRepository.trim() === '') {
        throw new GrindError('WORKSPACE_CONFIG_INVALID', `${configPath} requires a nonempty "stateRepository" string`, { configPath });
    }
    const enabled = parsed['contextOnSessionStart'];
    if (enabled !== undefined && typeof enabled !== 'boolean') {
        throw new GrindError('WORKSPACE_CONFIG_INVALID', 'contextOnSessionStart must be a boolean', { configPath });
    }
    return { stateRepository, contextOnSessionStart: enabled ?? false };
}
/**
 * Configuration file of a nested workspace between `root` (exclusive) and
 * `target` (inclusive), or null when `target` belongs to `root` directly.
 */
export async function findNestedWorkspaceConfig(root, target) {
    for (const dir of pathsBelow(root, target)) {
        const candidate = path.join(dir, WORKSPACE_CONFIG_FILENAME);
        if (await pathExists(candidate))
            return candidate;
    }
    return null;
}
//# sourceMappingURL=workspace.js.map