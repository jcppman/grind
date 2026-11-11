# Checkpoints

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

Do not record where a branch is checked out. Record the branch and its commit,
push, and PR state; Git owns the location, and `grind worktree` reports it. The user
can move work between checkouts with `grind switch`, which does not edit the ledger,
so a recorded location becomes wrong without notice.

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
session, context is loaded with `/grind:context`, which can resolve an init from its
folder or a checkout of one of its branches. Accompany it with the current
request; use `/grind:start` to prepare the initiative and choose what to do next. No per-session handoff
document is written.

## During-work update policy

Update the ledger when a meaningful milestone occurs, including:

- a planned phase or substantial task is completed
- a significant technical decision is made
- investigation reveals a fact that changes or constrains the work
- repository reality contradicts the plan or specification
- a blocker, dependency, or important open question appears or is resolved
- branch, test, migration, deployment, or rollout state changes materially

Do not update it for routine commands, minor edits, or every conversational
turn. The aim is a useful checkpoint, not an activity log.

Update the relevant plan when execution strategy changes. Update its specification when the
agreed behaviour or technical solution changes. Update `intent.md` only when
purpose or scope changes. Apply Choosing what to preserve before creating another
artifact; agreement or a working sequence alone does not require a document. Keep
technical decisions and execution detail out of `intent.md`. Reference snapshots
remain unchanged; follow [Reference documents](artifacts.md#reference-documents) for corrections or successors.

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
