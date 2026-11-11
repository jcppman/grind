# Review mod for Claude Code

The Grind plugin includes a Claude Code mod. It shows the session's current init
in the status line and keeps a review pane beside the conversation. You collect
comments on passages of Claude's replies, edit them, and
send them to the same conversation as one batch. Nothing reaches Claude until you
press Send. Review data stays on this machine; see [batch reviews](reviews.md).

Requirements: Claude Code 2.1.287 or later with mods enabled for the plugin, and
Node.js 24 on `PATH`. The mod is Claude Code only. The Codex plugin and the CLI
work without it.

## Current init

The status line under the prompt shows the init this session works on and its
current task, for example `demo [agent] · Review the plan document · review 2`.
The first line of the review pane shows the same summary.
The init is a state of the session. The session's folder and branch never select it:

- `[agent]`: Claude set the init with the `mcp__grind__set-init` tool. The
  `grind:start` skill does this, and `grind:close` clears it.
- `[you]`: you set the init with `/grind-init <init>`. `/grind-init none` clears it.
- `no init` when nothing set one, or `init unavailable` when the set init cannot
  be read.
- `review N` is the number of comments in the draft.

Claude and you write the same state; the last one to set it wins. A new review draft
belongs to the session's init, or to no init when none is set. The summary refreshes
when the init is set, when the session starts, after each Claude turn, and on
`/grind-review`. The mod never creates an init or switches a branch.

## Collecting comments

- Claude replies: with the fullscreen renderer (`/tui fullscreen`), select part of
  a reply with the mouse and run `/add-to-review`. The command works while Claude
  is still answering. The comment records the reply's message id when the
  selection lies in one message.
- Without the fullscreen renderer, Claude Code cannot read the selection, and
  typing a command in the same terminal clears the terminal's selection.
  `/add-to-review` then reports that nothing is selected.

Type your comment in the pane field and press Enter to save it. Delete and
Restore change the draft without sending anything. Press **Send review · N** to
send the batch. Comments you add afterwards start a new draft.

## Delivery

Claude reads a batch when it is idle. The pane shows each sent batch's state:

- **not sent yet**: the batch was frozen but delivery never started, for example
  because Claude Code reloaded in between. Press **Send**.
- **received by Claude**: the transcript stored the prompt that carried it.
- **not delivered**: Claude Code removed it from its queue, for example after you
  pressed Esc or Ctrl+C. After a Stop, Claude Code holds plugin prompts until you
  send a message yourself. Use **Send again** after that, or **Put in prompt box**
  and press Enter to send it as your own message.
- **delivery unknown**: the outcome could not be established, for example after
  a reload. **Check transcript** looks for it. **Resend anyway** sends the same
  batch again; the batch id lets Claude recognize a duplicate.
