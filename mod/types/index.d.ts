/** Shapes of `grind review` JSON as the mod reads it; the CLI owns the schema. */
export type ReviewSource =
  | { kind: 'claude-reply'; sessionId: string; messageId: string | null }
  | { kind: 'terminal'; surfaceId: string | null; workspaceId: string | null; sessionId: string | null }
  | { kind: 'markdown'; path: string | null; lines: { start: number; end: number } | null; location: string };

export type ReviewComment = { id: string; source: ReviewSource; quote: string; body: string; deletedAt: string | null };

export type ReviewDraft = {
  id: string;
  revision: number;
  association: { workspace: string | null; initiative: string | null; source: string };
  comments: ReviewComment[];
};

export type DeliveryState = 'pending' | 'sending' | 'received' | 'dropped' | 'failed' | 'unknown';

export type BatchView = {
  id: string;
  submittedAt: string;
  comments: number;
  delivery: { state: DeliveryState; rowUuid: string | null; resolution: { state: string } };
};

export type ReviewView = { sessionId: string; draft: ReviewDraft | null; batches: BatchView[] };

export type CurrentInit =
  | { state: 'resolved'; initiative: string; setBy: 'agent' | 'user'; currentTask: string | null }
  | { state: 'none'; reason: string }
  | { state: 'unavailable'; reason: string };

declare module 'claude-code' {
  interface PluginState {
    grind: { view: Shaped<ReviewView | null>; current: Shaped<CurrentInit | null>; notice: Shaped<string> }
  }
}
