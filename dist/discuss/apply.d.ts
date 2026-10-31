import { type Candidate } from './protocol.ts';
export interface AuthorizedTarget {
    /** Canonical absolute path; the only spelling a candidate may use. */
    path: string;
    requested: string;
    beforeSha256: string;
}
/**
 * Canonicalizes each requested target. A target must be an existing regular
 * file reached without a final symbolic link, and each may appear only once.
 */
export declare function resolveTargets(cwd: string, requested: readonly string[]): Promise<AuthorizedTarget[]>;
export type ApplicationStatus = 'not_requested' | 'applying' | 'applied' | 'write_conflict';
export interface ApplicationJournal {
    status: ApplicationStatus;
    revision: number;
    candidateHash: string;
    files: Array<{
        path: string;
        before: string;
        after: string;
        state: 'pending' | 'applied';
    }>;
    conflicts: Array<{
        path: string;
        expected: string;
        actual: string | null;
    }>;
    updatedAt: string;
}
export interface ApplyHooks {
    /** Test seam called after each file is replaced and journaled. */
    afterFile?: (file: string) => Promise<void>;
}
/**
 * Applies the accepted candidate to its authorized targets, one atomic file
 * replacement at a time. Any file that matches neither its recorded original
 * nor the accepted bytes stops the application as a write conflict.
 */
export declare function applyCandidate(journalFile: string, targets: readonly AuthorizedTarget[], candidate: Candidate, hooks?: ApplyHooks): Promise<ApplicationJournal>;
