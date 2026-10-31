export interface Fakes {
    root: string;
    claude: string;
    codex: string;
    cmux: string;
    plan: string;
    log: string;
    cmuxLog: string;
    env: NodeJS.ProcessEnv;
    setPlan(plan: {
        participants?: Record<string, Record<string, string>>;
        content?: string;
    }): Promise<void>;
    invocations(): Promise<Array<Record<string, unknown>>>;
    cmuxCalls(): Promise<Array<{
        args: string[];
        surface: string | null;
    }>>;
    cleanup(): Promise<void>;
}
export declare function makeFakes(options?: {
    cmuxMode?: 'ok' | 'denied';
}): Promise<Fakes>;
/** Writes a personal discussions configuration that pins both engines to the fakes. */
export declare function writePersonalConfig(fakes: Fakes, config: Record<string, unknown>): Promise<void>;
