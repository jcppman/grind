import { watch as watchFiles } from 'node:fs';
export declare const REVIEW_USAGE = "Usage: grind review <action> [options] --json\n\nDrafts are private to this machine and never enter initiative records. The\nClaude Code mod drives these actions; cmux shortcuts use capture-cmux.\n\n  current --session <id> [--cwd <dir>]        the init the session concerns\n  show --session <id>                         the session's draft and recent batches\n  add --session <id> [--draft <id>] [--expect-revision <n>]\n                                              add a comment; JSON {source, quote, body?} on stdin\n  edit|delete|restore --session <id> --comment <id> [--draft <id>] [--expect-revision <n>]\n                                              edit takes the new comment text on stdin\n  associate --session <id> (--init <id> | --none) [--draft <id>] [--expect-revision <n>]\n  bind --session <id> (--init <id> | --none) [--by agent|user]\n                                              set the init the session works on\n  submit --session <id> --draft <id> --revision <n>\n  attempt --batch <id> [--resend-unknown]     start delivering a batch\n  finish --batch <id> --attempt <id> --status received|dropped|failed|unknown [--row <uuid>] [--reason <text>]\n  reconcile --batch <id> [--transcript <file>]\n  batches [--session <id> | --init <id>]      submitted batches\n  show-batch <batch> [--prompt]               a frozen batch, or its full prompt text\n  resolve <batch> [--note <text>]             record that the feedback was addressed\n  watch --session <id> [--cwd <dir>]          register the session and stream JSON lines\n  capture-cmux [--session <id>] [--comment <text>]  add the focused cmux selection\n  sessions                                    registered live sessions";
/** The command that prints a batch's full prompt text, using this same CLI. */
export declare function readBatchCommand(batchId: string): string;
/** Runs one review action and resolves its JSON result; `watch` resolves only when the stream ends. */
export declare function runReview(argv: readonly string[], cwd: string, emitLine: (value: unknown) => void): Promise<unknown>;
/**
 * Watches the store directory for prompt refreshes. The caller polls as well,
 * so a watcher that cannot start or later fails is closed and ignored.
 */
export declare function watchStore(root: string, onChange: () => void, watch?: typeof watchFiles): {
    close: () => void;
};
