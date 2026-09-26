export declare const WORKSPACE_CONFIG_FILENAME = "grind-workspace.json";
export declare const INITIATIVES_FOLDER = "initiatives";
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
export declare function findWorkspaceConfig(startDir: string): Promise<string | null>;
export declare function loadWorkspace(options: LoadWorkspaceOptions): Promise<Workspace>;
export declare function readWorkspaceSettings(configPath: string): Promise<{
    stateRepository: string;
    contextOnSessionStart: boolean;
}>;
/**
 * Configuration file of a nested workspace between `root` (exclusive) and
 * `target` (inclusive), or null when `target` belongs to `root` directly.
 */
export declare function findNestedWorkspaceConfig(root: string, target: string): Promise<string | null>;
