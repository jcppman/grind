import type { Workspace } from './workspace.ts';
import { switchCommand } from './worktree.ts';
export declare function directoryCommand(directory: string, platform?: NodeJS.Platform): string;
export declare function dashboardData(workspace: Workspace): Promise<{
    workspace: string;
    refreshedAt: string;
    initiatives: ({
        id: string;
        directory: string;
        command: string;
        archived: boolean;
        roadmap: {
            id: string;
            path: string;
        } | null;
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
            location: import("./checkouts.ts").CheckoutKind | null;
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
        roadmap: null;
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
type Switcher = typeof switchCommand;
export declare function serveDashboard(workspace: Workspace, launch?: OpenEditor, switcher?: Switcher): Promise<{
    url: string;
    close: () => Promise<void>;
}>;
export {};
