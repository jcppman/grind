import { watch as watchFiles } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrindError } from './errors.ts';
import { resolveIdentifierOrFragment } from './resolve.ts';
import { associationFor, currentInit } from './review-current.ts';
import { formatBatch, promptPayload } from './review-payload.ts';
import {
  addComment, associateDraft, bindSession, changeComment, changePath, endSession, finishAttempt, listBatches, liveSessions, readDelivery, readDraft,
  readSession, readSubmission, registerSession, resolveBatch, reviewStore, startAttempt, submitDraft,
  type DraftExpectation, type ReviewSource, type ReviewStore, type ReviewSubmission,
} from './review-store.ts';
import { reconcileBatch } from './review-transcript.ts';
import { loadWorkspace } from './workspace.ts';
import { captureFromCmux } from './review-capture.ts';

export const REVIEW_USAGE = `Usage: grind review <action> [options] --json

Drafts are private to this machine and never enter initiative records. The
Claude Code mod drives these actions; cmux shortcuts use capture-cmux.

  current --session <id> [--cwd <dir>]        the init the session concerns
  show --session <id>                         the session's draft and recent batches
  add --session <id> [--draft <id>] [--expect-revision <n>]
                                              add a comment; JSON {source, quote, body?} on stdin
  edit|delete|restore --session <id> --comment <id> [--draft <id>] [--expect-revision <n>]
                                              edit takes the new comment text on stdin
  associate --session <id> (--init <id> | --none) [--draft <id>] [--expect-revision <n>]
  bind --session <id> (--init <id> | --none) [--by agent|user]
                                              set the init the session works on
  submit --session <id> --draft <id> --revision <n>
  attempt --batch <id> [--resend-unknown]     start delivering a batch
  finish --batch <id> --attempt <id> --status received|dropped|failed|unknown [--row <uuid>] [--reason <text>]
  reconcile --batch <id> [--transcript <file>]
  batches [--session <id> | --init <id>]      submitted batches
  show-batch <batch> [--prompt]               a frozen batch, or its full prompt text
  resolve <batch> [--note <text>]             record that the feedback was addressed
  watch --session <id> [--cwd <dir>]          register the session and stream JSON lines
  capture-cmux [--session <id>] [--comment <text>]  add the focused cmux selection
  sessions                                    registered live sessions`;

const VALUE_OPTIONS = ['--session', '--cwd', '--expect-revision', '--comment', '--init', '--draft', '--revision', '--batch', '--attempt', '--status', '--row', '--reason', '--transcript', '--note', '--workspace', '--by'] as const;
const FLAGS = ['--json', '--none', '--prompt', '--resend-unknown'] as const;

interface ReviewArgs {
  action: string | null;
  positional: string[];
  values: Partial<Record<(typeof VALUE_OPTIONS)[number], string>>;
  flags: Set<string>;
}

function parseReviewArgs(argv: readonly string[]): ReviewArgs {
  const args: ReviewArgs = { action: null, positional: [], values: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if ((VALUE_OPTIONS as readonly string[]).includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new GrindError('USAGE', `${arg} requires a value`);
      args.values[arg as (typeof VALUE_OPTIONS)[number]] = value;
    } else if ((FLAGS as readonly string[]).includes(arg)) args.flags.add(arg);
    else if (arg.startsWith('-')) throw new GrindError('USAGE', `Unknown option ${arg}`);
    else if (args.action === null) args.action = arg;
    else args.positional.push(arg);
  }
  return args;
}

function required(args: ReviewArgs, option: (typeof VALUE_OPTIONS)[number]): string {
  const value = args.values[option];
  if (value === undefined || value === '') throw new GrindError('USAGE', `review ${args.action} requires ${option}`);
  return value;
}

function revision(args: ReviewArgs, option: '--expect-revision' | '--revision' = '--expect-revision'): number | undefined {
  const value = args.values[option];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new GrindError('USAGE', `${option} must be a nonnegative integer`);
  return Number(value);
}

function expectation(args: ReviewArgs): DraftExpectation {
  const expectRevision = revision(args);
  return { ...(args.values['--draft'] ? { draftId: args.values['--draft'] } : {}), ...(expectRevision === undefined ? {} : { revision: expectRevision }) };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseAddInput(raw: string): { source: ReviewSource; quote: string; body?: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new GrindError('USAGE', `review add expects JSON on stdin: ${(error as Error).message}`);
  }
  const input = value as { source?: { kind?: unknown }; quote?: unknown; body?: unknown };
  if (typeof input.quote !== 'string' || (input.body !== undefined && typeof input.body !== 'string')) {
    throw new GrindError('USAGE', 'review add expects {source, quote, body?} with string quote and body');
  }
  const kind = input.source?.kind;
  if (kind !== 'claude-reply' && kind !== 'terminal' && kind !== 'markdown') throw new GrindError('USAGE', 'review add source.kind must be claude-reply, terminal or markdown');
  return { source: input.source as ReviewSource, quote: input.quote, ...(input.body === undefined ? {} : { body: input.body as string }) };
}

/** The command that prints a batch's full prompt text, using this same CLI. */
export function readBatchCommand(batchId: string): string {
  const launcher = process.argv[1] ? path.resolve(process.argv[1]) : 'grind';
  return `node ${JSON.stringify(launcher)} review show-batch ${batchId} --prompt`;
}

function payloadFor(submission: ReviewSubmission) {
  return promptPayload(submission, readBatchCommand(submission.id));
}

async function sessionView(store: ReviewStore, sessionId: string) {
  const [draft, registration, batches] = await Promise.all([readDraft(store, sessionId), readSession(store, sessionId), listBatches(store, { sessionId })]);
  return {
    sessionId,
    draft,
    registration,
    batches: batches.slice(0, 10).map(({ submission, delivery }) => ({ id: submission.id, submittedAt: submission.submittedAt, comments: submission.comments.length, association: submission.association, delivery })),
  };
}

/** Runs one review action and resolves its JSON result; `watch` resolves only when the stream ends. */
export async function runReview(argv: readonly string[], cwd: string, emitLine: (value: unknown) => void): Promise<unknown> {
  const args = parseReviewArgs(argv);
  const store = reviewStore();
  const session = () => required(args, '--session');
  const sessionCwd = path.resolve(cwd, args.values['--cwd'] ?? '.');
  switch (args.action) {
    case null:
    case 'help':
      return { usage: REVIEW_USAGE };
    case 'current': {
      const registration = args.values['--session'] ? await readSession(store, session()) : null;
      return currentInit(sessionCwd, { ...(registration?.binding ? { binding: registration.binding } : {}), ...(args.values['--workspace'] ? { workspace: args.values['--workspace'] } : {}) });
    }
    case 'show':
      return sessionView(store, session());
    case 'add': {
      const sessionId = session();
      const input = parseAddInput(await readStdin());
      const existing = await readDraft(store, sessionId);
      const registration = existing === null ? await readSession(store, sessionId) : null;
      const association = existing?.association ?? associationFor(await currentInit(registration?.cwd ?? sessionCwd, registration?.binding ? { binding: registration.binding } : {}));
      return addComment(store, sessionId, { ...input, association, expected: expectation(args) });
    }
    case 'edit':
      return changeComment(store, session(), required(args, '--comment'), { kind: 'edit', body: await readStdin() }, expectation(args));
    case 'delete':
    case 'restore':
      return changeComment(store, session(), required(args, '--comment'), { kind: args.action }, expectation(args));
    case 'associate': {
      const sessionId = session();
      const workspace = (await currentInit(sessionCwd)).workspace;
      if (args.flags.has('--none') === (args.values['--init'] !== undefined)) throw new GrindError('USAGE', 'review associate takes exactly one of --init or --none');
      const association = args.flags.has('--none')
        ? { workspace, initiative: null, source: 'explicit' as const }
        : await explicitAssociation(sessionCwd, required(args, '--init'));
      return associateDraft(store, sessionId, association, expectation(args));
    }
    case 'bind': {
      const sessionId = session();
      if (args.flags.has('--none') === (args.values['--init'] !== undefined)) throw new GrindError('USAGE', 'review bind takes exactly one of --init or --none');
      const setBy = args.values['--by'] ?? 'user';
      if (setBy !== 'agent' && setBy !== 'user') throw new GrindError('USAGE', '--by must be agent or user');
      if (args.flags.has('--none')) return bindSession(store, sessionId, null);
      const association = await explicitAssociation(sessionCwd, required(args, '--init'));
      return bindSession(store, sessionId, { workspace: association.workspace as string, initiative: association.initiative as string, setBy });
    }
    case 'submit': {
      required(args, '--revision');
      const result = await submitDraft(store, session(), required(args, '--draft'), revision(args, '--revision') as number);
      return { ...result, payload: payloadFor(result.submission) };
    }
    case 'attempt': {
      const batchId = required(args, '--batch');
      const started = await startAttempt(store, batchId, { afterUnknown: args.flags.has('--resend-unknown') });
      return { ...started, payload: payloadFor(await readSubmission(store, batchId)) };
    }
    case 'finish': {
      const status = required(args, '--status');
      if (!['received', 'dropped', 'failed', 'unknown'].includes(status)) throw new GrindError('USAGE', '--status must be received, dropped, failed or unknown');
      return finishAttempt(store, required(args, '--batch'), required(args, '--attempt'), {
        status: status as 'received',
        ...(args.values['--row'] ? { rowUuid: args.values['--row'] } : {}),
        ...(args.values['--reason'] ? { reason: args.values['--reason'] } : {}),
      });
    }
    case 'reconcile':
      return reconcileBatch(store, required(args, '--batch'), args.values['--transcript'] ? { transcript: path.resolve(cwd, args.values['--transcript']) } : {});
    case 'batches': {
      if (args.values['--init'] !== undefined) {
        const association = await explicitAssociation(sessionCwd, args.values['--init']);
        return listBatches(store, { workspace: association.workspace as string, initiative: association.initiative as string });
      }
      return listBatches(store, args.values['--session'] ? { sessionId: session() } : {});
    }
    case 'show-batch': {
      const batchId = args.positional[0];
      if (batchId === undefined) throw new GrindError('USAGE', 'review show-batch requires a batch id');
      const submission = await readSubmission(store, batchId);
      if (args.flags.has('--prompt')) return { prompt: formatBatch(submission) };
      return { submission, delivery: await readDelivery(store, batchId) };
    }
    case 'resolve': {
      const batchId = args.positional[0];
      if (batchId === undefined) throw new GrindError('USAGE', 'review resolve requires a batch id');
      return resolveBatch(store, batchId, args.values['--note'] ?? null);
    }
    case 'sessions':
      return liveSessions(store);
    case 'capture-cmux':
      return captureFromCmux(store, {
        ...(args.values['--session'] ? { sessionId: session() } : {}),
        ...(args.values['--comment'] ? { body: args.values['--comment'] } : {}),
      });
    case 'watch':
      return watchSession(store, session(), sessionCwd, emitLine);
    default:
      throw new GrindError('USAGE', `Unknown review action "${args.action}"`);
  }
}

async function explicitAssociation(cwd: string, identifier: string) {
  const workspace = await loadWorkspace({ cwd });
  const entry = await resolveIdentifierOrFragment(workspace, identifier);
  return { workspace: workspace.root, initiative: entry.id, source: 'explicit' as const };
}

/**
 * Watches the store directory for prompt refreshes. The caller polls as well,
 * so a watcher that cannot start or later fails is closed and ignored.
 */
export function watchStore(root: string, onChange: () => void, watch: typeof watchFiles = watchFiles): { close: () => void } {
  let watcher: ReturnType<typeof watchFiles> | null = null;
  try {
    watcher = watch(root, onChange);
    watcher.on('error', () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
  return { close: () => watcher?.close() };
}

/**
 * Registers the session for routing and streams a snapshot line whenever the
 * store changes. Ends when the parent process is gone or on a signal.
 */
async function watchSession(store: ReviewStore, sessionId: string, cwd: string, emitLine: (value: unknown) => void): Promise<unknown> {
  const current = await currentInit(cwd);
  await registerSession(store, {
    sessionId,
    cwd,
    workspace: current.workspace,
    cmux: { workspaceId: process.env['CMUX_WORKSPACE_ID'] ?? null, surfaceId: process.env['CMUX_SURFACE_ID'] ?? null },
    pid: process.pid,
    host: os.hostname(),
  });
  const parent = process.ppid;
  let last: string | null = null;
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const stamp = await readFile(changePath(store), 'utf8').catch(() => '');
      if (stamp !== last) {
        last = stamp;
        emitLine({ type: 'snapshot', ...(await sessionView(store, sessionId)) });
      }
    } catch (error) {
      emitLine({ type: 'error', error: error instanceof GrindError ? error.toJSON() : { message: (error as Error).message } });
    } finally {
      busy = false;
    }
  };
  await tick();
  return new Promise((resolve) => {
    const watcher = watchStore(store.root, () => void tick());
    const timer = setInterval(() => {
      if (process.ppid !== parent) void stop();
      else void tick();
    }, 1000);
    const stop = async () => {
      clearInterval(timer);
      watcher.close();
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
      await endSession(store, sessionId, process.pid).catch(() => undefined);
      resolve({ sessionId, ended: true });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
}
