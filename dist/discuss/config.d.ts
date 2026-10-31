export declare const ENGINES: readonly ['claude', 'codex'];
export type Engine = (typeof ENGINES)[number];
export declare const PRESENTATIONS: readonly ['cmux', 'headless'];
export type Presentation = (typeof PRESENTATIONS)[number];
export declare const MAX_PARTICIPANTS = 8;
export interface Limits {
    maxRounds: number;
    maxConcurrent: number;
    turnTimeoutSeconds: number;
    totalTimeoutSeconds: number;
}
export interface Defaults extends Limits {
    preset: string | null;
    presentation: Presentation;
}
export interface Role {
    instructions: string;
}
export interface Participant {
    id: string;
    engine: Engine;
    model: string;
    role: string;
}
export interface Preset {
    participants: Participant[];
    writer: string;
}
export interface EngineSettings {
    executable: string;
}
export interface DiscussionsConfig {
    defaults: Partial<Defaults>;
    roles: Record<string, Role>;
    presets: Record<string, Preset>;
    engines: Partial<Record<Engine, EngineSettings>>;
}
export interface ConfigSource {
    kind: 'personal' | 'workspace';
    path: string;
    present: boolean;
}
export interface LayeredConfig {
    sources: ConfigSource[];
    merged: DiscussionsConfig;
    /** Where each role and preset entry was last defined. */
    origins: {
        roles: Record<string, string>;
        presets: Record<string, string>;
    };
}
export interface Overrides extends Partial<Defaults> {
    preset?: string;
}
export interface EffectiveConfig {
    preset: string;
    participants: Array<Participant & {
        instructions: string;
    }>;
    writer: string;
    presentation: Presentation;
    limits: Limits;
    engines: Partial<Record<Engine, EngineSettings>>;
    sources: ConfigSource[];
}
export declare const BUILT_IN: DiscussionsConfig;
export declare function personalConfigPath(env?: NodeJS.ProcessEnv): string;
/** Parses one configuration layer; `engines` is accepted only from personal configuration. */
export declare function parseLayer(value: unknown, where: string, kind: ConfigSource['kind']): DiscussionsConfig;
/** Applies layers in increasing precedence: named entries replace whole entries, defaults merge by field. */
export declare function mergeLayers(layers: ReadonlyArray<{
    config: DiscussionsConfig;
    where: string;
}>): LayeredConfig['merged'] & {
    origins: LayeredConfig['origins'];
};
/** Reads personal configuration and the `discussions` section of the workspace configuration. */
export declare function loadLayeredConfig(options: {
    workspaceConfigPath: string | null;
    env?: NodeJS.ProcessEnv;
}): Promise<LayeredConfig>;
/** Selects a preset and resolves defaults and overrides into a validated effective configuration. */
export declare function resolveEffective(layered: LayeredConfig, overrides?: Overrides): EffectiveConfig;
