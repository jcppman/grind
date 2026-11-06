# Discussions

`grind discuss` runs a bounded discussion between two to eight participants,
using a preset or an ad hoc roster. Participants are managed CLI agents or an
optional calling session. Version 1 supports macOS only. On other hosts, `start` and `resume`
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
   time limit is `unresolved`. A failed, timed-out or malformed managed participant is
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
with one terminal per managed participant, without taking focus. Each terminal runs the
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

Participants investigate like a regular session. They can read any file, run
commands such as tests, git and gh, and use the network. For managed participants, the engine sandbox lets
them write only to their scratch directory (`participants/<id>/work`, also their
working directory) and temporary directories, so the repositories, plans and
other files under discussion stay unchanged until Grind applies an accepted
candidate.

- Claude runs with `--tools Read,Grep,Glob,Bash,WebFetch,WebSearch`
  `--permission-mode dontAsk` and an explicit `--session-id`, then `--resume`.
  It has no Write or Edit tool, and `--allowedTools` pre-approves every tool it
  has. Bash runs in Claude Code's sandbox, passed with
  `--settings`. The sandbox allows any network domain and the macOS trust service
  that Go-based CLIs need for TLS. Claude exits if the sandbox cannot start and
  never retries a blocked command unsandboxed. MCP servers stay off
  (`--strict-mcp-config`). User settings, hooks and instructions load.
- Codex runs with `sandbox_mode="workspace-write"` and
  `sandbox_workspace_write.network_access=true`, then `exec resume <thread>`.
  User Codex configuration, plugins and hooks still load.

The sandbox limits file writes only. A participant with network access and the
user's credentials could still change external state, for example by posting a
comment with `gh`. The turn rules forbid that, but no tool enforces it.

Managed participants get `GRIND_DISCUSSION_PARTICIPANT` in their environment. Mutating Grind
commands refuse to run under it. That guards against accidents; the engine
settings above are the actual boundary for file writes.

## Commands

| Command | Purpose |
|---|---|
| `start --brief-file <f> [--preset <p>] [--init <id> \| --no-init] [--update-plan <f>]... [--presentation cmux\|headless] [--max-rounds <n>]` | create a discussion and start its detached runner |
| `submit <id> --response-file <f> [--handoff]` | submit a caller response and return its durable receipt |
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
- `caller_assignment` with a pending caller turn, its instructions and response schema;
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

## Participate from the calling session

A participant's `execution` is `managed` by default. A caller uses `"execution":
"caller"` and has no engine or model. There can be 2–8 participants, including at
most one caller. Either type may be writer. Every participant must explicitly
ratify the same candidate hash, including the writer.

For a complete roster used only for this run, write a setup file:

```json
{
  "participants": [
    { "id": "author", "execution": "caller", "role": "author", "instructions": "Assess the brief and write a complete proposal." },
    { "id": "critic", "engine": "codex", "model": "gpt-6.1", "role": "critic", "instructions": "Investigate failure cases and review the proposal." }
  ],
  "writer": "author"
}
```

Start with `discuss start --brief-file brief.md --setup-file setup.json` and normal
init, target, presentation and round options. The saved configuration is unchanged.
Do not combine `--setup-file` with `--preset` or `--caller-file`.

To join a preset, put only the caller participant object above in `caller.json` and
use `--preset <name> --caller-file caller.json`. The preset writer remains selected;
`--writer author` explicitly changes it. Presets can also define a caller using a
configured role. Grind snapshots the resolved roster and instructions at start.
Follow-up discussions started by `input` retain that roster.

`discuss wait <id>` returns reason `caller_assignment` when a caller turn is ready.
Both `wait` and `status` expose `callerAssignment`: discussion/participant/turn IDs,
phase, snapshot ID, candidate revision/hash, assignment text, JSON response schema,
and supporting context paths. During assessment the assignment includes no peer
assessments. Existing knowledge in the caller's chat cannot be erased.

Perform the assigned investigation and write the required JSON response to scratch
space. Use `discuss submit <id> --response-file response.json`, then wait again.
Caller reasoning belongs in `submit`; `input` remains the user's own input. The
response must echo the exact envelope shown by the assignment. Ratification must
include the exact candidate hash. Invalid or stale responses do not change state.

The receipt is persisted before acknowledgment. An identical JSON response retry
returns the original receipt even after ingestion or completion; a conflicting
response fails. The runner alone writes protocol state and ingests the submission
once. If the runner stops, resume it normally: pending caller turns and durable
responses survive, and no caller replacement worker is launched. Caller waiting
uses no managed concurrency slot, worker, engine session or cmux pane. The original
total deadline still applies across recovery, including time waiting for the caller.
A caller turn also retains its original `turnTimeoutSeconds` deadline after assignment;
expiry ends unresolved. Late submissions are rejected.

Grind records the caller's Codex thread or Claude session ID when available. If the
submitting identity differs, `--handoff` explicitly attributes that submission to
the new session and records the original owner. Each submission from a different
session requires that flag. Identity metadata is not a security boundary against
another process running as the same local account.

Caller assignments are investigation-only. The caller's existing session does not
inherit a managed worker's sandbox. It may coordinate with `status`, `wait` and
`submit`, but must follow the assignment's restrictions on other mutations. Agreement
grants no authority to implement, commit, push or publish. Document application
still requires explicit targets, exact-hash unanimity, and unchanged target files.
