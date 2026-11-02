import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GrindError } from '../errors.ts';
import { PRESENTATIONS, type Presentation } from './config.ts';
import { runWorker } from './worker.ts';
import { systemCmux } from './cmux.ts';
import {
  addInput, discussionResult, discussionStatus, listDiscussions, listPresets, resumeDiscussion, runnerMain, startDiscussion, stopDiscussion, validateConfig, waitDiscussion,
  type ServiceEnv,
} from './service.ts';

const DEFAULT_WAIT_SECONDS = 600;
const MAX_WAIT_SECONDS = 86_400;

export const DISCUSS_USAGE = `Usage: grind discuss <action> [options] --json

Bounded discussions between configured Codex and Claude CLI participants (macOS).
Runtime state is private to this machine under $XDG_STATE_HOME/grind/discussions.

  start --brief-file <file> [--preset <name>] [--init <id> | --no-init]
        [--update-plan <file>]... [--presentation cmux|headless] [--max-rounds <n>]
                                     start a detached discussion and print its ID
  status <id>                        progress, phase and what to do next (read-only)
  wait <id> [--timeout <seconds>]    wait until it finishes or needs you, at most --timeout
                                     (default ${DEFAULT_WAIT_SECONDS}); read-only, and stopping
                                     the wait never stops the discussion
  result <id>                        outcome, proposal, decisions and application (read-only)
  input <id> --brief-file <file>     add user input; a finished discussion starts a linked one
  resume <id> [--presentation headless|cmux] [--resubmit-uncertain]
                                     continue an interrupted, recoverable or undecided run
  stop <id>                          cancel; stops only this discussion's workers
  list                               discussions on this machine
  presets                            effective presets, roles and their sources
  config validate                    validate personal and workspace configuration

--update-plan authorizes Grind to replace only the named files, and only after
every participant accepted the same candidate and each file still matches its
starting content. It does not authorize implementation, commits or publication.`;

const VALUE_OPTIONS = ['--brief-file', '--preset', '--init', '--update-plan', '--presentation', '--max-rounds', '--workspace', '--dir', '--generation', '--participant', '--token', '--timeout'] as const;
const FLAGS = ['--json', '--no-init', '--resubmit-uncertain', '--help', '-h'] as const;
type ValueOption = (typeof VALUE_OPTIONS)[number];

export interface DiscussArgs {
  action: string | null;
  positional: string[];
  values: Partial<Record<Exclude<ValueOption, '--update-plan'>, string>>;
  updatePlan: string[];
  flags: Set<string>;
}

export function parseDiscussArgs(argv: readonly string[]): DiscussArgs {
  const args: DiscussArgs = { action: null, positional: [], values: {}, updatePlan: [], flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if ((VALUE_OPTIONS as readonly string[]).includes(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new GrindError('USAGE', `${arg} requires a value`);
      if (arg === '--update-plan') args.updatePlan.push(value);
      else if (args.values[arg as Exclude<ValueOption, '--update-plan'>] !== undefined) throw new GrindError('USAGE', `${arg} may be given only once`);
      else args.values[arg as Exclude<ValueOption, '--update-plan'>] = value;
    } else if ((FLAGS as readonly string[]).includes(arg)) args.flags.add(arg);
    else if (arg.startsWith('-')) throw new GrindError('USAGE', `Unknown option ${arg}`);
    else if (args.action === null) args.action = arg;
    else args.positional.push(arg);
  }
  return args;
}

function only(args: DiscussArgs, allowed: readonly string[]): void {
  const used = [...Object.keys(args.values), ...(args.updatePlan.length > 0 ? ['--update-plan'] : []), ...[...args.flags].filter((flag) => flag !== '--json')];
  const extra = used.filter((option) => !allowed.includes(option));
  if (extra.length > 0) throw new GrindError('USAGE', `${extra.join(', ')} not supported by discuss ${args.action}`);
}

function id(args: DiscussArgs): string {
  if (args.positional.length !== 1) throw new GrindError('USAGE', `discuss ${args.action} requires one discussion ID`);
  return args.positional[0]!;
}

function presentation(value: string | undefined): Presentation | undefined {
  if (value === undefined) return undefined;
  if (!(PRESENTATIONS as readonly string[]).includes(value)) throw new GrindError('USAGE', '--presentation must be cmux or headless');
  return value as Presentation;
}

function integer(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new GrindError('USAGE', `${option} must be a positive integer`);
  return Number(value);
}

export async function runDiscuss(argv: readonly string[], service: ServiceEnv): Promise<unknown> {
  const args = parseDiscussArgs(argv);
  if (args.flags.has('--help') || args.flags.has('-h') || args.action === null || args.action === 'help') return { usage: DISCUSS_USAGE };
  switch (args.action) {
    case 'start': {
      only(args, ['--brief-file', '--preset', '--init', '--no-init', '--update-plan', '--presentation', '--max-rounds', '--workspace']);
      if (args.positional.length > 0) throw new GrindError('USAGE', 'discuss start takes no positional arguments; put the brief in --brief-file');
      const maxRounds = integer(args.values['--max-rounds'], '--max-rounds');
      const chosen = presentation(args.values['--presentation']);
      return startDiscussion(service, {
        ...(args.values['--brief-file'] === undefined ? {} : { briefFile: args.values['--brief-file'] }),
        ...(args.values['--preset'] === undefined ? {} : { preset: args.values['--preset'] }),
        ...(args.values['--init'] === undefined ? {} : { init: args.values['--init'] }),
        ...(args.flags.has('--no-init') ? { noInit: true } : {}),
        targets: args.updatePlan,
        ...(chosen === undefined ? {} : { presentation: chosen }),
        ...(maxRounds === undefined ? {} : { maxRounds }),
        ...(args.values['--workspace'] === undefined ? {} : { workspace: args.values['--workspace'] }),
      });
    }
    case 'status':
      only(args, []);
      return discussionStatus(service, id(args));
    case 'wait': {
      only(args, ['--timeout']);
      const timeoutSeconds = integer(args.values['--timeout'], '--timeout') ?? DEFAULT_WAIT_SECONDS;
      if (timeoutSeconds > MAX_WAIT_SECONDS) throw new GrindError('USAGE', `--timeout must be at most ${MAX_WAIT_SECONDS}`);
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.once('SIGINT', abort);
      process.once('SIGTERM', abort);
      try {
        return await waitDiscussion(service, id(args), { timeoutSeconds, signal: controller.signal });
      } finally {
        process.off('SIGINT', abort);
        process.off('SIGTERM', abort);
      }
    }
    case 'result':
      only(args, []);
      return discussionResult(service, id(args));
    case 'input': {
      only(args, ['--brief-file']);
      const file = args.values['--brief-file'];
      if (file === undefined) throw new GrindError('USAGE', 'discuss input requires --brief-file');
      return addInput(service, id(args), await readFile(path.resolve(service.cwd, file), 'utf8'));
    }
    case 'resume': {
      only(args, ['--presentation', '--resubmit-uncertain']);
      const chosen = presentation(args.values['--presentation']);
      return resumeDiscussion(service, id(args), { ...(chosen === undefined ? {} : { presentation: chosen }), resubmitUncertain: args.flags.has('--resubmit-uncertain') });
    }
    case 'stop':
      only(args, []);
      return stopDiscussion(service, id(args));
    case 'list':
      only(args, []);
      return listDiscussions(service);
    case 'presets':
      only(args, ['--workspace']);
      return listPresets(service, args.values['--workspace']);
    case 'config':
      only(args, ['--workspace']);
      if (args.positional[0] !== 'validate' || args.positional.length !== 1) throw new GrindError('USAGE', 'Usage: grind discuss config validate');
      return validateConfig(service, args.values['--workspace']);
    case 'run': {
      only(args, ['--dir', '--generation']);
      const generation = integer(args.values['--generation'], '--generation');
      if (args.values['--dir'] === undefined || generation === undefined) throw new GrindError('USAGE', 'discuss run requires --dir and --generation');
      await runnerMain(args.values['--dir'], generation);
      return { ran: true };
    }
    case 'worker': {
      only(args, ['--dir', '--generation', '--participant', '--token']);
      const generation = integer(args.values['--generation'], '--generation');
      const { '--dir': dir, '--participant': participant, '--token': token } = args.values;
      if (dir === undefined || participant === undefined || token === undefined || generation === undefined) throw new GrindError('USAGE', 'discuss worker requires --dir, --participant, --generation and --token');
      await runWorker({ dir, participant, generation, token, cmux: process.env['CMUX_SURFACE_ID'] ? systemCmux(process.env['GRIND_CMUX'] ?? 'cmux') : null });
      return { worked: true };
    }
    default:
      throw new GrindError('USAGE', `Unknown discuss action "${args.action}"`);
  }
}

const PARTICIPANT_SAFE_DISCUSS = new Set(['status', 'wait', 'result', 'list', 'presets', 'config', 'help']);
const PARTICIPANT_SAFE_COMMANDS = new Set(['list', 'context', 'status', 'inspect', 'help']);

/** Mutating Grind commands refuse to run inside a discussion participant; read-only inspection stays available. */
export function assertParticipantMayRun(argv: readonly string[], marker: string | null): void {
  if (marker === null) return;
  const valueOptions = new Set<string>(['--workspace', '--scope', '--message', '--outcome', '--result', '--notes', '--date', '--repo', '--init', ...VALUE_OPTIONS]);
  const words: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (valueOptions.has(arg)) i += 1;
    else if (!arg.startsWith('-')) words.push(arg);
  }
  const command = words[0] ?? 'help';
  const allowed = command === 'discuss' ? PARTICIPANT_SAFE_DISCUSS.has(words[1] ?? 'help') : PARTICIPANT_SAFE_COMMANDS.has(command) || (command === 'note' && words[1] === 'list');
  if (!allowed) {
    throw new GrindError('PARTICIPANT_FORBIDDEN', `Discussion participants cannot run "grind ${words.slice(0, 2).join(' ')}"; propose changes through the discussion instead`, { participant: marker });
  }
}
