import type { CurrentInit, ReviewComment, ReviewDraft, ReviewSource, DeliveryState } from './types/index.d.ts'

export const BATCH_MARKER = 'grind-review batch=';

/** Text safe to draw: control characters other than newline and tab become U+FFFD. */
export function displayText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '�');
}

/** The first `lines` lines of a quote, each cut to `columns`, marking what was left out. */
export function excerpt(text: string, lines: number, columns: number): string {
  const all = displayText(text).split('\n');
  const shown = all.slice(0, lines).map((line) => (line.length > columns ? `${line.slice(0, Math.max(1, columns - 1))}…` : line));
  return all.length > lines ? `${shown.join('\n')}\n… ${all.length - lines} more line(s)` : shown.join('\n');
}

export function sourceLabel(source: ReviewSource): string {
  if (source.kind === 'claude-reply') return 'Claude reply';
  if (source.kind === 'terminal') return 'Terminal selection';
  const name = source.path === null ? 'Markdown' : (source.path.split('/').pop() as string);
  if (source.lines !== null) return `${name}:${source.lines.start}${source.lines.end === source.lines.start ? '' : `-${source.lines.end}`}`;
  return `${name} (${source.location === 'ambiguous' ? 'repeated passage' : 'location uncertain'})`;
}

export function liveComments(draft: ReviewDraft | null): ReviewComment[] {
  return draft?.comments.filter((comment) => comment.deletedAt === null) ?? [];
}

/** The compact status entry: current init, task and draft count, or why there is no init. */
export function initSummary(current: CurrentInit | null, draftCount: number): string {
  const count = draftCount > 0 ? ` · review ${draftCount}` : '';
  if (current === null) return `…${count}`;
  if (current.state === 'resolved') {
    const task = current.currentTask === null ? '' : ` · ${current.currentTask.length > 48 ? `${current.currentTask.slice(0, 47)}…` : current.currentTask}`;
    return `${current.initiative} [${current.source === 'explicit' ? 'bound' : current.source}]${task}${count}`;
  }
  if (current.state === 'ambiguous') return `init ambiguous (${current.candidates.join(', ')})${count}`;
  if (current.state === 'none') return `no init${count}`;
  return `init unavailable${count}`;
}

export function deliveryLabel(state: DeliveryState): string {
  return {
    pending: 'not sent yet',
    sending: 'sending; waits until Claude is idle',
    received: 'received by Claude',
    dropped: 'not delivered (removed from the queue)',
    failed: 'not delivered (refused)',
    unknown: 'delivery unknown',
  }[state];
}

/** Splits streamed stdout into complete lines, keeping a partial last line for the next piece. */
export function splitLines(buffered: string, piece: string): { lines: string[]; rest: string } {
  const text = buffered + piece;
  const parts = text.split('\n');
  return { lines: parts.slice(0, -1).filter((line) => line.trim() !== ''), rest: parts.at(-1) as string };
}

/** The batch id a delivered prompt carries, if it is one of ours. */
export function batchIdIn(text: string): string | null {
  const at = text.indexOf(BATCH_MARKER);
  if (at === -1) return null;
  return /^[a-z]-[A-Za-z0-9-]+/.exec(text.slice(at + BATCH_MARKER.length))?.[0] ?? null;
}
