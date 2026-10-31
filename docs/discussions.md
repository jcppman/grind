# Discussions

`grind discuss` runs a bounded discussion between two to eight configured CLI
participants. Version 1 supports macOS only. On other hosts, `start` and `resume`
fail with `UNSUPPORTED_PLATFORM` before they launch a process or write state.

In Claude Code and Codex the skill is `/grind:discuss`. A bare `/discuss` alias
is not provided.

## Protocol

1. Every participant assesses the brief independently.
2. The writer drafts candidate revision 1: the full text of every target, its
   assumptions, and a disposition for each objection.
3. Every participant, including the writer, accepts or objects to that exact
   candidate hash. Objections, evidence requests and user questions are distinct.
4. Objections go back to the writer for a new revision, which is ratified again.
   `maxRounds` counts these ratification cycles.
5. Unanimous acceptance of one revision is `agreed`. Exhausted rounds or the total
   time limit is `unresolved`. A failed, timed-out or malformed participant is
   `failed`; Grind never resends a turn by itself.

A user question with rounds left pauses the discussion as `needs_input`. New input
invalidates acceptances. When the shared init context changes substantively, the
candidate is ratified again against the refreshed snapshot, once; a second change
ends the discussion unresolved. Ledger `updated_at` changes are reported but
ignored.

With `--update-plan <file>` (repeatable), Grind applies the accepted bytes only
to those files, and only while each still has its starting content. A changed file
is a `write_conflict`; nothing is overwritten and the proposal stays in the result.
Multi-file application is journaled per file, not as one atomic transaction.

## Configuration

Personal configuration is `$XDG_CONFIG_HOME/grind/discussions.json` (default
`~/.config/grind/discussions.json`). A workspace can add the same object under
`discussions` in `grind-workspace.json`. Precedence, lowest first: built-in
defaults, personal, workspace, command options. A role or preset defined at a
higher level replaces the whole entry of that name; participant lists are never
merged. Default fields merge one by one. Unknown fields are errors that name the
file and field.

```json
{
  "schemaVersion": 1,
  "defaults": { "preset": "review", "presentation": "cmux", "maxRounds": 3, "maxConcurrent": 3, "turnTimeoutSeconds": 900, "totalTimeoutSeconds": 3600 },
  "roles": {
    "architect": { "instructions": "Develop a concrete design and explain its tradeoffs." },
    "critic": { "instructions": "Find unsupported assumptions, failure cases and simpler alternatives." },
    "operator": { "instructions": "Evaluate recovery, observability and operational failure cases." }
  },
  "presets": {
    "review": {
      "participants": [
        { "id": "architect", "engine": "claude", "model": "opus", "role": "architect" },
        { "id": "critic", "engine": "codex", "model": "gpt-6-astra", "role": "critic" },
        { "id": "operator", "engine": "claude", "model": "sonnet", "role": "operator" }
      ],
      "writer": "architect"
    }
  },
  "engines": { "claude": { "executable": "/Users/me/.local/bin/claude" } }
}
```

Model names are passed to the CLI unchanged and are never substituted. The result
records the model Claude reports; Codex does not report one.

`engines` is accepted only in personal configuration. Without it, Grind uses the
first executable of that name on `PATH`, skipping cmux agent wrappers. Pin the real
CLI when the first one on `PATH` is a wrapper that changes accounts or settings.
Grind records the resolved path and version, and keeps the `CLAUDE_CONFIG_DIR`
that was in effect at start; it never records credentials.

`grind discuss presets --json` shows the effective presets with their sources.
`grind discuss config validate --json` checks every preset.

## Presentation

With `cmux`, the runner opens one workspace named after the init and discussion,
with one terminal per participant, without taking focus. Each terminal runs the
Grind worker, which shows that participant's turns. Grind drives every turn; typing
into a worker terminal does nothing for the protocol. Closing a terminal interrupts
that worker and leaves the discussion `needs_recovery`. When the discussion reaches
a final outcome, Grind closes its workspace; the turns stay in `discuss result` and
the discussion folder. A discussion that waits for input or recovery keeps its
workspace, because resuming adds its new workers there.

cmux only accepts commands from processes started inside cmux. If `start` cannot
reach it, the discussion waits as `needs_presentation_choice` and launches nothing.
`resume <id> --presentation headless` is the explicit choice to run the same
workers with local logs only.

## Participants and permissions

Each turn re-sends the protocol rules, the participant's role, the writer, the
owning init (or an explicit statement that there is none) and the full shared
context snapshot: intent, ledger, required constraints, linked plans and
specifications, repository and workspace instructions, review notes, and the
authorized targets.

- Claude runs with `--restricted --tools Read,Grep,Glob --permission-mode dontAsk`
  and an explicit `--session-id`, then `--resume`. File reads are confined to the
  participant's scratch directory and the readable roots. This is tool-level
  confinement, not operating-system isolation.
- Codex runs with `sandbox_mode="read-only"`, then `exec resume <thread>`. Writes
  are blocked by the Codex sandbox; reads are not confined to the workspace.
  User Codex configuration, plugins and hooks still load.

Participants get `GRIND_DISCUSSION_PARTICIPANT` in their environment. Mutating Grind
commands refuse to run under it. That guards against accidents; the engine
settings above are the actual boundary.

## Commands

| Command | Purpose |
|---|---|
| `start --brief-file <f> [--preset <p>] [--init <id> \| --no-init] [--update-plan <f>]... [--presentation cmux\|headless] [--max-rounds <n>]` | create a discussion and start its detached runner |
| `status <id>` | phase, round, turns, recent events and the next command |
| `wait <id> [--timeout <seconds>]` | wait until the discussion finishes or needs the caller (default 600 seconds) |
| `result <id>` | outcome, proposal, decisions, issues, evidence, application |
| `input <id> --brief-file <f>` | queue user input; on a finished run, start a linked discussion |
| `resume <id> [--presentation <p>] [--resubmit-uncertain]` | continue an interrupted, recoverable or undecided run |
| `stop <id>` | cancel and stop this discussion's workers |
| `list`, `presets`, `config validate` | inspect discussions and configuration |

## Waiting

`wait` is read-only and bounded. It returns `reason`:

- `final` with `result` once the stored result and the recorded state agree;
- `attention` with `nextCommand` for `needs_input`, `needs_presentation_choice`,
  `needs_recovery`, or `interrupted` after a confirmed runner exit;
- `timeout` when `--timeout` ends first, or `caller_cancelled` on `SIGINT` or
  `SIGTERM`.

It wakes on changes to the discussion directory and also rereads the state every
two seconds, so a missed file event only delays it. Ending a wait never stops,
resumes or relaunches the discussion. A running discussion whose runner has not
registered within 30 seconds of its last state change is `interrupted`; before
that, `status` reports `runnerStarting: true`. Denied process inspection keeps
the wait running and does not count as an exit.

## Recovery

Runtime data lives in `$XDG_STATE_HOME/grind/discussions/<id>` (default
`~/.local/state/grind/discussions/<id>`) with private permissions: the configuration
snapshot, context snapshots, turn briefs and output, an append-only event journal
and the result. It is never committed. Remove old discussions by deleting their
directories when no runner or worker is active.

Status preserves the recorded state when process inspection fails: `runnerAlive` is
`null` and `inspectionError` explains how to retry with inspection permission. This
is not evidence of interruption. Recovery refuses to replace a runner whose
identity cannot be checked. A resume response with `resumed: false` is a no-op.

Before each engine starts, Grind records the turn, attempt, runner generation and
session ID. Only the current generation's runner accepts results. After a crash,
`resume` reconciles the record:

- a turn that never reached its engine is assigned again;
- a turn whose engine finished recovers its result from the recorded output;
- a turn whose engine started but left no complete result is uncertain, and
  `resume` refuses to continue until `--resubmit-uncertain` is given.

Processes are stopped only after their recorded PID and start time match.
The total time limit is fixed at the first launch and is not extended by recovery.

## Limitations

- macOS only. Linux and Windows execution are not supported.
- Provider token and cost limits are not enforced; turn and total time limits are.
- A provider may process a turn that Grind records as uncertain; Grind does not
  claim exactly-once execution.
- Participants cannot be replaced in a running discussion; start a linked one.
