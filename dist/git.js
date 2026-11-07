import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export async function git(args, cwd) {
    try {
        const { stdout, stderr } = await execFileAsync('git', [...args], {
            cwd,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
        });
        return { ok: true, stdout, stderr };
    }
    catch (error) {
        const failure = error;
        return { ok: false, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
}
/** Real path of the repository containing `dir`, or null when it is not inside one. */
export async function gitToplevel(dir) {
    const result = await git(['rev-parse', '--show-toplevel'], dir);
    if (!result.ok)
        return null;
    const top = result.stdout.trim();
    return top === '' ? null : realpath(top);
}
/** Current branch name, or null when HEAD is detached. */
export async function gitCurrentBranch(dir) {
    const result = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], dir);
    if (!result.ok)
        return null;
    const branch = result.stdout.trim();
    return branch === '' ? null : branch;
}
/** Real Git common directory shared by a repository and all of its worktrees. */
export async function gitCommonDir(dir) {
    const result = await git(['rev-parse', '--git-common-dir'], dir);
    if (!result.ok)
        return null;
    const common = result.stdout.trim();
    if (common === '')
        return null;
    return realpath(path.resolve(dir, common));
}
/** Porcelain status lines of the working tree, or null when `dir` is not a repository. */
export async function gitChangedFiles(dir) {
    const result = await git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], dir);
    if (!result.ok)
        return null;
    return result.stdout.split('\n').filter((line) => line !== '');
}
/** Content of `path` at `commit`, or null when either is unavailable. */
export async function gitShowFile(repoRoot, commit, path) {
    const result = await git(['show', `${commit}:${path}`], repoRoot);
    return result.ok ? result.stdout : null;
}
//# sourceMappingURL=git.js.map