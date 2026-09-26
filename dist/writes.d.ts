import type { CommandContext } from './commands.ts';
import { type Workspace } from './workspace.ts';
export declare function checkedGit(root: string, ...args: string[]): Promise<string>;
export declare function withStateLock<T>(workspace: Workspace, action: () => Promise<T>): Promise<T>;
export declare function rejectSymlinks(base: string, target: string): Promise<void>;
export declare function validateForWrite(workspace: Workspace, dir: string): Promise<void>;
export declare function createCommand(context: CommandContext, name: string, scope?: string): Promise<{
    id: string;
    dir: string;
    created: string[];
}>;
export declare function saveCommand(context: CommandContext, identifier: string | undefined, message: string): Promise<{
    id: string;
    saved: boolean;
    commit: null;
} | {
    id: string;
    saved: boolean;
    commit: string;
}>;
