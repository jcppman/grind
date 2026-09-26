import type { CommandContext } from './commands.ts';
import { type ContextLink } from './context-markdown.ts';
import { type Diagnostic } from './errors.ts';
export declare const ENTRY_RULES: string[];
export interface ContextSource {
    path: string;
    fragment: string | null;
    body: string;
    metadata: Record<string, unknown> | null;
}
export declare function contextCommand(context: CommandContext, identifier?: string): Promise<{
    schemaVersion: number;
    generatedAt: string;
    workspace: string;
    id: string;
    dir: string;
    archived: boolean;
    resolution: {
        source: import("./resolve.ts").ResolutionSource;
        stalePointer: {
            pointed: string;
            reason: string;
        } | null;
    };
    state: import("./ledger.ts").LedgerState | null;
    complete: boolean;
    intent: ContextSource | null;
    constraints: ContextSource[];
    ledger: ContextSource | null;
    repositories: {
        recorded: import("./ledger.ts").RepositoryEntry;
        observed: import("./inspect.ts").ObservedCheckout;
        onRecordedBranch: boolean;
        details: {
            path: string;
            branch: string | null;
            head: string | null;
            association: string | null;
            sidecarPath: string | null;
            notes: {
                reference: string;
                path: string;
                start: number;
                end: number;
                anchor: string | null;
            }[];
            diagnostics: Diagnostic[];
        } | null;
    }[];
    invokingCheckout: {
        path: string;
        branch: string | null;
        head: string | null;
        association: string | null;
        sidecarPath: string | null;
        notes: {
            reference: string;
            path: string;
            start: number;
            end: number;
            anchor: string | null;
        }[];
        diagnostics: Diagnostic[];
    } | null;
    pendingOperations: import("./operations.ts").PendingOperationSummary[];
    diagnostics: Diagnostic[];
    navigation: ContextLink[];
    entryRules: string[];
}>;
export type ContextResult = Awaited<ReturnType<typeof contextCommand>>;
export declare function formatContext(result: ContextResult): string;
