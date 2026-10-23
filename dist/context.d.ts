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
    };
    state: import("./ledger.ts").LedgerState | null;
    complete: boolean;
    roadmap: {
        id: string;
        path: string;
    } | null;
    roadmaps: import("./roadmaps.ts").RoadmapDocument[];
    intent: ContextSource | null;
    constraints: ContextSource[];
    ledger: ContextSource | null;
    repositories: {
        recorded: import("./ledger.ts").RepositoryEntry;
        observed: import("./inspect.ts").ObservedCheckout;
        head: string | null;
    }[];
    notes: import("./notes.ts").ReviewNote[];
    invokingCheckout: {
        path: string;
        repository: string;
        kind: import("./checkouts.ts").CheckoutKind;
        branch: string | null;
        head: string | null;
        owners: string[];
    } | null;
    pendingOperations: import("./operations.ts").PendingOperationSummary[];
    diagnostics: Diagnostic[];
    navigation: ContextLink[];
    entryRules: string[];
}>;
export type ContextResult = Awaited<ReturnType<typeof contextCommand>>;
export declare function formatContext(result: ContextResult): string;
