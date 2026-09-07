# Grind operating protocol

This protocol governs initiative work. During bootstrap, perform the documented
steps manually where the CLI is unavailable; never claim an unavailable command
ran. Agent-specific packaging exposes this shared protocol and its workflows.

## Discover the initiative

Find the nearest enclosing `grind-workspace.config`. Its directory is the workspace
root and its `stateRepository` path resolves relative to that directory. For an
external state repository, require an explicit workspace path. Do not guess.

An initiative is a folder containing `intent.md` beneath the state repository's
`initiatives/` directory. Resolve it from the explicit request, initiative working
directory, or verified checkout `.initiative.md` pointer. Verify pointers against
the checkout's current branch and the initiative's Tracking table. Repository and
Git state take precedence over recorded state. Small unrelated work needs no initiative.

## Artifact responsibilities

- `intent.md`: purpose, outcome, scope, constraints, and success criteria.
- `spec.md`: agreed behavior and meaningful technical design, when needed.
- `plan.md`: milestone sequence, dependencies, and verification, when needed.
- `ledger.md`: verified current state, durable decisions, and the exact next action.

Keep mutable resume information current and concise. Preserve meaningful decisions,
discoveries, and completed milestones as history. Update each artifact only when
its corresponding truth changes. Do not create separate handoff documents.

## Start

Read the initiative artifacts. Inspect tracked repositories, branches, diffs, and
recent commits. Check pending review notes before resuming the recorded next action.
Reconcile stale records with reality and confirm the next action still follows
from the intent and specification.

An explicit initiative start may require switching tracked canonical clones. A
session entering through one checkout does not automatically switch other clones.
Until safe switching is implemented, report a branch mismatch and stop before
changing branches. Never discard or stash work to make progress.

## Work

Use canonical clones for attended work. Use worktrees only for work explicitly
declared unattended, fetching before creating a branch from the remote default.
Scale planning and review to uncertainty and risk. Obtain agreement before costly
implementation when the direction could materially change. Test meaningful logic
and verify behavior; avoid tests that merely repeat framework wiring.

Update the ledger at meaningful milestones, decisions, discoveries, blockers, or
material repository-state changes. Routine commands do not need ledger entries.

## Review notes

The checkout's `.initiative.md` is an ignored pointer and review inbox, never a
committed record. Read all notes before edits, verify referenced code using the
anchor text, and handle notes from bottom to top. Answer questions in the chat.
Remove handled notes; preserve unresolved notes and report what needs a decision.
Record durable decisions or discoveries in the ledger.

## Save and end

Inspect Git state and run proportionate validation, or record what remains
unverified. Replace stale resume information with the current task, working state,
and one concrete next action. Update other artifacts if their truths changed.
Commit only the initiative's prepared artifacts in the state repository.

An ordinary save does not commit unfinished application code. A fresh agent must
be able to resume from the artifacts and repositories without conversation history.
No checkpoint is necessary when nothing useful changed.

## Close

Confirm tracked pull requests are merged or abandoned and record their disposition.
Remove initiative worktrees safely, mark the ledger closed with a date and delivered
or abandoned outcome, and point its resume section to the result. Commit the state.
Starting closed, unarchived work reopens it and preserves the prior closure in history.
Archived initiatives are read-only; renewed work creates a linked new initiative.

## Responsibility boundaries

Skills supply judgment and prepare artifacts. The CLI performs deterministic
validation and filesystem/Git operations. Agent adapters supply discovery,
invocation, packaging, and optional reminders. They hold no unique initiative state.
