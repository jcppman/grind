export declare function discussionsRoot(env?: NodeJS.ProcessEnv): string;
export declare function newDiscussionId(now?: Date): string;
export declare function discussionDir(id: string, env?: NodeJS.ProcessEnv): string;
export declare function ensurePrivateDir(dir: string): Promise<void>;
export declare function readJson<T>(file: string): Promise<T | null>;
export declare function writeJsonAtomic(file: string, value: unknown): Promise<void>;
/** Creates `file` only if it does not exist; returns false when another process created it first. */
export declare function writeJsonExclusive(file: string, value: unknown): Promise<boolean>;
export declare function appendEvent(dir: string, event: Record<string, unknown>): Promise<void>;
export declare function readEvents(dir: string): Promise<Array<Record<string, unknown>>>;
/** Identity of a live process that survives PID reuse: the PID plus its kernel start time. */
export interface ProcessIdentity {
    pid: number;
    started: string;
}
export interface ProcessProbe {
    identify(pid: number): Promise<ProcessIdentity | null>;
}
export declare function createProcessProbe(readStartTime?: (pid: number) => Promise<string>): ProcessProbe;
export declare const systemProbe: ProcessProbe;
export declare function isSameProcess(identity: ProcessIdentity | null | undefined, probe?: ProcessProbe): Promise<boolean>;
/** Signals a process group only after confirming it is still the recorded process. */
export declare function terminateOwned(identity: ProcessIdentity | null | undefined, signal?: NodeJS.Signals, probe?: ProcessProbe): Promise<boolean>;
/** Short mutual exclusion around a read-modify-write; never held across a model turn. */
export declare function withLock<T>(dir: string, name: string, action: () => Promise<T>, probe?: ProcessProbe): Promise<T>;
export declare function listDiscussionIds(env?: NodeJS.ProcessEnv): Promise<string[]>;
