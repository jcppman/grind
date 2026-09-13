import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.ts';
import { gitToplevel } from './git.ts';
import { isRecord } from './frontmatter.ts';
import { isDirectory, pathExists, pathsBelow } from './paths.ts';

export const WORKSPACE_CONFIG_FILENAME = 'grind-workspace.json';
export const INITIATIVES_FOLDER = 'initiatives';

export interface Workspace {
  /** Directory containing the configuration file. */
  root: string;
  configPath: string;
  /** Configured state directory. */
  stateDir: string;
  /** Root of the Git repository containing the state directory. */
  stateGitRoot: string;
  initiativesDir: string;
}

export interface LoadWorkspaceOptions {
  cwd: string;
  /** Explicit workspace directory; bypasses upward discovery. */
  workspace?: string;
}

/** Nearest configuration file at or above `startDir`, or null. */
export async function findWorkspaceConfig(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, WORKSPACE_CONFIG_FILENAME);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function loadWorkspace(options: LoadWorkspaceOptions): Promise<Workspace> {
  const configPath = await locateConfig(options);
  const root = await realpath(path.dirname(configPath));
  const stateRepository = await readStateRepositorySetting(configPath);
  const stateDir = path.resolve(root, stateRepository);
  if (!(await isDirectory(stateDir))) {
    throw new GrindError(
      'STATE_REPOSITORY_INVALID',
      `State directory ${stateDir} does not exist; milestone 1 requires an existing directory`,
      { stateDir },
    );
  }
  const realStateDir = await realpath(stateDir);
  const stateGitRoot = await gitToplevel(realStateDir);
  if (stateGitRoot === null) {
    throw new GrindError(
      'STATE_REPOSITORY_INVALID',
      `State directory ${realStateDir} is not inside an initialized Git repository`,
      { stateDir: realStateDir },
    );
  }
  return {
    root,
    configPath,
    stateDir: realStateDir,
    stateGitRoot,
    initiativesDir: path.join(realStateDir, INITIATIVES_FOLDER),
  };
}

async function locateConfig(options: LoadWorkspaceOptions): Promise<string> {
  if (options.workspace !== undefined) {
    const explicit = path.resolve(options.cwd, options.workspace, WORKSPACE_CONFIG_FILENAME);
    if (!(await pathExists(explicit))) {
      throw new GrindError(
        'WORKSPACE_NOT_FOUND',
        `No ${WORKSPACE_CONFIG_FILENAME} in ${path.dirname(explicit)}`,
        { workspace: options.workspace },
      );
    }
    return explicit;
  }
  const found = await findWorkspaceConfig(options.cwd);
  if (found === null) {
    throw new GrindError(
      'WORKSPACE_NOT_FOUND',
      `No ${WORKSPACE_CONFIG_FILENAME} found at or above ${options.cwd}; pass --workspace <directory>`,
      { cwd: options.cwd },
    );
  }
  return found;
}

async function readStateRepositorySetting(configPath: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new GrindError(
      'WORKSPACE_CONFIG_INVALID',
      `${configPath} is not valid JSON: ${(error as Error).message}`,
      { configPath },
    );
  }
  if (!isRecord(parsed)) {
    throw new GrindError('WORKSPACE_CONFIG_INVALID', `${configPath} must contain a JSON object`, {
      configPath,
    });
  }
  const stateRepository = parsed['stateRepository'];
  if (typeof stateRepository !== 'string' || stateRepository.trim() === '') {
    throw new GrindError(
      'WORKSPACE_CONFIG_INVALID',
      `${configPath} requires a nonempty "stateRepository" string`,
      { configPath },
    );
  }
  return stateRepository;
}

/**
 * Configuration file of a nested workspace between `root` (exclusive) and
 * `target` (inclusive), or null when `target` belongs to `root` directly.
 */
export async function findNestedWorkspaceConfig(
  root: string,
  target: string,
): Promise<string | null> {
  for (const dir of pathsBelow(root, target)) {
    const candidate = path.join(dir, WORKSPACE_CONFIG_FILENAME);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}
