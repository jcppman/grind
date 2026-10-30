---
name: discuss
description: Start, follow, answer or stop a bounded Grind discussion in which several configured Codex and Claude CLI agents assess a brief, one writer drafts a proposal, and every participant must accept the exact same revision. Use for /grind:discuss, or whenever the user wants agents to discuss, debate, review or agree on a design, plan or document, including "have Codex and Claude review this plan" or "update plan.md only if the reviewers agree". macOS only.
---

Grind runs the discussion in a detached local runner; this chat starts it, waits for
it without blocking the user, and reports. Resolve the plugin root from this SKILL.md and run
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
   [--update-plan <file>]... --json`. Give a short progress update: the discussion
   ID, the owning init, the participants and how the user can follow it (the cmux
   workspace name, or headless).
6. Wait and report as described below. Skip the wait only when the user asked to
   run the discussion in the background: then return the ID with the `wait` and
   `status` commands.

If the result status is `needs_presentation_choice`, cmux is not reachable from
this process. Explain that the workers can run headless with the same protocol
and only local logs, and ask. On an explicit choice, run
`discuss resume <id> --presentation headless --json`. That choice covers the
whole run; do not ask again. Never choose headless for the user.

## Wait and report

`discuss wait <id> --timeout <seconds> --json` returns when the discussion finishes
or needs the user, or when the timeout ends. It is read-only: it never starts,
resumes, restarts or stops the discussion, so ending it early is safe.

- Run it as a background command whose completion continues this chat, such as a
  Bash command with `run_in_background` in Claude Code. Do not run a long
  foreground wait that keeps the user from interacting, and do not repeat
  `status` with sleeps in model turns. Choose a timeout that covers the time left
  until the discussion's `deadline` (or, before it is set, the preset's total time
  limit) plus a few minutes, at most 86400.
- If the host has no such continuation, say that you cannot be notified, and give
  the exact `discuss wait <id> --timeout <seconds> --json` command to run or
  resume later. Do not promise an automatic report.
- After `discuss input` or `discuss resume` starts work again, wait again the same
  way.

When the wait returns, report promptly according to `reason`:

- `final`: report from `result` (described below): the outcome, `agreed` and
  `applied` as separate facts, the proposal's revision and a short summary of what
  it proposes, each participant's decision and any unresolved issues.
- `attention`: report the exact issue from `discussion` and its `nextCommand`:
  the questions for `needs_input`, the choice for `needs_presentation_choice`, or
  the error for `needs_recovery` and `interrupted`. Handle it as described below.
- `timeout`: the discussion is still running; report its phase and round, then wait
  again or give the command. If `runnerAlive` is null, report liveness as unknown.
- `caller_cancelled`: only the wait ended; the discussion continues.

## Follow up

- `discuss status <id> --json` reports phase, round, turns and `nextCommand`.
  Status and result are read-only. Prefer `wait` to repeated status checks; use
  status when the user asks or at a natural pause. If `runnerAlive` is null, process inspection failed;
  report liveness as unknown and show `inspectionError`. Retry status with the
  environment’s normal process-inspection permission before proposing recovery.
  On older versions, verify an `interrupted` result outside a sandbox that denies
  process inspection before claiming the runner stopped.
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
  explicit choice. A resume response with `resumed: false` means no restart
  occurred; do not report that work was restarted or resubmitted.
- `discuss stop <id> --json` cancels and stops only this discussion's workers.

Agreement is not permission to implement, commit, push or publish. Participants
are read-only and must not run mutating Grind commands; the CLI refuses them.
