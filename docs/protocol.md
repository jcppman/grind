# Grind operating protocol

This document owns the instructions for an agent carrying out initiative work.
The CLI implements deterministic mechanics; skills apply judgment using this
protocol. Follow the available command's documented capabilities and stop when a
required operation is unavailable. Initiative-specific limitations and temporary
manual procedures belong in that initiative's ledger and plan.

## Terminology

Use **init** (plural **inits**) as the short name for an initiative in conversation.
Accept both names for the same workflows, including “create an init for…” and
“save this init.” Documentation may use the full term. Command names, stored paths,
JSON fields, and artifact types retain their existing names.

## What counts as an initiative

An initiative is a coherent body of work with one intended outcome, potentially
spanning multiple repositories, tickets, pull requests, tasks, and agent
sessions. It is larger than a single task, but it need not be a large
organisational program.

Typical initiatives include a cross-repository feature, a substantial
migration, a coordinated release, or a multi-session investigation and
implementation. A typo, dependency bump, question, or small localised change
does not need an initiative folder.

```text
initiative: overall outcome
├── ticket: trackable unit of responsibility
├── task: concrete implementation work
└── commit or pull request: delivery and review unit
```

An initiative starts the moment an idea is worth writing down. `grind create`
creates `index.md`, `intent.md`, and `ledger.md`; specifications, plans, and
supporting artifacts appear as the work earns them.

### Creating an initiative

Creation captures intent; it does not authorize implementation or checkout changes.
Before writing the intent, ask focused clarification questions when uncertainty
about the desired outcome, scope, success criteria, or constraints would materially
change what is recorded. Use the current conversation to avoid asking questions
already answered. Do not turn plausible assumptions into agreed requirements.
Design and execution choices that can wait belong as open questions in the ledger,
with clarification or investigation as the next action when needed.

Choose placement from the repositories the intended work targets, independently
of the agent's current working directory. Unless the user explicitly specifies a
different location, work targeting one repository uses that repository's
workspace-relative folder as `--scope`. For multiple target repositories, use
their narrowest common containing folder. Repositories consulted only as references
do not widen the scope. Omit `--scope` when no target repository is known.

Resolve and verify the target repository's folder before running create; a known
target determines placement even when it has no assigned initiative branch or
`grind.repositories` entry yet. For example, with a workspace containing
`audio/rytho`, work solely on Rytho uses `create <outcome> --scope audio/rytho`
even when the working directory is `audio`. This creates
`initiatives/audio/rytho/<outcome>/` in the state repository. A `rytho-` name
prefix is not a substitute for the repository scope.

`grind.repositories` records repositories, by the workspace-relative path of their
canonical checkout, and the exact branches assigned to initiative work, not every
repository consulted. A checkout's current branch is evidence of its state, not
evidence that the branch belongs to this initiative. A legacy `checkout` field is
accepted and ignored. During creation,
record an existing branch only when its association with the initiative is
established by the user or verified initiative work. Otherwise leave
`grind.repositories` empty and describe candidate repositories in the ledger's
working state. Do not invent branch names to fill the required field or put
placeholder branches in tracking records.

Choose and create new branches when execution needs them, following the
repository's branching rules, then record the verified branch. `grind worktree`
records a branch named after the init when it creates one for an untracked
repository. Creation alone does not create or switch branches. Repositories used
only as references do not need an initiative branch or tracking entry.

### Checkouts and worktrees

The canonical checkout of a repository belongs to the user. Agents do not change
its branch unless the user asks. Agents work in worktrees at
`<workspace>/.worktrees/<repository path>/<init name>`, where the init name is the
last segment of its ID.

An init's work lives wherever its recorded branch is checked out: the canonical
checkout, a Grind worktree, an app-managed worktree, or nowhere. Run
`grind worktree <init> [--repo <repository>]` to get that path; it creates the
standard worktree when the branch is not checked out, and stops when the branch is
in the canonical checkout, because the user holds it. Ask the user whether to work
there or wait. Look the path up again before resuming after any pause, because the
user may have moved the work.

`grind worktree` also links each `CLAUDE.md` and `AGENTS.md` between the
workspace root and the canonical checkout into the matching folder under
`.worktrees`, so worktrees receive the same directory-scoped instructions. It
leaves correct links alone and reports, rather than replaces, a file in the way.

`grind switch <init>` is the user's command for bringing an init into the canonical
checkout. It saves the current work in a labelled stash and moves it to its owning
init's standard worktree; it takes the target branch from its worktree after
stashing that worktree's changes. The worktree it takes a branch from is detached and
left in place with its ignored files, such as `.env` and dependencies, and is
reused when the work moves back. Ignored files in the canonical checkout do not move. Switch refuses an in-progress Git operation, uncommitted
changes on a branch no init owns, a process working inside the target worktree, and,
without `--force`, a worktree changed in the last few minutes. On failure it
reports each remaining stash and how to restore it. Agents run switch only when the
user asks. Without an argument, switch lists the repository's inits and where each
is checked out; `grind status` inside a repository also names the init owning its
current branch.


## Initiative artifacts

`index.md`, `intent.md`, and one `ledger.md` are required at the initiative root.
The root `intent.md` declares `type: Intent` and `grind.root: true`; that marker
identifies the initiative boundary. Nested initiative roots are invalid.
Specifications and plans may use any filename and split by coherent decision scope. Nested indexes
organize documents; they do not create nested initiatives.

| Type | Question it answers |
|---|---|
| `Intent` | Why are we doing this, and what outcome do we want? |
| `Roadmap` | What broader direction and priorities connect this work? |
| `Specification` | What behaviour and technical solution are proposed or agreed? |
| `Implementation Plan` | In what order will we implement and verify it? |
| `Initiative Ledger` | What is true now, and exactly where should work continue? |

### Choosing what to preserve

Preserve decisions with brief rationale, essential contracts and acceptance
conditions, and consequential unresolved questions. Small decisions belong in the
ledger until a coherent contract needs its own specification. Move that content
to its authoritative home and link from the ledger instead of keeping both copies.
Routine implementation detail stays in code and commits; link to existing repository
documentation for enduring contracts rather than duplicating it.

Form a working plan from current code when execution begins. Persist sequencing
only when it carries knowledge needed across sessions, such as migration order,
rollout constraints, or dependencies between repositories. Document length or task
size alone does not justify an additional artifact.

### Index and document scope

`index.md` links to authoritative documents and explains each one's scope. It
identifies required local Markdown links in list items under the exact level-two
heading `Read on every context load`. Link to a heading fragment for only that
section and its subsections, or omit the fragment for the whole document. Intent
and ledger are always included and need not be repeated. Other links are navigation.
The context command diagnoses missing files, fragments, and unsupported required
reads; it never infers mandatory reads from prose or follows links recursively.
Keep it current when documents are added, moved, or removed. It
contains navigation, not duplicated status or checkpoint information.

Shared specifications own shared contracts; narrower specifications reference
them and own their local contracts. Plans can split by decision scope, with
sequencing and dependencies defined in one place. Each rule has one authoritative
home. Split documents when separate decision scopes or reading needs justify it,
not to prepopulate a roadmap. Link visual designs, research, schemas, and other
supporting artifacts, explaining whether they are authoritative or exploratory.

### Paths in artifacts

Describe filesystem locations in artifact content relative to the workspace root,
using `.` for the root itself. For example, write `grind` and
`yyu-dev/grind-state`, not machine-specific absolute paths or home-directory paths.
This keeps records portable across checkouts and machines. Markdown link targets
remain relative to the containing document so they resolve normally. Structured
fields retain their explicitly defined bases; do not change their interpretation.

### Frontmatter and interoperability

Every non-index Markdown artifact has YAML frontmatter with a nonempty `type`.
Use the canonical types above for core roles. Supporting documents may use
other descriptive types, such as `Visual Design` or `Research`; readers tolerate
unknown types. Non-Markdown assets are linked resources. Filenames and paths do
not determine the role of a specification or plan.

Use standard OKF fields for document metadata: optional `title`, `description`,
`tags`, `sources`, `generated`, and `verified`. Specifications and plans carry no
`status` field. Other supporting documents may use `status`.
Reserve new fields under `grind` for this protocol; external workflows must not invent
completion or delivery fields there. Preserve existing unknown fields during ordinary
edits; correct or migrate them explicitly when their ownership and meaning are known.
Move structured facts into frontmatter rather than retaining a second authoritative copy in the body. The ledger owns
initiative status, phase, current task, next action, and repository tracking;
other documents must not duplicate those fields.

Keep explanations and durable history in Markdown. Preserve unknown frontmatter
keys and unrelated content during edits. Existing initiatives need an explicit root marker migration before discovery.
Other artifacts without frontmatter remain readable during migration; report missing metadata and migrate explicitly,
never during context loading. Malformed optional metadata is diagnostic; malformed
required Grind state prevents a mutating operation. A save does not normalize
metadata or imply verification.

Indexes contain navigation and may declare `grind.roadmap`; a bundle-root index
may also declare `okf_version`. This protocol does not yet declare the entire state tree
an OKF bundle: its boundary and auxiliary Markdown must be defined before claiming
full bundle compatibility.

### Execution authorization and verification

A substantive user instruction such as “implement this,” “let's do it,” or
“continue” authorizes work consistent with the current specification, plan, ledger,
and conversation. A bare `/grind:start` authorizes preparation only; ask what the
user wants to do before undertaking substantive work. Do not require or record
separate document sign-off metadata. Where authority affects interpretation,
distinguish user decisions, implementation choices within delegated scope, and
unresolved proposals in ordinary prose. Accepting an outcome or one design choice
does not imply user approval of every detail the agent later writes. Surface
material consequences in discussion; routine reversible choices remain delegated.
When the direction is ambiguous or implementation reveals a material change, discuss it with
the user before proceeding and update the governing documents and ledger afterward.

Keep implementation authorization separate from later external actions. Review,
push, publication, deployment, and other consequential actions follow the user's
instructions and the applicable repository workflow; do not infer one from another.

`verified` records checking claims against evidence. Generation describes meaningful
content production, not every save. A verification event does not automatically
cover later content. Do not invent verification evidence.

### Verification records and external workflows

Keep a concise verification summary in the ledger: the tested commit or artifact,
checks performed, results, and material limitations. Link stable CI runs or other
evidence when useful. Retain raw logs, screenshots, or binaries only when they carry
information needed for a future decision that is costly to reproduce; record why
and identify the revision and environment they describe. A temporary output path
is not a durable reference. Routine successful command output does not need copying
into the state repository.

After changes, distinguish current verification from results on older revisions.
Replace obsolete claims; retain older evidence only when still useful, explicitly
scoped to its revision. Do not imply that an old full-suite run covers a newer head
because a targeted check passed. State what remains unverified.

External plans, goal oracles, and review loops follow these preservation rules for
initiative artifacts. Their completion checks must not require copied evidence
bundles or extra specification content. Product checks establish delivery; a
checkpoint gate checks that the relevant records are committed and reference the
verified revision. Matching a revision in prose proves neither the summary's
accuracy nor product completion; the save workflow reconciles its meaning.

Run-specific commands and authorization boundaries belong in the execution plan.
Before deleting it, preserve only decisions, still-applicable user constraints,
and unfinished work needed for resumption in the ledger or their authoritative
home. Specifications retain product contracts, not goal instructions or dated
execution status. Remove temporary-helper references and misplaced execution text
when reconciling a completed run.

### `intent.md`

Defines the enduring reason for the work:

- problem and desired outcome
- scope and non-goals
- users or systems affected
- outcome-level success criteria
- constraints that acceptable solutions must satisfy
- related tickets, when they are sources of business context

Change an intent only when its purpose or scope changes. Describe the outcome without
summarising the feature list or prescribing implementation choices. Technical
design decisions and execution details belong in the ledger or warranted
specifications and plans, following Choosing what to preserve. Link to them when
they exist.

### Roadmaps

A roadmap describes vision, desired outcomes, priorities, dependencies between
initiatives, possible future work, and open decisions. Create one when broader
planning needs a durable home. It is optional and may live anywhere in the configured
state directory; `roadmap.md` beside a project `index.md` is the usual location.
A roadmap does not create an initiative or require its own ledger.

```yaml
type: Roadmap
grind:
  id: rytho
```

Roadmap IDs are case-sensitive, nonempty strings without surrounding whitespace,
unique across the entire state directory, including archived documents. Identity
comes from `type: Roadmap` and `grind.id`, not the filename or folder. Moving a
roadmap within the state directory preserves its identity. Grind scans Markdown
files without following symlinks or entering `.git`; no registry is maintained.

Any document can declare one association:

```yaml
grind:
  roadmap: rytho
```

On an initiative's root `intent.md`, this declares the initiative's roadmap.
Other files declare only their own association; there is no folder inheritance.
Indexes may carry `grind.roadmap` alongside optional `okf_version` metadata.
Use ordinary Markdown links for human navigation. Missing or ambiguous references
and invalid IDs are diagnosed rather than resolved by proximity or filename.

`list` and `status` expose the initiative association as an ID and resolved path.
`context` also includes the roadmaps referenced by the initiative's documents,
with each body included once. Roadmaps provide planning context, not execution
authorization or automatically required constraints. References are not followed
recursively. The user's request still determines the task.

Keep each initiative's purpose and completion criteria in its intent, execution
strategy in warranted plans, and current state and concrete next action in its
ledger. Keep the roadmap at the level of product direction, outcome-level stages,
priorities, and dependencies between initiatives. Detailed research approaches,
prompts, acceptance criteria, technical choices, and concrete next actions belong
in the relevant initiative. When a roadmap discussion introduces such detail,
update that initiative and retain only the strategic implication and a link in
the roadmap. Reuse an existing initiative that owns the outcome; create a missing
one when the user asks to track it. Future ideas need not become initiatives
immediately.

Milestones may be ordinary headings in roadmaps or plans. They have no special
artifact, folder, metadata, or lifecycle in Grind. Existing folders remain valid
ordinary document organization and do not need a migration.

For a product roadmap, give most substantial initiatives a visible place under
outcome-based milestones; distant ideas and trivial work may remain unassigned.
List contributing initiatives with ordinary links and distinguish required from
optional or conditional contributions. Qualify partial contributions so milestone
readiness does not imply completion of an initiative's entire scope. Keep membership
in the roadmap; do not invent a `grind.milestone` field or duplicate status there.

### Specifications

Create a specification when a coherent contract needs an independent reference,
such as an API, lifecycle behaviour, or rules shared across components. Agreement
on a small decision alone does not require one. Preserve precise semantics and
acceptance conditions when another implementation or future session relies on them.

Defines the agreed solution, including both intended system behaviour and the
meaningful technical design needed to implement and review it:

- requirements and user-visible behaviour
- existing system context and boundaries
- proposed architecture, responsibilities, and data flow
- APIs, schemas, state transitions, and integration contracts
- significant technical choices, constraints, and tradeoffs
- edge cases and acceptance criteria

Update it when the agreed behaviour or technical solution changes, not merely
when routine implementation details shift.

A specification answers, "What solution have we agreed to build?" Reference
existing authoritative contracts and operating instructions rather than keeping
competing copies. Proposed changes must be distinguished from agreed behavior.

It may prescribe internal boundaries or technical choices when they are important to
that agreement, but it does not prescribe function bodies, routine component
structure, incidental control flow, or arbitrary library choices. Use examples,
short signatures, schemas, or pseudocode only when they clarify behaviour,
contracts, or design.

### Plans

Create a persistent plan when losing the sequence or dependencies could cause a
meaningful execution mistake across sessions. A short working plan for the current
session does not need a document. Keep only the durable execution strategy:

- phases, milestones, and dependencies
- repositories and major areas involved
- validation strategy
- sequencing and rollout considerations
- ticket-to-outcome or ticket-to-repository mapping, when useful

Update it when the implementation strategy materially changes.

A plan identifies outcomes, affected repositories and likely areas,
constraints, dependencies, risks, edge cases, and verification. It does not
redefine the solution or contain complete implementation code. Put contracts,
schemas, and design details in specifications; the plan may link to them and name the
paths, commands, or checkpoints needed for execution. If code is already known
well enough to be written verbatim, implement and test it instead of placing it
in the plan.

### `ledger.md`

Keep the ledger focused on resumption. At each checkpoint, rewrite working state
to describe what is true now. Remove superseded observations, repeated completion
details, and obsolete validation results. Keep the latest relevant verification
with its commit or artifact reference and limitations. Preserve historical rationale
only when it still affects future decisions; Git retains earlier checkpoints.
Do not create a separate history file by default.

Use consistent terms for the same component or state. Distinguish implemented
behavior, verified behavior, and proposed work. State what each check established
and what remains unverified; a passing check supports only the behavior it covers.
Preserve conditions, exceptions, and uncertainty when shortening the checkpoint.
For example: "At commit `abc123`, expired sessions return HTTP 401. The regression
test passes. Production behavior is unverified. Next: review the retry behavior."

Reconcile the whole checkpoint, including frontmatter and verification, against
observed state before saving. Remove competing “current” claims and commit-by-commit
narratives. Check relevant PR head, draft/merge state, and derived descriptions when
work changes them; if remote verification is unavailable, label the last observation
and uncertainty. Context loading remains read-only and does not require network
access. `current_task` names work to do, not a completed-work status sentence.

When a review is interrupted, retain a compact handoff: reviewed head/base,
unresolved findings with links, and next action. Record the outcome when it ends.
Polling history and scheduler state stay with the review workflow.

Keep small decisions with brief rationale and essential acceptance conditions in
the ledger while they have no separate authoritative home. Retain them when
rewriting working state, or move them into a warranted specification. Link to rules
already owned by a specification, plan, protocol, or repository document instead
of maintaining another copy. Record the next concrete task or unresolved decision in `next_action`, not routine workflow such as
asking the user what to do. It is a candidate task, not execution authorization.
Preserve lifecycle records needed for recovery and unknown metadata when trimming
prose. Save sets `grind.updated_at` to the time of the save; do not write it by hand.

Provides resumable external working memory:

- what is true now
- what happened and why
- what remains
- exactly where the next session should begin

The ledger exists because conversation context is temporary and
vendor-specific. A conversation summary may help one conversation continue,
but it is internal: it may omit operational details, remains tied to that
session, and cannot hand work to a different agent or a future one. The ledger
is inspectable, editable, portable, and versioned.

The ledger is also the handoff. Because the protocol is the same for every
session, context can be loaded with `/grind:context` or automatically from an
initiative folder or a checkout of one of its branches. Accompany it with the current
request; use `/grind:start` to prepare the initiative and choose what to do next. No per-session handoff
document is written.


### Reference documents

Use `type: Reference` for a dated report, retrospective, or inherited handover
preserved as evidence. Identify its date, provenance, and material limitations.
Reference is a supporting type with workflow instructions, not CLI or filesystem
write protection. Do not silently revise the snapshot to match current reality.
Record corrections or superseding findings in a separate linked note or successor
report, and make the relationship clear in the index.

Load references only when relevant to the task; do not add them to mandatory context
merely because they exist. Their recommendations are neither current requirements
nor execution authorization. Put adopted decisions in the ledger or other current
authoritative home, linking back to the evidence. An evolving investigation may
remain `Research`; do not automatically reclassify existing artifacts.

## Proportionate execution

Use the lightest process appropriate to the size, uncertainty, and risk of the
work.

### Small, localised work

State the design briefly, implement in the current session, test meaningful
logic, and perform one final review. Maintain initiative artifacts only when
the change belongs to an existing initiative.

### Ambiguous or consequential work

Clarify intent and constraints and compare viable approaches before costly
implementation when the direction could materially change. Proceed when the user's
instruction selects or accepts a direction.
Update `intent.md` only if the chosen direction changes the intended outcome or
scope. Preserve decisions and essential acceptance conditions using Choosing what
to preserve; create a specification only when a contract warrants its own reference.

### Large or cross-repository work

Choose artifacts by their durable value under Choosing what to preserve. Divide
execution along independently verifiable boundaries, and use parallel agents only
for genuinely independent work that has been declared unattended and given a
worktree. Review applicable contracts and code quality, then perform end-to-end verification.

### Testing and debugging

Prefer red-green-refactor for branching, transformations, state transitions,
validation, boundary cases, and bug reproductions. Do not add elaborate tests
for trivial wiring or framework behaviour. During debugging, reproduce or
gather sufficient evidence, trace the cause, test the hypothesis, and only then
implement the fix.


## Reading review notes

Notes are the user's review of the code, kept in the init's `notes.md` and committed
with the init by `save`. `grind note add <file> <start> [end] <comment|->` records a
note with the init owning the file's branch, wherever that branch is checked out;
`--init` selects the init when no init or several own the branch. Each note is a
heading with a short ID and a repository-qualified reference, the anchor line, and
the comment:

```markdown
## n3 @audio/rytho:app/frontend/src/navigation.ts#40-52
> const routes = buildRoutes(config);

Extract this into the router module.
```

`grind note list [init] --json` serves editor integrations and includes each file's
path in the init's current checkout. Context loading surfaces notes without
processing them. Handle them when the user asks or before resuming execution,
respecting the user's current instruction:

1. Read them all before changing anything.
2. For each note, confirm that the anchor line still falls inside the
   referenced range; if it has moved, find it by content and use the current
   position.
3. Treat a comment as an instruction and a question as a question: answer it
   in the chat instead of changing code.
4. Work through the notes from the bottom up, so line numbers above stay valid
   while notes are still being handled.
5. Resolve each note once it is handled, with `grind note done <id>` or by deleting
   it from `notes.md`. Leave a note in place when handling it needs a decision from
   the user, and say so in the chat.
6. Report in the chat, per note, what was done.

A note that changes a decision or reveals something is recorded in the ledger,
as any decision or discovery would be. An ordinary save commits prepared initiative
artifacts; it does not automatically commit unfinished application code.


## Session-start protocol

Use `/grind:context` when the user requests context or a task needs initiative
context that is not already loaded. Optional plugin hooks run only when the nearest
workspace sets `contextOnSessionStart: true`; host trust is a separate prerequisite.
Automatic discovery describes directory association, not conversation selection.
An explicit user selection takes precedence. Do not reload every turn.

### Context loading

Run the matching plugin CLI's `context [initiative] --json`, with `--workspace`
when needed. It resolves the init, assembles intent and ledger without summarizing,
extracts mandatory index sections, and reports where each recorded branch is checked
out, HEAD commits, review notes, lifecycle operations, and diagnostics. `complete: false`
requires resolving missing or malformed context before substantive work. Code and
Git remain authoritative over recorded prose.

Report the selected init, discrepancies, candidate next action, and unresolved
decisions. Load detailed specs and plans for the chosen topic, not merely because
the ledger mentions them. Context alone does not fetch, create worktrees, switch
branches, reopen, process notes, save a checkpoint, or execute the next action.
Closed inits remain readable. Their repository tracking is historical and does not
block an open init using the same branch. Reopening requires that no open init owns
the tracked branches.

A hook supplies complete context when it fits its output budget; otherwise it
supplies only the init's actual status and a command to load context if needed.
It writes no temporary context or session-tracking files. A notice is not loaded
context. Hooks do not override the user's selected init on resume or compaction.
The host retains conversation selection; Grind maintains no separate session state.

Absent automatic discovery is quiet. Ambiguity and malformed state are surfaced
rather than guessed. Explicit invocation
without a resolvable init lists candidates and lets the user choose; when exactly
one candidate exists the skill may select it. No records are migrated during reads.

### Prepare an initiative

`/grind:start <init> [task]` is the entry for "let's work on init X". It accepts a
unique fragment of the init ID and offers a choice of open inits without one.

1. Load context, including roadmap position and review notes.
2. If the init is closed, ask whether to reopen it. Reopen by editing the ledger:
   set `grind.status: open`, restore `phase`, `current_task`, and `next_action`
   from `grind.resume`, remove `grind.closed`, `grind.result`, and `grind.resume`,
   and record the reopening under Lifecycle history. Save validates the result.
3. For each repository with a recorded branch, get the working path from
   `grind worktree`. If the user holds the branch in the canonical checkout, say so
   and ask whether to work there or wait. An init with no recorded branch gets no
   branch or worktree until implementation needs one.
4. Report the working path, the branch's state against its remote, review notes,
   discrepancies, and the next action.
5. Carry out an accompanying task in the worktree. Otherwise ask what the user
   wants to do and wait; the ledger's next action is context, not an instruction
   to execute. Do not process review notes or begin substantive work on a bare start.

A substantive request accompanying context loading authorizes that requested work,
not automatic execution of a different recorded task or unrelated checkout changes.
Apply the normal work and checkpoint protocols to work actually performed.

## During-work update policy

Update the ledger when a meaningful milestone occurs, including:

- a planned phase or substantial task is completed
- a significant technical decision is made
- investigation reveals a fact that changes or constrains the work
- repository reality contradicts the plan or specification
- a blocker, dependency, or important open question appears or is resolved
- branch, worktree, test, migration, deployment, or rollout state changes materially

Do not update it for routine commands, minor edits, or every conversational
turn. The aim is a useful checkpoint, not an activity log.

Update the relevant plan when execution strategy changes. Update its specification when the
agreed behaviour or technical solution changes. Update `intent.md` only when
purpose or scope changes. Apply Choosing what to preserve before creating another
artifact; agreement or a working sequence alone does not require a document. Keep
technical decisions and execution detail out of `intent.md`. Reference snapshots
remain unchanged; link corrections or successors as described above.

## Session-end protocol

Before yielding control after meaningful work:

1. Inspect repository and Git state again.
2. Run proportionate validation or record what remains unverified.
3. Rewrite ledger working state and update frontmatter with the current state
   and concrete next action. Remove stale observations and duplicated history;
   retain relevant evidence and unresolved questions. Update indexes if navigation
   changed.
4. Put durable decisions in their authoritative documents. Retain a brief rationale
   or evidence reference in the ledger only when it helps future work.
5. Correct affected plans, specifications, or `intent.md` if their corresponding truths
   changed.
6. Commit the initiative folder in the state repository, naming the initiative
   and the milestone in the message.
7. Ensure a fresh agent with no conversation history can resume from the files
   alone.

No ledger update or commit is needed when the session produced nothing useful
to preserve.

## Closing an initiative

When the outcome is delivered, or the work is deliberately dropped:

1. Review initiative assets for durable knowledge that is not obvious from the code
   itself, such as rationale, external constraints, or operational caveats. Distill
   useful material into documentation in the relevant repository, checking it against
   the actual repository state. Decide placement, format, and structure at closeout from each
   repository's documentation conventions; this protocol does not prescribe them.
   Avoid copying assets wholesale, restating code, or preserving superseded proposals
   as current guidance. If nothing qualifies, no documentation change is needed.
   Deliver any documentation changes through the repository's normal workflow before
   finalizing closure, respecting existing authorization for external actions.
2. Confirm every pull request in `grind.repositories` is merged or abandoned, and say
   which in the ledger.
3. Prepare a valid checkpoint. Handle every review note, or choose the explicit
   parked disposition to keep the remaining notes in `notes.md`.
4. Run `grind close` with delivered or abandoned outcome, result location, and note
   disposition. The CLI records the prior execution checkpoint in lifecycle history
   and commits only the initiative state.

The folder stays where it is. A closed initiative can bounce back through QA
feedback or a production regression; reopen it as described in Prepare an
initiative.

## Archiving

An initiative closed for more than 60 days is archived with `grind archive`: moved
to `initiatives/_archive/<scope>/<name>/`, keeping its scope path, and committed.
Pending operations, unresolved notes, missing repositories, destination collisions,
and any owned branch that is still checked out block archival.

Session-start inspection lists closed initiatives past the 60-day mark as ready
to archive. Context loading only reports them. Perform eligible moves during an
execution workflow, not merely because a session opened or context was requested.

An archived initiative is read-only history. Work that resumes on the same
subject is a new initiative whose `intent.md` links to the archived one, not a
move back out of `_archive/`.


## Operating rule

The files provide continuity; the code provides truth. Every agent begins by
validating the recorded checkpoint and ends by leaving a better one, committed,
when meaningful work occurred.
