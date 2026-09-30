---
name: housekeeping
description: Reconcile Grind roadmaps and inits, audit stale status and completed work, and organize milestone contributions. Use for requested Grind housekeeping, roadmap/init consistency checks, or initiative cleanup. An audit-only request produces findings without changing records.
---

Read the Roadmaps, Choosing what to preserve, and Execution authorization and
verification sections of the [shared protocol](../../docs/protocol.md). Use the
[context workflow](../context/SKILL.md) to inspect inits and the
[save workflow](../save/SKILL.md) for meaningful record changes.

## Establish scope and evidence

Use the project, roadmap, or inits named by the user. Infer a project from the
conversation when clear; an automatic checkout association does not select the
scope. Inspect the state repository's instructions and dirty/staged state before
editing, and preserve unrelated changes.

Resolve the plugin root from this file. Run
`node <plugin-root>/scripts/grind.mjs list [scope] --workspace <directory> --json`
to inventory open and closed inits. Read the roadmap, linked inits, and relevant
unlinked inits in the chosen scope. A null roadmap association does not establish
that no roadmap exists: inspect the configured state directory for Roadmap
documents and project navigation. Use full scoped IDs for context calls; resolve
incomplete required context before changing the affected init.

Inspect product source, Git ancestry, PR disposition, release artifacts, or test
evidence where needed to check a delivery claim. Use the applicable GitHub
identity rules. Distinguish implementation, merge into an epic, merge into the
default branch, and published/accepted delivery. A merged PR does not by itself
complete every outcome in its init. Keep verification tied to its revision and
environment; unavailable evidence means unverified, not completed or abandoned.

## Reconcile roadmap and inits

Check both directions:

- Substantial inits have a sensible roadmap placement or an explicit reason to
  remain unassigned; roadmap goals have an owning init or remain clearly future ideas.
- Milestone contributions agree with init purpose, scope, dependencies, priorities,
  and success criteria. Optional work must not become a requirement through wording
  drift, and partial contributions must not imply whole-init completion.
- Roadmap IDs, associations, links, and navigation resolve without conflicting
  ownership or duplicate inits for the same outcome.
- Ledgers and plans agree about current state and next actions; completed
  dependencies no longer leave work blocked, and remaining work has a clear owner.
- Detailed research, prompts, technical choices, and acceptance criteria live in
  the relevant init, with only their strategic implication and a link in the roadmap.

Follow the protocol's ordinary milestone headings and links; do not introduce new
metadata or tooling to perform routine housekeeping.

Resolve factual discrepancies when evidence establishes the correction. Resolve
intent from explicit user decisions and their scope. Neither a newer timestamp,
the roadmap's broader scope, nor shipped code automatically overrides an agreed
product requirement. Label proposals and dated observations accordingly.

When conflicting views cannot be resolved, ask the user. Cite the conflicting
documents or passages, explain the practical consequence, state what evidence is
missing, and ask a focused question about the intended outcome or priority.
Offer a recommendation only when supported. Preserve both positions as an
unresolved decision in the relevant init when editing is authorized; do not
silently select one, rewrite success criteria to fit delivery, or close affected
work. Continue independent housekeeping while that decision is pending.

## Apply proportionate cleanup

For an audit-only request, report findings and suggested changes. For requested
housekeeping, make evidence-backed record corrections within scope. Reuse existing
inits; use the [create workflow](../create/SKILL.md) when the user has authorized
tracking uncovered goals. Avoid splitting every roadmap bullet into its own init.

Use the [close workflow](../close/SKILL.md) for outcomes verified complete when
closure is in scope. Preserve unresolved limitations and transfer legitimate
follow-ups to an existing or authorized new owner without weakening completion
criteria. Lack of activity is not abandonment; closing abandoned work requires a
user decision. Do not archive, delete worktrees, switch branches, implement product
fixes, merge PRs, or publish releases merely to make records look complete.

Review initiative assets before closure. Retire obsolete execution instructions
and ad hoc helpers only after preserving useful decisions and evidence. Keep dated
Reference documents intact and do not rewrite historical evidence as a current
claim. Correct malformed tracking from observed checkout facts without assigning
unrelated current branches or changing checkout ownership.

## Verify and hand off

Check affected contexts and roadmap resolution, local links, and diffs. Confirm
that each closed outcome meets its actual delivery boundary and that any remaining
contribution is represented. Record unresolved decisions with a useful next action,
not an invented answer. Save scoped checkpoints using the normal Grind workflows;
follow repository rules for commits and pushes without staging unrelated work.

Report the meaningful corrections, closures and their evidence, remaining questions,
and verification limits. Distinguish source delivery from publication. Include the
checkpoint result and any changes still uncommitted; do not imply a complete audit
when access or unresolved intent limited it.
