#!/usr/bin/env node
import { inspectWorkspace } from './workspace-inspect.js';
import { contextCommand, formatContext } from './context.js';
import { createCommand, saveCommand } from './writes.js';
import { listCommand, statusCommand } from './commands.js';
import { archiveCommand, closeCommand } from './lifecycle-commands.js';
import { GrindError } from './errors.js';
import { formatList, formatNotes, formatPrune, formatRemovedWorktrees, formatRepositoryInitiatives, formatStatus, formatSwitch, formatWorktree } from './format.js';
import { addNote, listNotes, resolveNote } from './notes.js';
import { pruneWorktreesCommand } from './worktree-cleanup.js';
import { repositoryStatus, switchCommand, worktreeCommand } from './worktree.js';
import { serveDashboard } from './dashboard.js';
import { loadWorkspace } from './workspace.js';
import { REVIEW_USAGE, runReview } from './review-cli.js';
import { assertParticipantMayRun, runDiscuss } from './discuss/cli.js';
import { participantGuard, systemServiceEnv } from './discuss/service.js';
const DEFERRED_COMMANDS = {
    init: 'a future release',
    doctor: 'a future release',
};
const USAGE = `Usage: grind <command> [options]

Commands:
  create <name>       create an initiative
  worktree <initiative> print where its work lives, creating a worktree if needed
  worktree prune      remove finished worktrees under <workspace>/.worktrees
  switch [initiative] bring it into this repository's canonical checkout;
                      without an argument, list the inits tracking the repository
  note add <file> <start> [end] <comment|->  record a review note
  note list [initiative]  list review notes
  note done <id>      resolve a review note
  save [initiative]   validate and persist its prepared checkpoint
  close [initiative]  mark it delivered or abandoned
  archive [initiative] move eligible closed work to read-only history
  dashboard           serve the local initiative dashboard
  list [scope]        list initiatives and their recorded state
  context [initiative] load complete read-only initiative context
  inspect [scope]    batch local initiative facts; --remote adds PR observations
  status [initiative] inspect an initiative; without one inside a repository,
                      show the owning init and where the repository's inits live
  review <action>     private batch review drafts; see grind review help
  discuss <action>    bounded multi-agent discussions; see grind discuss help

Options:
  --workspace <dir>   directory containing grind-workspace.json
  --scope <folder>    workspace-relative scope for create
  --repo <repository> repository for worktree when the init tracks several or none
  --init <initiative> initiative for note commands
  --force             switch even if the target worktree changed in the last few minutes
  --open              list only open initiatives
  --closed            list only closed initiatives
  --filter <text>     list only initiatives whose id, roadmap, phase, task,
                      next action, or result contains the text
  --message <text>    checkpoint commit message for save
  --outcome <value>   delivered or abandoned for close
  --result <text>     result location or summary for close
  --notes <value>     handled or parked for close
  --date <YYYY-MM-DD> closure date override
  --remove-worktrees  close: afterwards remove the init's clean, pushed worktrees
  --dry-run           worktree prune: list what would be removed, remove nothing
  --idle-days <N>     worktree prune: treat worktrees idle this long as finished (default 14)
  --remote            read PR facts as jcppman (inspect only; no fetch)
  --json              emit one JSON envelope on stdout
  --help              show this help

The canonical checkout of a repository belongs to the user; agents work in
worktrees under <workspace>/.worktrees. Switch saves uncommitted work in labelled
stashes and restores it on the other side. Close persists an outcome and archive
moves eligible history after its retention period. Create writes templates; save
stamps updated_at and commits a prepared checkpoint. Worktree removal never deletes
dirty or unpushed worktrees, worktrees in use by a process, or branches; prune also
skips branches owned by open inits.`;
export function parseArgs(argv) {
    const parsed = { command: null, positional: [], json: false, remote: false, help: false, open: false, closed: false, force: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--json')
            parsed.json = true;
        else if (arg === '--remote')
            parsed.remote = true;
        else if (arg === '--help' || arg === '-h')
            parsed.help = true;
        else if (arg === '--open')
            parsed.open = true;
        else if (arg === '--closed')
            parsed.closed = true;
        else if (arg === '--force')
            parsed.force = true;
        else if (arg === '--remove-worktrees')
            parsed.removeWorktrees = true;
        else if (arg === '--dry-run')
            parsed.dryRun = true;
        else if (arg === '--idle-days') {
            const value = argv[++i];
            if (value === undefined || !/^\d+$/.test(value))
                throw new GrindError('USAGE', '--idle-days requires a non-negative integer');
            parsed.idleDays = Number(value);
        }
        else if (arg === '--workspace') {
            const value = argv[i + 1];
            if (value === undefined)
                throw new GrindError('USAGE', '--workspace requires a directory');
            parsed.workspace = value;
            i += 1;
        }
        else if (['--scope', '--filter', '--message', '--outcome', '--result', '--notes', '--date', '--repo', '--init'].includes(arg)) {
            const value = argv[++i];
            if (value === undefined)
                throw new GrindError('USAGE', `${arg} requires a value`);
            parsed[arg.slice(2)] = value;
        }
        else if (arg.startsWith('--workspace='))
            parsed.workspace = arg.slice('--workspace='.length);
        else if (arg === '-' && parsed.command === 'note')
            parsed.positional.push(arg);
        else if (arg.startsWith('-'))
            throw new GrindError('USAGE', `Unknown option ${arg}`);
        else if (parsed.command === null)
            parsed.command = arg;
        else
            parsed.positional.push(arg);
    }
    return parsed;
}
export async function run(argv) {
    let json = argv.includes('--json');
    try {
        assertParticipantMayRun(argv, participantGuard(process.env));
        if (argv.filter((arg) => arg !== '--json')[0] === 'discuss') {
            const rest = argv.filter((arg) => arg !== '--json').slice(1);
            const result = await runDiscuss(rest, systemServiceEnv(process.cwd()));
            if (rest[0] !== 'run' && rest[0] !== 'worker') {
                const usage = result.usage;
                emit(json, { ok: true, data: result }, usage ?? JSON.stringify(result, null, 2));
            }
            return 0;
        }
        if (argv.filter((arg) => arg !== '--json')[0] === 'review') {
            const rest = argv.filter((arg) => arg !== '--json').slice(1);
            const result = await runReview(rest, process.cwd(), (value) => process.stdout.write(`${JSON.stringify(value)}\n`));
            if (rest[0] !== 'watch')
                emit(json, { ok: true, data: result }, rest[0] === undefined || rest[0] === 'help' ? REVIEW_USAGE : JSON.stringify(result, null, 2));
            return 0;
        }
        const args = parseArgs(argv);
        json = args.json;
        if (args.help || args.command === null) {
            emit(json, { ok: true, data: { usage: USAGE } }, USAGE);
            return 0;
        }
        const increment = DEFERRED_COMMANDS[args.command];
        if (increment !== undefined) {
            throw new GrindError('UNSUPPORTED_OPERATION', `"grind ${args.command}" is not implemented yet; it is delivered in ${increment}`, { command: args.command, increment });
        }
        if (args.command === 'start') {
            throw new GrindError('USAGE', '"grind start" was removed; use /grind:start, or grind worktree <initiative> for the working path');
        }
        if (!['inspect', 'list', 'status', 'context', 'create', 'worktree', 'switch', 'note', 'save', 'close', 'archive', 'dashboard'].includes(args.command)) {
            throw new GrindError('USAGE', `Unknown command "${args.command}"`);
        }
        if (args.command !== 'note' && args.positional.length > (args.command === 'dashboard' ? 0 : 1)) {
            throw new GrindError('USAGE', `Too many arguments for "grind ${args.command}"`);
        }
        for (const [option, command] of [['scope', 'create'], ['filter', 'list'], ['message', 'save'], ['outcome', 'close'], ['result', 'close'], ['notes', 'close'], ['date', 'close'], ['repo', 'worktree'], ['init', 'note'], ['force', 'switch']]) {
            if (args[option] !== undefined && args[option] !== false && args.command !== command)
                throw new GrindError('USAGE', `--${option} is only supported by ${command}`);
        }
        if (args.command === 'worktree' && args.positional.length !== 1)
            throw new GrindError('USAGE', 'worktree requires an initiative');
        const pruning = args.command === 'worktree' && args.positional[0] === 'prune';
        if (args.removeWorktrees === true && args.command !== 'close')
            throw new GrindError('USAGE', '--remove-worktrees is only supported by close');
        if ((args.dryRun !== undefined || args.idleDays !== undefined) && !pruning)
            throw new GrindError('USAGE', '--dry-run and --idle-days are only supported by worktree prune');
        if (pruning && args.repo !== undefined)
            throw new GrindError('USAGE', 'worktree prune does not take --repo');
        if (args.remote && args.command !== 'inspect')
            throw new GrindError('USAGE', '--remote is only supported by inspect');
        if ((args.open || args.closed) && !['list', 'inspect'].includes(args.command))
            throw new GrindError('USAGE', '--open and --closed are only supported by list or inspect');
        if (args.open && args.closed)
            throw new GrindError('USAGE', '--open and --closed cannot be combined');
        if (args.command === 'create' && args.positional.length !== 1)
            throw new GrindError('USAGE', 'create requires an argument');
        if (args.command === 'save' && !args.message?.trim())
            throw new GrindError('USAGE', 'save requires --message');
        if (args.command === 'close') {
            if (!['delivered', 'abandoned'].includes(args.outcome ?? ''))
                throw new GrindError('USAGE', 'close requires --outcome delivered|abandoned');
            if (!args.result?.trim())
                throw new GrindError('USAGE', 'close requires --result');
            if (!['handled', 'parked'].includes(args.notes ?? ''))
                throw new GrindError('USAGE', 'close requires --notes handled|parked');
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
        }
        else if (args.command === 'create') {
            const result = await createCommand(context, identifier, args.scope);
            emit(json, { ok: true, data: result }, `Created ${result.id} at ${result.dir}`);
        }
        else if (pruning) {
            const result = await pruneWorktreesCommand(workspace, { dryRun: args.dryRun === true, ...(args.idleDays === undefined ? {} : { idleDays: args.idleDays }) });
            emit(json, { ok: true, data: result }, formatPrune(result));
        }
        else if (args.command === 'worktree') {
            const result = await worktreeCommand(context, identifier, args.repo === undefined ? {} : { repository: args.repo });
            emit(json, { ok: true, data: result }, result.path);
            const details = formatWorktree(result);
            if (!json && details !== '')
                process.stderr.write(`${details}\n`);
        }
        else if (args.command === 'switch') {
            if (identifier === undefined) {
                const result = await repositoryStatus(context);
                emit(json, { ok: true, data: result }, formatRepositoryInitiatives(result));
            }
            else {
                const result = await switchCommand(context, identifier, { force: args.force });
                emit(json, { ok: true, data: result }, formatSwitch(result));
            }
        }
        else if (args.command === 'note') {
            await runNote(context, args, json);
        }
        else if (args.command === 'save') {
            const result = await saveCommand(context, identifier, args.message);
            emit(json, { ok: true, data: result }, result.saved ? `Saved ${result.id}: ${result.commit}` : `${result.id}: nothing to save`);
        }
        else if (args.command === 'close') {
            const result = await closeCommand(context, identifier, { outcome: args.outcome, result: args.result, notes: args.notes, ...(args.date === undefined ? {} : { date: args.date }), ...(args.removeWorktrees === true ? { removeWorktrees: true } : {}) });
            const removal = result.worktrees === undefined ? '' : `\n${formatRemovedWorktrees(result.worktrees)}`;
            emit(json, { ok: true, data: result }, `Closed ${result.id}: ${result.commit ?? 'already committed'}${removal}`);
        }
        else if (args.command === 'archive') {
            const result = await archiveCommand(context, identifier);
            emit(json, { ok: true, data: result }, `Archived ${result.id} as ${result.archivedId}`);
        }
        else if (args.command === 'inspect') {
            const result = await inspectWorkspace(context, { ...(identifier === undefined ? {} : { scope: identifier }), ...(args.open ? { status: 'open' } : args.closed ? { status: 'closed' } : {}), remote: args.remote });
            emit(json, { ok: true, data: result }, JSON.stringify(result, null, 2));
        }
        else if (args.command === 'list') {
            const result = await listCommand(context, {
                ...(identifier === undefined ? {} : { scope: identifier }),
                ...(args.open ? { status: 'open' } : args.closed ? { status: 'closed' } : {}),
                ...(args.filter === undefined ? {} : { filter: args.filter }),
            });
            emit(json, { ok: true, data: result }, formatList(result));
        }
        else if (args.command === 'context') {
            const result = await contextCommand(context, identifier);
            emit(json, { ok: true, data: result }, formatContext(result));
        }
        else {
            const result = await statusCommand(context, identifier);
            emit(json, { ok: true, data: result }, formatStatus(result));
        }
        return 0;
    }
    catch (error) {
        const failure = error instanceof GrindError
            ? error
            : new GrindError('GIT_ERROR', error.message);
        emit(json, { ok: false, error: failure.toJSON() }, null);
        process.stderr.write(`grind: ${failure.message}\n`);
        return failure.code === 'USAGE' ? 2 : 1;
    }
}
async function runNote(context, args, json) {
    const [action, ...rest] = args.positional;
    if (action === 'add') {
        if (rest.length !== 3 && rest.length !== 4)
            throw new GrindError('USAGE', 'Usage: grind note add <file> <start> [end] <comment|-> [--init <initiative>]');
        const [file, startText] = rest;
        const endText = rest.length === 4 ? rest[2] : startText;
        const comment = rest.at(-1) === '-' ? await readStdin() : rest.at(-1);
        const result = await addNote(context, {
            file: file,
            start: Number(startText),
            end: Number(endText),
            comment,
            ...(args.init === undefined ? {} : { initiative: args.init }),
        });
        emit(json, { ok: true, data: result }, `${result.id} ${result.reference} -> ${result.initiative}`);
    }
    else if (action === 'list') {
        if (rest.length > 1)
            throw new GrindError('USAGE', 'Usage: grind note list [initiative]');
        const result = await listNotes(context, rest[0] ?? args.init);
        emit(json, { ok: true, data: result }, formatNotes(result));
    }
    else if (action === 'done') {
        if (rest.length !== 1)
            throw new GrindError('USAGE', 'Usage: grind note done <id> [--init <initiative>]');
        const result = await resolveNote(context, rest[0], args.init);
        emit(json, { ok: true, data: result }, `Resolved ${result.id} of ${result.initiative}`);
    }
    else {
        throw new GrindError('USAGE', 'Usage: grind note add|list|done');
    }
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}
function emit(json, envelope, human) {
    if (json)
        process.stdout.write(`${JSON.stringify(envelope)}\n`);
    else if (human !== null)
        process.stdout.write(`${human}\n`);
}
// Windows passes argv[1] with backslashes.
const invokedDirectly = /[\\/](cli\.[jt]s|grind)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
    process.exitCode = await run(process.argv.slice(2));
}
//# sourceMappingURL=cli.js.map