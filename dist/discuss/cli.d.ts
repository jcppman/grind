import { type ServiceEnv } from './service.ts';
export declare const DISCUSS_USAGE = "Usage: grind discuss <action> [options] --json\n\nBounded discussions between configured Codex and Claude CLI participants (macOS).\nRuntime state is private to this machine under $XDG_STATE_HOME/grind/discussions.\n\n  start --brief-file <file> [--preset <name>] [--init <id> | --no-init]\n        [--update-plan <file>]... [--presentation cmux|headless] [--max-rounds <n>]\n                                     start a detached discussion and print its ID\n  status <id>                        progress, phase and what to do next (read-only)\n  wait <id> [--timeout <seconds>]    wait until it finishes or needs you, at most --timeout\n                                     (default 600); read-only, and stopping\n                                     the wait never stops the discussion\n  result <id>                        outcome, proposal, decisions and application (read-only)\n  input <id> --brief-file <file>     add user input; a finished discussion starts a linked one\n  resume <id> [--presentation headless|cmux] [--resubmit-uncertain]\n                                     continue an interrupted, recoverable or undecided run\n  stop <id>                          cancel; stops only this discussion's workers\n  list                               discussions on this machine\n  presets                            effective presets, roles and their sources\n  config validate                    validate personal and workspace configuration\n\n--update-plan authorizes Grind to replace only the named files, and only after\nevery participant accepted the same candidate and each file still matches its\nstarting content. It does not authorize implementation, commits or publication.";
declare const VALUE_OPTIONS: readonly ['--brief-file', '--preset', '--init', '--update-plan', '--presentation', '--max-rounds', '--workspace', '--dir', '--generation', '--participant', '--token', '--timeout'];
type ValueOption = (typeof VALUE_OPTIONS)[number];
export interface DiscussArgs {
    action: string | null;
    positional: string[];
    values: Partial<Record<Exclude<ValueOption, '--update-plan'>, string>>;
    updatePlan: string[];
    flags: Set<string>;
}
export declare function parseDiscussArgs(argv: readonly string[]): DiscussArgs;
export declare function runDiscuss(argv: readonly string[], service: ServiceEnv): Promise<unknown>;
/** Mutating Grind commands refuse to run inside a discussion participant; read-only inspection stays available. */
export declare function assertParticipantMayRun(argv: readonly string[], marker: string | null): void;
export {};
