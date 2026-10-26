# Batch reviews

A batch review collects comments on passages of Claude Code replies and Markdown
documents, keeps them editable, and sends them to one Claude conversation together
when you choose. `grind review` owns the drafts and the record of each sent batch.
A Claude Code mod and a cmux shortcut call it.

## Where review data lives

Drafts and sent batches are stored on this machine only, outside every Git
repository:

- macOS and Linux: `$XDG_STATE_HOME/grind/reviews`, by default
  `~/.local/state/grind/reviews`.
- Windows: `%LOCALAPPDATA%\grind\reviews`.
- `GRIND_REVIEW_HOME` overrides the location.

The directory holds `drafts/` (one draft per Claude session), `submissions/`
(frozen batches), `delivery/` (delivery attempts and resolution, kept apart from the
frozen batch) and `sessions/` (sessions that can receive cmux captures).

Consequences:

- Review data has no Git history. A deleted file is gone.
- It is lost with the machine and is not shared with your other machines.
- A checkpoint save or push never exports a draft or a quote. Init records hold
  no review text.

Draft privacy is a workflow boundary: `grind context`, `list`, `status` and the
note commands never show drafts. It does not protect the files from an agent that
reads your home directory directly.

## Init association

A draft takes the session's current init when it starts: the init you bound the
session to with `grind review bind`, otherwise the init the session's folder or
branch resolves to, otherwise none. The association does not change when the
branch changes. Only `grind review associate` changes it.

## Sending and delivery

`grind review submit` freezes exactly the revision you reviewed and starts an
empty draft; comments added meanwhile land in that new draft. Submitting the same
revision again returns the same batch. A stale revision or a draft with no
comments is refused and nothing is lost.

The batch carries a marker, `grind-review batch=<id>`. Delivery state is one of
`pending`, `sending`, `received`, `dropped`, `failed` or `unknown`:

- `received` needs the stored transcript row that carries the marker.
- `dropped` means Claude Code removed the prompt from its queue, for example after
  an interruption. Sending again is a manual action.
- `unknown` means the outcome could not be established, for example after a crash
  or reload. `grind review reconcile` looks the row up in the session transcript.
  A batch that is not found stays `unknown`; it is resent only when you confirm it.

Receipt does not mean the comments were addressed. Record that separately with
`grind review resolve <batch>`.

## Init-linked batches and lifecycle

A sent, unresolved batch associated with an init appears in `grind context` as a
reference: batch id, time, comment count, delivery state and the command that
prints it. The quotes stay in the local store. Closing with `--notes handled`
is refused while such batches are unresolved, and they block archival; resolve
them or close with `--notes parked`. Archival does not move or delete local
review data; the batches keep the init id they were sent under.
