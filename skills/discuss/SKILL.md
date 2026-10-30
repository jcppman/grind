---
name: discuss
description: Start, follow, answer or stop a bounded Grind discussion in which several configured Codex and Claude CLI agents assess a brief, one writer drafts a proposal, and every participant must accept the exact same revision. Use for /grind:discuss, or whenever the user wants agents to discuss, debate, review or agree on a design, plan or document, including "have Codex and Claude review this plan" or "update plan.md only if the reviewers agree". macOS only.
---

Grind runs the discussion in a detached local runner; this chat only starts it and
reports. Resolve the plugin root from this SKILL.md and run
`node <plugin-root>/scripts/grind.mjs discuss <action> ... --json`. Read
[discussions](../../docs/discussions.md) for configuration, presets and limits.

## Start

1. Turn the user's request into a brief file in a private scratch location. State
   the question, the decision needed and any constraints the user gave. Do not
   invent constraints or a desired outcome.
2. Choose the preset the user named, else the configured default. Run
   `discuss presets --json` when unsure which presets and roles exist.
3. Owning init: pass `--init <id>` when the user named one or this chat is working
   on one. The CLI otherwise resolves the init from the current folder or
   checkout; pass `--no-init` only for a discussion unrelated to any init. Report
   ambiguity to the user and ask; never guess.
4. Pass `--update-plan <file>` once for each document the user explicitly
   authorized Grind to replace. Without it the result is a proposal only. A request
   to discuss alone never authorizes changing a plan or ledger.
5. Run `discuss start --brief-file <file> [--preset <name>] [--init <id>|--no-init]
   [--update-plan <file>]... --json`. Return the discussion ID, the owning init,
   the participants and how the user can follow it (the cmux workspace name, or
   headless).

If the result status is `needs_presentation_choice`, cmux is not reachable from
this process. Explain that the workers can run headless with the same protocol
and only local logs, and ask. On an explicit choice, run
`discuss resume <id> --presentation headless --json`. That choice covers the
whole run; do not ask again. Never choose headless for the user.

## Follow up

- `discuss status <id> --json` reports phase, round, turns and `nextCommand`.
  Status and result are read-only. Do not poll in a loop; check when the user
  asks or at a natural pause.
- `discuss result <id> --json` returns the outcome (`agreed`, `unresolved`,
  `failed`, `cancelled`), the proposal and its hash, every participant's decision
  on that revision, unresolved issues, questions, evidence and the application
  status. Report `agreed` and `applied` as separate facts; `write_conflict` means
  the file changed and nothing was overwritten.
- `needs_input`: show the participants' questions, and pass the user's own answer
  with `discuss input <id> --brief-file <answer> --json`. Input to a finished
  discussion starts a linked discussion and returns its new ID.
- `needs_recovery` or `interrupted`: show the error. `discuss resume <id> --json`
  continues safely. When a turn's execution is uncertain, explain that it may
  already have run, and resume with `--resubmit-uncertain` only on the user's
  explicit choice.
- `discuss stop <id> --json` cancels and stops only this discussion's workers.

Agreement is not permission to implement, commit, push or publish. Participants
are read-only and must not run mutating Grind commands; the CLI refuses them.
