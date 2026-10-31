/** The cmux operations a discussion needs; injected so tests never touch a real terminal. */
export interface CmuxAdapter {
    available(): Promise<{
        ok: true;
    } | {
        ok: false;
        reason: string;
    }>;
    openWorkspace(options: {
        name: string;
        description: string;
        cwd: string;
        command: string;
    }): Promise<{
        workspace: string;
        surface: string | null;
    }>;
    addPane(options: {
        workspace: string;
        cwd: string;
        command: string;
    }): Promise<{
        surface: string | null;
    }>;
    renameOwnTab(title: string): Promise<void>;
    closeWorkspace(workspace: string): Promise<void>;
}
/**
 * Closes the workspace of a final discussion. Only a UUID is closed, because
 * cmux can reassign a short ref such as `workspace:3` to another workspace.
 */
export declare function closeDiscussionWorkspace(cmux: CmuxAdapter | null, presentation: {
    kind: string | null;
    workspace: string | null;
}): Promise<boolean>;
export declare function systemCmux(bin: string, env?: NodeJS.ProcessEnv): CmuxAdapter;
