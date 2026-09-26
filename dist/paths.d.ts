/** Whether `relative` is a plain relative path that cannot leave its base lexically. */
export declare function isContainedRelativePath(relative: string): boolean;
export declare function pathExists(target: string): Promise<boolean>;
export declare function isDirectory(target: string): Promise<boolean>;
/**
 * Absolute real path of `relative` under `base`. Rejects absolute paths, `..`
 * segments, and symlinks that resolve outside `base`.
 */
export declare function resolveWithin(base: string, relative: string): Promise<string>;
/** `target` and its ancestors up to, but excluding, `root`. Empty when `target` is `root`. */
export declare function pathsBelow(root: string, target: string): string[];
export declare function toPosix(relative: string): string;
/** Canonical form of a workspace-relative repository path for comparisons. */
export declare function normalizeRepositoryPath(repositoryPath: string): string;
