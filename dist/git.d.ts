interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}
export declare function git(args: readonly string[], cwd: string): Promise<GitResult>;
/** Real path of the repository containing `dir`, or null when it is not inside one. */
export declare function gitToplevel(dir: string): Promise<string | null>;
/** Current branch name, or null when HEAD is detached. */
export declare function gitCurrentBranch(dir: string): Promise<string | null>;
/** Real Git common directory shared by a repository and all of its worktrees. */
export declare function gitCommonDir(dir: string): Promise<string | null>;
/** Porcelain status lines of the working tree, or null when `dir` is not a repository. */
export declare function gitChangedFiles(dir: string): Promise<string[] | null>;
/** Content of `path` at `commit`, or null when either is unavailable. */
export declare function gitShowFile(repoRoot: string, commit: string, path: string): Promise<string | null>;
export {};
