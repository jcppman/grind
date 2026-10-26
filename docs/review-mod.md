# Review mod for Claude Code

The Grind plugin includes a Claude Code mod. It shows the session's current init
in the status line and keeps a review pane beside the conversation. You collect
comments on passages of Claude's replies and of Markdown documents, edit them, and
send them to the same conversation as one batch. Nothing reaches Claude until you
press Send. Review data stays on this machine; see [batch reviews](reviews.md).

Requirements: Claude Code 2.1.287 or later with mods enabled for the plugin, and
Node.js 24 on `PATH`. The mod is Claude Code only. The Codex plugin and the CLI
work without it.

## Status line

The status line shows the current init and its current task, for example
`demo [branch] · Review the plan document · review 2`:

- `[bound]`: you chose the init for this session with `/grind-init <init>`.
- `[branch]` or `[folder]`: the session's checkout or folder resolves to the init.
- `no init`, `init ambiguous (a, b)` or `init unavailable` when there is no single
  answer. The mod never creates an init or switches a branch.
- `review N` is the number of comments in the draft.

It refreshes when the session starts, after each Claude turn, and on
`/grind-review`. `/grind-init none` returns to branch and folder resolution.

## Collecting comments

- Claude replies: with the fullscreen renderer (`/tui fullscreen`), select part of
  a reply with the mouse and run `/add-to-review`. The command works while Claude
  is still answering. The comment records the reply's message id when the
  selection lies in one message.
- Without the fullscreen renderer, Claude Code cannot read the selection. Inside
  cmux, `/add-to-review` then reads the terminal selection through cmux; that
  quote has no message id.
- Markdown documents in cmux: select text in the cmux Markdown viewer, then run
  `/add-to-review` in the Claude session of the same cmux workspace, or use the
  cmux action below. The quote gets a file and line range only when the passage
  occurs exactly once in the file on disk; otherwise the pane marks the location
  as uncertain.

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

## cmux action

`/add-to-review` needs no cmux configuration. To add a document selection from
cmux itself, add an action to `~/.config/cmux/cmux.json` (back the file up first),
replacing `<plugin-root>` with the installed plugin's folder:

```json
{
  "actions": {
    "grind-add-to-review": {
      "type": "command",
      "title": "Add selection to Grind review",
      "command": "node '<plugin-root>/scripts/grind.mjs' review capture-cmux; exit",
      "target": "newTabInCurrentPane",
      "shortcut": "cmd+ctrl+r",
      "palette": true
    }
  }
}
```

Run `cmux reload-config`. The action opens a terminal tab in the focused pane,
adds the selection to the Claude session running in the same cmux workspace, and
ends the tab's shell. It never types into the Claude terminal or sends a cmux agent
message, so no Claude turn starts. When several Claude sessions with the mod run in
the workspace, it refuses and lists them; run the command with `--session <id>`.
