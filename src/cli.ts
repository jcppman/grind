#!/usr/bin/env node
import { contextCommand, formatContext } from './context.ts';
import { createCommand, saveCommand } from './writes.ts';
import { listCommand, startCommand, statusCommand } from './commands.ts';
import { archiveCommand, closeCommand } from './lifecycle-commands.ts';
import { GrindError, type ErrorCode } from './errors.ts';
import { formatList, formatStart, formatStatus } from './format.ts';
import { serveDashboard } from './dashboard.ts';
import { loadWorkspace } from './workspace.ts';

const DEFERRED_COMMANDS: Record<string, string> = {
  init: 'a later milestone',
  doctor: 'a later milestone',
};

const USAGE = `Usage: grind <command> [options]

Commands:
  create <name>       create an initiative
  start [initiative]  make an existing initiative active
  save [initiative]   validate and persist its prepared checkpoint
  close [initiative]  mark it delivered or abandoned
  archive [initiative] move eligible closed work to read-only history
  dashboard           serve the local initiative dashboard
  list [scope]        list initiatives and their recorded state
  context [initiative] load complete read-only initiative context
  status [initiative] inspect initiative artifacts and recorded/observed state

Options:
  --workspace <dir>   directory containing grind-workspace.json
  --scope <folder>    workspace-relative scope for create
  --open              list only open initiatives
  --closed            list only closed initiatives
  --message <text>    checkpoint commit message for save
  --outcome <value>   delivered or abandoned for close
  --result <text>     result location or summary for close
  --notes <value>     handled or parked for close
  --date <YYYY-MM-DD> closure date override
  --json              emit one JSON envelope on stdout
  --help              show this help

Start preflights and switches tracked clean checkouts, transfers review notes,
and reopens closed work. Close persists an outcome and archive moves eligible
history after its retention period. Create writes templates; save commits a
prepared checkpoint.`;

export interface ParsedArgs {
  command: string | null;
  positional: string[];
  json: boolean;
  help: boolean;
  open: boolean;
  closed: boolean;
  workspace?: string;
  scope?: string;
  message?: string;
  outcome?: string;
  result?: string;
  notes?: string;
  date?: string;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: null, positional: [], json: false, help: false, open: false, closed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--open') parsed.open = true;
    else if (arg === '--closed') parsed.closed = true;
    else if (arg === '--workspace') {
      const value = argv[i + 1];
      if (value === undefined) throw new GrindError('USAGE', '--workspace requires a directory');
      parsed.workspace = value;
      i += 1;
    } else if (['--scope', '--message', '--outcome', '--result', '--notes', '--date'].includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new GrindError('USAGE', `${arg} requires a value`);
      parsed[arg.slice(2) as 'scope' | 'message' | 'outcome' | 'result' | 'notes' | 'date'] = value;
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
    if (!['list', 'status', 'context', 'start', 'create', 'save', 'close', 'archive', 'dashboard'].includes(args.command)) {
      throw new GrindError('USAGE', `Unknown command "${args.command}"`);
    }
    if (args.positional.length > (args.command === 'dashboard' ? 0 : 1)) {
      throw new GrindError('USAGE', `Too many arguments for "grind ${args.command}"`);
    }
    for (const [option, command] of [['scope', 'create'], ['message', 'save'], ['outcome', 'close'], ['result', 'close'], ['notes', 'close'], ['date', 'close']] as const) {
      if (args[option] !== undefined && args.command !== command) throw new GrindError('USAGE', `--${option} is only supported by ${command}`);
    }
    if ((args.open || args.closed) && args.command !== 'list') throw new GrindError('USAGE', '--open and --closed are only supported by list');
    if (args.open && args.closed) throw new GrindError('USAGE', '--open and --closed cannot be combined');
    if (args.command === 'create' && args.positional.length !== 1) throw new GrindError('USAGE', 'create requires an argument');
    if (args.command === 'save' && !args.message?.trim()) throw new GrindError('USAGE', 'save requires --message');
    if (args.command === 'close') {
      if (!['delivered', 'abandoned'].includes(args.outcome ?? '')) throw new GrindError('USAGE', 'close requires --outcome delivered|abandoned');
      if (!args.result?.trim()) throw new GrindError('USAGE', 'close requires --result');
      if (!['handled', 'parked'].includes(args.notes ?? '')) throw new GrindError('USAGE', 'close requires --notes handled|parked');
    }
    const cwd = process.cwd();
    const workspace = await loadWorkspace({ cwd, ...(args.workspace === undefined ? {} : { workspace: args.workspace }) });
    const context = { workspace, cwd };
    const identifier = args.positional[0];
    if (args.command === 'dashboard') {
      const dashboard = await serveDashboard(workspace);
      const stop = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        void dashboard.close();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      emit(json, { ok: true, data: { url: dashboard.url } }, `Dashboard: ${dashboard.url}\nPress Ctrl-C to stop.`);
    } else if (args.command === 'create') {
      const result = await createCommand(context, identifier!, args.scope);
      emit(json, { ok: true, data: result }, `Created ${result.id} at ${result.dir}`);
    } else if (args.command === 'save') {
      const result = await saveCommand(context, identifier, args.message!);
      emit(json, { ok: true, data: result }, result.saved ? `Saved ${result.id}: ${result.commit}` : `${result.id}: nothing to save`);
    } else if (args.command === 'close') {
      const result = await closeCommand(context, identifier, { outcome: args.outcome as 'delivered' | 'abandoned', result: args.result!, notes: args.notes as 'handled' | 'parked', ...(args.date === undefined ? {} : { date: args.date }) });
      emit(json, { ok: true, data: result }, `Closed ${result.id}: ${result.commit ?? 'already committed'}`);
    } else if (args.command === 'archive') {
      const result = await archiveCommand(context, identifier);
      emit(json, { ok: true, data: result }, `Archived ${result.id} as ${result.archivedId}`);
    } else if (args.command === 'list') {
      const result = await listCommand(context, {
        ...(identifier === undefined ? {} : { scope: identifier }),
        ...(args.open ? { status: 'open' as const } : args.closed ? { status: 'closed' as const } : {}),
      });
      emit(json, { ok: true, data: result }, formatList(result));
    } else if (args.command === 'context') {
      const result = await contextCommand(context, identifier);
      emit(json, { ok: true, data: result }, formatContext(result));
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
