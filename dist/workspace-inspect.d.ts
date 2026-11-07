import { type CommandContext, type ListOptions } from './commands.ts';
type RemoteReader = (url: string) => Promise<unknown>;
export declare function githubReader(): Promise<RemoteReader>;
export declare function inspectWorkspace(context: CommandContext, options?: ListOptions & {
    remote?: boolean;
}, remoteFactory?: typeof githubReader): Promise<{
    schemaVersion: number;
    generatedAt: string;
    workspace: string;
    initiatives: ({
        error?: never;
        id: string;
        state: import("./ledger.ts").LedgerState | null;
        complete: boolean;
        roadmap: {
            id: string;
            path: string;
        } | null;
        repositories: {
            recorded: import("./ledger.ts").RepositoryEntry;
            observed: import("./inspect.ts").ObservedCheckout;
            head: string | null;
        }[];
        notes: number;
        pendingOperations: import("./operations.ts").PendingOperationSummary[];
        diagnostics: import("./errors.ts").Diagnostic[];
        linkDiagnostics: {
            path: string;
            error: string;
        }[];
        pullRequests: ({
            url: string;
            status: string;
            observedAt?: never;
            data?: never;
            error?: never;
        } | {
            url: string;
            status: string;
            observedAt: string;
            data: unknown;
            error?: never;
        } | {
            observedAt?: never;
            data?: never;
            url: string;
            status: string;
            error: string;
        })[];
    } | {
        state?: never;
        roadmap?: never;
        repositories?: never;
        notes?: never;
        pendingOperations?: never;
        diagnostics?: never;
        linkDiagnostics?: never;
        pullRequests?: never;
        id: string;
        complete: boolean;
        error: string;
    })[];
    diagnostics: import("./errors.ts").Diagnostic[];
    pendingOperations: import("./operations.ts").PendingOperationSummary[];
    remoteError: string | null;
    limitations: string[];
}>;
export {};
