#!/usr/bin/env node
import { createCommand, saveCommand } from './writes.ts';
import { listCommand, startCommand, statusCommand } from './commands.ts';
import { GrindError, type ErrorCode } from './errors.ts';
import { formatList, formatStart, formatStatus } from './format.ts';
import { loadWorkspace } from './workspace.ts';

const DEFERRED_COMMANDS: Record<string, string> = {
  init: 'a later milestone',
  close: 'milestone 2',
  doctor: 'a later milestone',
  dashboard: 'a later milestone',
};

const USAGE = `Usage: grind <command> [options]

Commands:
  create <name>       create an initiative
  start [initiative]  make an existing initiative active
  save [initiative]   validate and persist its prepared checkpoint
  close [initiative]  mark it delivered or abandoned
  list                list initiatives and their recorded state
  status [initiative] inspect initiative artifacts and recorded/observed state

Options:
  --workspace <dir>   directory containing grind-workspace.json
  --scope <folder>    workspace-relative scope for create
  --message <text>    checkpoint commit message for save
  --json              emit one JSON envelope on stdout
  --help              show this help

This build inspects initiatives (list, status) and enters an open initiative
whose checkouts already sit on their recorded branches (start). It never
switches branches, reopens closed work, or rewrites sidecars during start. Create
writes templates; save commits a prepared checkpoint.`;

export interface ParsedArgs {
  command: string | null;
  positional: string[];
  json: boolean;
  help: boolean;
  workspace?: string;
  scope?: string;
  message?: string;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: null, positional: [], json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--workspace') {
      const value = argv[i + 1];
      if (value === undefined) throw new GrindError('USAGE', '--workspace requires a directory');
      parsed.workspace = value;
      i += 1;
    } else if (['--scope', '--message'].includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new GrindError('USAGE', `${arg} requires a value`);
      parsed[arg.slice(2) as 'scope' | 'message'] = value;
    } else if (arg.startsWith('--workspace=')) parsed.workspace = arg.slice('--workspace='.length);
    else if (arg.startsWith('-')) throw new GrindError('USAGE', `Unknown option ${arg}`);
    else if (parsed.command === null) parsed.command = arg;
    else parsed.positional.push(arg);
  }
  return parsed;
}

export async function run(argv: readonly string[]): Promise<number> {
  let json = argv.includes('--json');
  try {
    const args = parseArgs(argv);
    json = args.json;
    if (args.help || args.command === null) {
      emit(json, { ok: true, data: { usage: USAGE } }, USAGE);
      return 0;
    }
    const increment = DEFERRED_COMMANDS[args.command];
    if (increment !== undefined) {
      throw new GrindError(
        'UNSUPPORTED_OPERATION',
        `"grind ${args.command}" is not implemented yet; it is delivered in ${increment}`,
        { command: args.command, increment },
      );
    }
    if (!['list', 'status', 'start', 'create', 'save'].includes(args.command)) {
      throw new GrindError('USAGE', `Unknown command "${args.command}"`);
    }
    if (args.positional.length > (args.command === 'list' ? 0 : 1)) {
      throw new GrindError('USAGE', `Too many arguments for "grind ${args.command}"`);
    }
    for (const [option, command] of [['scope', 'create'], ['message', 'save']] as const) {
      if (args[option] !== undefined && args.command !== command) throw new GrindError('USAGE', `--${option} is only supported by ${command}`);
    }
    if (args.command === 'create' && args.positional.length !== 1) throw new GrindError('USAGE', 'create requires an argument');
    if (args.command === 'save' && !args.message?.trim()) throw new GrindError('USAGE', 'save requires --message');
    const cwd = process.cwd();
    const workspace = await loadWorkspace({ cwd, ...(args.workspace === undefined ? {} : { workspace: args.workspace }) });
    const context = { workspace, cwd };
    const identifier = args.positional[0];
    if (args.command === 'create') {
      const result = await createCommand(context, identifier!, args.scope);
      emit(json, { ok: true, data: result }, `Created ${result.id} at ${result.dir}`);
    } else if (args.command === 'save') {
      const result = await saveCommand(context, identifier, args.message!);
      emit(json, { ok: true, data: result }, result.saved ? `Saved ${result.id}: ${result.commit}` : `${result.id}: nothing to save`);
    } else if (args.command === 'list') {
      const result = await listCommand(context);
      emit(json, { ok: true, data: result }, formatList(result));
    } else if (args.command === 'status') {
      const result = await statusCommand(context, identifier);
      emit(json, { ok: true, data: result }, formatStatus(result));
    } else {
      const result = await startCommand(context, identifier);
      emit(json, { ok: true, data: result }, formatStart(result));
    }
    return 0;
  } catch (error) {
    const failure =
      error instanceof GrindError
        ? error
        : new GrindError('GIT_ERROR' as ErrorCode, (error as Error).message);
    emit(json, { ok: false, error: failure.toJSON() }, null);
    process.stderr.write(`grind: ${failure.message}\n`);
    return failure.code === 'USAGE' ? 2 : 1;
  }
}

function emit(json: boolean, envelope: unknown, human: string | null): void {
  if (json) process.stdout.write(`${JSON.stringify(envelope)}\n`);
  else if (human !== null) process.stdout.write(`${human}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/cli.ts') || process.argv[1].endsWith('/cli.js') || process.argv[1].endsWith('/grind'));
if (invokedDirectly) {
  process.exitCode = await run(process.argv.slice(2));
}
