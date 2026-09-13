# Grind operating protocol

This document owns the instructions for an agent carrying out initiative work.
The CLI implements deterministic mechanics; skills apply judgment using this
protocol. Follow the available command's documented capabilities and stop when a
required operation is unavailable. Initiative-specific limitations and temporary
manual procedures belong in that initiative's ledger and plan.

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
├── milestone or phase: meaningful stage
├── ticket: trackable unit of responsibility
├── task: concrete implementation work
└── commit or pull request: delivery and review unit
```

An initiative starts the moment an idea is worth writing down. `grind create`
creates `index.md`, `intent.md`, and `ledger.md`; specifications, plans, and
supporting artifacts appear as the work earns them.


## Initiative artifacts

`index.md`, `intent.md`, and one `ledger.md` are required at the initiative root.
`intent.md` remains the discovery marker. Specifications and plans may use any
filename and split by milestone or another coherent decision scope. Nested indexes
organize documents; they do not create nested initiatives.

| Type | Question it answers |
|---|---|
| `Initiative Intent` | Why are we doing this, and what outcome do we want? |
| `Specification` | What behaviour and technical solution are proposed or agreed? |
| `Implementation Plan` | In what order will we implement and verify it? |
| `Initiative Ledger` | What is true now, and exactly where should work continue? |

### Index and document scope

`index.md` links to authoritative documents and explains each one's scope. It
identifies shared constraints to read on every context load and links to optional
nested indexes. Keep it current when documents are added, moved, or removed. It
contains navigation, not duplicated status or checkpoint information.

A top-level specification owns shared contracts; milestone specifications reference
them and own their local contracts. A top-level plan owns milestone sequencing and
dependencies; milestone plans own execution detail. Each rule has one authoritative
home. Split documents when separate decision scopes or reading needs justify it,
not to prepopulate a roadmap. Link visual designs, research, schemas, and other
supporting artifacts, explaining whether they are authoritative or exploratory.

### Paths in artifacts

Describe filesystem locations in artifact content relative to the workspace root,
using `.` for the root itself. For example, write `grind` and
`yyu-dev/grind-state`, not machine-specific absolute paths or home-directory paths.
This keeps records portable across checkouts and machines. Markdown link targets
remain relative to the containing document so they resolve normally. Structured
fields retain their explicitly defined bases, such as initiative-relative worktree
paths and repository-relative approval paths; do not change their interpretation.

### Frontmatter and interoperability

Every non-index Markdown artifact has YAML frontmatter with a nonempty `type`.
Use the four canonical types above for core roles. Supporting documents may use
other descriptive types, such as `Visual Design` or `Research`; readers tolerate
unknown types. Non-Markdown assets are linked resources. Filenames and paths do
not determine the role of a specification or plan.

Use standard OKF fields for document metadata: optional `title`, `description`,
`tags`, `sources`, `generated`, `verified`, and document maturity `status`.
Grind workflow fields belong under `grind`. Move structured facts into frontmatter
rather than retaining a second authoritative copy in the body. The ledger owns
initiative status, phase, current task, next action, and repository tracking;
other documents must not duplicate those fields.

Keep explanations and durable history in Markdown. Preserve unknown frontmatter
keys and unrelated content during edits. Existing artifacts without frontmatter
remain readable during migration; report missing metadata and migrate explicitly,
never during context loading. Malformed optional metadata is diagnostic; malformed
required Grind state prevents a mutating operation. A save does not normalize
metadata or imply approval or verification.

Indexes contain navigation without frontmatter, except that a bundle-root index
may declare `okf_version`. This protocol does not yet declare the entire state tree
an OKF bundle: its boundary, auxiliary Markdown, and disposable worktree exclusions
must be defined before claiming full bundle compatibility.

### Document approval and verification

Approval is optional and records explicit human agreement to a document's proposed
direction or contract. Do not infer it from `type`, document maturity, a save, or
factual verification. Do not require approval for routine plans or ledger updates.
Split a document by coherent decision scope when parts need independent approval;
partial agreement does not approve an entire document.

Record document approval under `grind.approvals`, identifying the human, time,
and exact previously committed document revision and path. The reviewed revision
precedes the commit recording approval, avoiding a self-referential commit hash.
Preserve historical approvals after edits. Report changes since the approved
revision; the agent explains whether substantive changes need renewed agreement.
A changed revision alone is not an automatic execution block. Unavailable revision
history means approval coverage cannot be established, not that it is current.

`verified` records checking claims against evidence; it does not authorize
implementation. Generation describes meaningful content production, not every save.
Neither an earlier approval nor a verification event automatically covers later
content. Do not invent human identities, approval events, or verification evidence.

### `intent.md`

Defines the enduring reason for the work:

- problem and desired outcome
- scope and non-goals
- users or systems affected
- outcome-level success criteria
- constraints that acceptable solutions must satisfy
- related tickets, when they are sources of business context

Change it only when the purpose or scope changes. Describe the outcome without
summarising the feature list or prescribing implementation choices. Technical
design belongs in specifications; execution sequence and validation exercises belong
in plans. Link to them when they exist.

### Specifications

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

Defines the execution strategy:

- phases, milestones, and dependencies
- repositories and major areas involved
- validation strategy
- sequencing and rollout considerations
- ticket-to-milestone or ticket-to-repository mapping, when useful

Update it when the implementation strategy materially changes.

A plan identifies outcomes, affected repositories and likely areas,
constraints, dependencies, risks, edge cases, and verification. It does not
redefine the solution or contain complete implementation code. Put contracts,
schemas, and design details in specifications; the plan may link to them and name the
paths, commands, or checkpoints needed for execution. If code is already known
well enough to be written verbatim, implement and test it instead of placing it
in the plan.

### `ledger.md`

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
initiative folder or associated checkout. Accompany it with the current request;
use `/grind:start` to enter execution and resume work. No per-session handoff
document is written.


## Proportionate execution

Use the lightest process appropriate to the size, uncertainty, and risk of the
work.

### Small, localised work

State the design briefly, implement in the current session, test meaningful
logic, and perform one final review. Maintain initiative artifacts only when
the change belongs to an existing initiative.

### Ambiguous or consequential work

Clarify intent and constraints, compare viable approaches, and obtain approval
before costly implementation when the direction could materially change.
Update `intent.md` only if the chosen direction changes the intended outcome or
scope. Record agreed behaviour and technical design in a specification, creating it
at that point if it does not yet exist.

### Large or cross-repository work

Use the full artifact set, divide execution along independently verifiable
boundaries, and use parallel agents only for genuinely independent work that
has been declared unattended and given a worktree. Review specification
compliance and code quality, then perform end-to-end verification.

### Testing and debugging

Prefer red-green-refactor for branching, transformations, state transitions,
validation, boundary cases, and bug reproductions. Do not add elaborate tests
for trivial wiring or framework behaviour. During debugging, reproduce or
gather sufficient evidence, trace the cause, test the hypothesis, and only then
implement the fix.


## Reading review notes

Notes are the user's review of the working tree, written while the agent was
not looking. The agent reads them when the user says so, and checks every
clone and worktree in `grind.repositories` for pending notes during context loading.
Loading context surfaces notes without processing them. Handle them when the
user asks or before resuming execution, respecting the user's current instruction.

Processing the notes in a sidecar:

1. Read them all before changing anything.
2. For each note, confirm that the anchor line still falls inside the
   referenced range; if it has moved, find it by content and use the current
   position.
3. Treat a comment as an instruction and a question as a question: answer it
   in the chat instead of changing code.
4. Work through the notes from the bottom up, so line numbers above stay valid
   while notes are still being handled.
5. Delete each note once it is handled. Leave a note in place when handling it
   needs a decision from the user, and say so in the chat.
6. Report in the chat, per note, what was done.

A note that changes a decision or reveals something is recorded in the ledger,
as any decision or discovery would be. The sidecar itself is never a record
and is never committed. An ordinary save commits prepared initiative artifacts;
it does not automatically commit unfinished application code.


## Session-start protocol

Load context automatically before responding to substantive work when the session
begins inside an initiative folder or an associated checkout. Use the same shared
workflow as `/grind:context [initiative]`. Explicit invocation also selects an
initiative or refreshes context after external changes. Do not reload every turn.

### Context loading

1. Resolve the workspace from the nearest `grind-workspace.json`, or an explicit
   workspace path outside that boundary. Resolve the initiative from an explicit
   identifier, its folder, or a verified checkout pointer. If the pointer disagrees
   with Git, derive ownership from unarchived repository tracking records without rewriting
   the pointer. Report ambiguity instead of selecting a guess.
2. Read `index.md`, `intent.md`, and `ledger.md`, then the shared constraints
   identified by the index. Follow links to specifications, plans, supporting
   artifacts, and approval records relevant to the request or recorded next action.
   Report missing links or conflicting ownership; do not silently skip constraints.
3. Inspect the tracked repositories, branches, diffs, and recent commits. Report
   missing checkouts and mismatches as observed state; do not change them.
4. Surface pending sidecar and parked review notes, the recorded next action, and
   unresolved decisions. Distinguish notes belonging to the current checkout's
   branch from the selected initiative when they differ.
5. Report material discrepancies and use the verified context for the user's
   accompanying request. A context-only invocation gives a concise orientation
   and waits for direction; it does not execute the ledger's next action.

Context loading is read-only: do not fetch, switch branches, reopen work, repair
pointers, process or remove notes, reconcile files, archive initiatives, or save a
checkpoint. A closed initiative can be read without reopening. With no initiative,
automatic discovery leaves ordinary work alone; an explicit context request reports
that none could be resolved. Reading files alone does not earn a ledger update.

### Enter execution

`/grind:start [initiative]` reuses context loading, then explicitly enters execution.
Preflight the tracked checkouts and use the CLI's supported switch/reopen mechanics.
Stop if the transition cannot be performed safely or is unavailable. Reinspect
state after a transition, handle relevant review notes, reconcile the ledger with
repository reality, and continue from a next action that still follows from the
intent, specification, and current user instructions.

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
purpose or scope changes. Create a specification as soon as behaviour, contracts, or
technical design need to be agreed and preserved; create a plan as soon as
execution requires meaningful sequencing. Do not stage either kind of content
inside `intent.md`.

## Session-end protocol

Before yielding control after meaningful work:

1. Inspect repository and Git state again.
2. Run proportionate validation or record what remains unverified.
3. Update the ledger frontmatter and working-state narrative with the exact
   current state and next action. Update indexes if document organization changed.
4. Append durable decisions, discoveries, completed milestones, and open
   questions.
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

1. Confirm every pull request in `grind.repositories` is merged or abandoned, and say
   which in the ledger.
2. Remove any worktrees with `git worktree remove` from their repositories and
   delete the `worktrees/` folder. Clones may stay on the initiative's branch
   until the next switch-in moves them.
3. Set `grind.status: closed` and `grind.closed` with the date and outcome.
   Replace the open execution fields with `grind.result` saying where the result lives.
4. Commit.

The folder stays where it is. A closed initiative can bounce back through QA
feedback or a production regression. Running `grind start` on an unarchived
closed initiative sets `grind.status: open`, moves the prior `grind.closed` and
result into durable ledger history, restores execution fields, and then follows
the normal start protocol.

## Archiving

An initiative closed for more than 60 days is archived: moved with `git mv` to
`initiatives/_archive/<scope>/<name>/`, keeping its scope path, and committed.
Archiving earlier by hand is always allowed.

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
