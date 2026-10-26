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
specifications and plans, following [Choosing what to preserve](checkpoints.md#choosing-what-to-preserve). Link to them when
they exist.

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
