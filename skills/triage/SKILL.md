---
name: triage
description: Assess a project idea or request against open Grind inits and their actual progress, then propose placement and roadmap changes for user confirmation. Use when the user wants to capture work but has not decided which init should own it.
---

Read Creating an initiative, Choosing what to preserve, Roadmaps, and Execution
authorization and verification in the [shared protocol](../../docs/protocol.md).
Triage is read-only until the user confirms a concrete placement proposal. Invoking
this skill alone does not authorize adding to an init or creating one.

## Find a suitable owner

Establish the requested outcome and target project from the conversation. Ask only
when missing intent would materially affect placement. An automatic checkout
association does not select the init for this request.

Resolve the plugin root from this SKILL.md. Run
`node <plugin-root>/scripts/grind.mjs list [scope] --workspace <directory> --json`
to inventory candidates. Node.js 24+ and Git are required. Include relevant
cross-repository inits outside the project's scope folder when their outcomes may
cover the request. Use the [context workflow](../context/SKILL.md) with full scoped
IDs for plausible open candidates, then read relevant specifications and plans.
Resolve incomplete required context before proposing changes to an affected init.

Match intended outcomes, scope, constraints, and acceptance criteria, not just
keywords. Distinguish conceptual fit from whether the work should join the current
execution. Prefer an existing owner when the addition fits its outcome; propose a
new init for a separate outcome or a follow-up whose inclusion would disrupt
current delivery. Explain that tradeoff. Avoid duplicate inits and unnecessary
tracking for trivial work; if no init is warranted, explain why and let the user
decide whether to track it anyway.

Inspect relevant roadmaps and project navigation in the configured state directory;
a null association does not establish that no roadmap exists. Propose an existing
milestone only when the contribution fits. Leaving an init unassigned is valid.
Include any proposed roadmap creation or milestone restructuring in the decision.

## Assess actual progress

Use the ledger as a starting point, then check the relevant plan, code, tests, Git
state, and delivery evidence in proportion to the addition. Use checkout locations
reported by context or `git worktree list`; do not invoke start, create worktrees,
switch branches, or modify implementation merely to assess placement. If evidence
is unavailable or contradicts the ledger, state what is uncertain and how that
affects the recommendation. Do not infer completion from phase labels alone.

Determine where the addition belongs in the work and whether execution has passed
that point:

| Current state | Assess and propose |
|---|---|
| Not started | Scope compatibility and needed intent or acceptance-criteria updates. |
| Planning | Affected assumptions, decisions, specifications, and plan sections. |
| In progress; relevant work ahead | Placement in remaining work, dependencies, and validation changes. |
| In progress; relevant work underway or completed | Code, tests, decisions, and completed steps that need revisiting; rework and sequencing consequences versus a separate follow-up init. |
| Delivered; awaiting closure | Whether expanding the current scope is justified or a follow-up init is preferable; effects on delivery and closure. |

These are assessment categories, not new metadata values. Preserve valid prior
verification as evidence for its original scope; do not imply it verifies the new
requirement. Do not reopen closed inits or alter archived history during triage.

## Confirm the proposal

Before any writes, present the understood request, the recommended existing init
or proposed new init and scope, and the evidence supporting that choice. Explain
the relevant progress, affected records, proposed acceptance conditions, rework,
sequencing, and roadmap placement. State whether implementation is already
authorized separately. Make the consequences clear enough for the user to approve
the actual changes without reconstructing the investigation.

Ask the user to confirm this proposal and wait. Do not create an init, append a
backlog item, edit a plan, or save a checkpoint while confirmation is pending.
Confirmation of the same concrete proposal earlier in the conversation remains
valid; materially changed placement or consequences need a new decision.

## Apply the confirmed changes

Inspect the state repository's instructions and dirty/staged state, preserving
unrelated work. Recheck relevant progress if work has moved since the assessment;
return to the user if that materially changes the approved proposal.

For a new init, use the [create workflow](../create/SKILL.md) with the confirmed
outcome and repository scope. For an existing init, update the authoritative homes
of the approved changes: intent only for outcome or scope changes, specifications
for changed contracts, plans for changed sequencing, and the ledger for current
state, essential decisions, and the next concrete action. Reconcile affected
completion claims and identify work to revisit without erasing valid prior results.
Keep small additions in existing records; do not generate a full planning harness.

Apply only confirmed roadmap changes using the protocol's associations and ordinary
links. Check affected contexts, roadmap resolution, links, and diffs, then use the
[save workflow](../save/SKILL.md) for the checkpoint. Report the destination, changes,
checkpoint result, and remaining uncertainty. Placement confirmation authorizes
those record changes; begin implementation only when separately requested.
