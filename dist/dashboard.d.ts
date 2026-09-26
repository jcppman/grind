import type { Workspace } from './workspace.ts';
export declare function directoryCommand(directory: string, platform?: NodeJS.Platform): string;
export declare function dashboardData(workspace: Workspace): Promise<{
    workspace: string;
    refreshedAt: string;
    initiatives: ({
        id: string;
        directory: string;
        command: string;
        archived: boolean;
        status: "closed" | "open" | null;
        task: string | null;
        next: string | null;
        result: string | null;
        diagnostics: import("./errors.ts").Diagnostic[];
        repositories: {
            name: string;
            directory: string;
            command: string | null;
            branch: string;
            actualBranch: string | null;
            onRecordedBranch: boolean;
            changes: number;
            available: boolean;
        }[];
    } | {
        id: string;
        directory: string;
        command: string;
        archived: boolean;
        status: null;
        task: null;
        next: null;
        result: null;
        repositories: never[];
        diagnostics: {
            severity: string;
            code: string;
            message: string;
        }[];
    })[];
    diagnostics: import("./errors.ts").Diagnostic[];
}>;
type Editor = 'vscode' | 'webstorm';
type OpenEditor = (editor: Editor, directory: string) => Promise<void>;
export declare function serveDashboard(workspace: Workspace, launch?: OpenEditor): Promise<{
    url: string;
    close: () => Promise<void>;
}>;
export {};
