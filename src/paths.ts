import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from './errors.ts';

/** Whether `relative` is a plain relative path that cannot leave its base lexically. */
export function isContainedRelativePath(relative: string): boolean {
  if (relative === '' || path.isAbsolute(relative) || path.posix.isAbsolute(relative)) {
    return false;
  }
  if (relative.includes('\0')) return false;
  const segments = relative.split(/[\\/]/);
  return segments.every((segment) => segment !== '..');
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Real path of the longest existing prefix of `target`, joined with the rest.
 * Lets containment checks see through symlinks even when the leaf is missing.
 */
async function realpathDeep(target: string): Promise<string> {
  let current = target;
  const missing: string[] = [];
  while (!(await pathExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) return target;
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(await realpath(current), ...missing);
}

/**
 * Absolute real path of `relative` under `base`. Rejects absolute paths, `..`
 * segments, and symlinks that resolve outside `base`.
 */
export async function resolveWithin(base: string, relative: string): Promise<string> {
  if (!isContainedRelativePath(relative)) {
    throw new GrindError('PATH_ESCAPE', `Path "${relative}" must stay within ${base}`, {
      base,
      path: relative,
    });
  }
  const realBase = await realpathDeep(base);
  const resolved = await realpathDeep(path.resolve(realBase, relative));
  if (!isInside(realBase, resolved)) {
    throw new GrindError('PATH_ESCAPE', `Path "${relative}" resolves outside ${base}`, {
      base,
      path: relative,
      resolved,
    });
  }
  return resolved;
}

/** `target` and its ancestors up to, but excluding, `root`. Empty when `target` is `root`. */
export function pathsBelow(root: string, target: string): string[] {
  const result: string[] = [];
  let current = target;
  while (current !== root) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

export function toPosix(relative: string): string {
  return relative.split(path.sep).join(path.posix.sep);
}

/** Canonical form of a workspace-relative repository path for comparisons. */
export function normalizeRepositoryPath(repositoryPath: string): string {
  return toPosix(repositoryPath).replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
}
