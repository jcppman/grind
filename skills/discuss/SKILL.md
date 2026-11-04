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
   invent constraints or a desired outcome. Name the material to examine, such as
   checkout paths, revisions, PR URLs or files. Participants can read anything
   and run commands, but the shared context holds only the init's records.
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
6. Wait and report in this turn by default. Headless describes the presentation;
   it does not request a background handoff. Use the follow-up options below only
   when the user requests background work or the turn cannot continue.

If the result status is `needs_presentation_choice`, cmux is not reachable from
this process. Explain that the workers can run headless with the same protocol
and only local logs, and ask. On an explicit choice, run
`discuss resume <id> --presentation headless --json`. That choice covers the
whole run; do not ask again. Never choose headless for the user.

## Wait and report

`discuss wait <id> --timeout <seconds> --json` returns when the discussion finishes
or needs the user, or when the timeout ends. It is read-only: it never starts,
resumes, restarts or stops the discussion, so ending it early is safe.

- Run one wait command and await its result using the host's process tools, as for
  a build. In Codex, let `exec_command` yield a session ID and use `write_stdin`
  to await that same process in bounded calls. In Claude Code, use
  `run_in_background` and its completion notification. A tool yielding is not a
  reason to end the turn. Do not replace the wait with repeated `status` calls or
  sleeps in model turns.
- Choose the CLI timeout to cover the remaining discussion deadline (or the
  preset's total limit before a deadline is set) plus a few minutes, at most
  86400 seconds. Keep individual host-tool waits short enough for user interaction;
  a host-tool yield does not mean the CLI timeout expired.
- If the user requests background work or a runtime limit forces the turn to end,
  connect supported completion notification or automation before yielding. In
  Codex desktop, use a thread heartbeat when available: retain the discussion ID,
  exact CLI path and deadline; check status once per scheduled run and fetch the
  result when final. Reuse an existing monitor. Keep unchanged state quiet, report
  completion or required action, and stop the monitor after reporting. Monitoring
  does not authorize restarting or resubmitting a participant.
- A detached process or saved result alone does not wake a chat after its turn
  ends. If no continuation is available then, save the discussion ID and give the
  exact `discuss wait <id> --timeout <seconds> --json` resume command. Missing a
  post-turn callback does not prevent waiting during the active turn.
- After `discuss input` or `discuss resume` starts work again, wait again the same
  way.

When the wait returns, report promptly according to `reason`:

- `final`: report from `result` (described below): the outcome, `agreed` and
  `applied` as separate facts, the proposal's revision and a short summary of what
  it proposes, each participant's decision and any unresolved issues.
- `attention`: report the exact issue from `discussion` and its `nextCommand`:
  the questions for `needs_input`, the choice for `needs_presentation_choice`, or
  the error for `needs_recovery` and `interrupted`. Handle it as described below.
- `timeout`: the discussion is still running; wait again within its remaining
  deadline, or report a deadline/runtime limit that needs judgment. If
  `runnerAlive` is null, report liveness as unknown.
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
write only to their scratch and temporary directories, must not change external
state and must not run mutating Grind commands; the CLI refuses them.
