import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export async function git(args: readonly string[], cwd: string): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Real path of the repository containing `dir`, or null when it is not inside one. */
export async function gitToplevel(dir: string): Promise<string | null> {
  const result = await git(['rev-parse', '--show-toplevel'], dir);
  if (!result.ok) return null;
  const top = result.stdout.trim();
  return top === '' ? null : realpath(top);
}

/** Current branch name, or null when HEAD is detached. */
export async function gitCurrentBranch(dir: string): Promise<string | null> {
  const result = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], dir);
  if (!result.ok) return null;
  const branch = result.stdout.trim();
  return branch === '' ? null : branch;
}

/** Porcelain status lines of the working tree, or null when `dir` is not a repository. */
export async function gitChangedFiles(dir: string): Promise<string[] | null> {
  const result = await git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], dir);
  if (!result.ok) return null;
  return result.stdout.split('\n').filter((line) => line !== '');
}

/** Content of `path` at `commit`, or null when either is unavailable. */
export async function gitShowFile(
  repoRoot: string,
  commit: string,
  path: string,
): Promise<string | null> {
  const result = await git(['show', `${commit}:${path}`], repoRoot);
  return result.ok ? result.stdout : null;
}
