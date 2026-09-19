---
name: close
description: Close or archive a Grind init (initiative) after verifying its outcome, checkpoint, notes, and repository state. Use when work is delivered, abandoned, or ready for retention archival.
---

Load the [context workflow](../context/SKILL.md), then follow Closing an initiative
in the [shared operating protocol](../../docs/protocol.md). Confirm the outcome and
result location from the work itself. Complete the protocol's asset review and any
resulting repository documentation work before final closure checks. Prepare a valid
checkpoint and decide whether all review notes are handled or must be durably parked.

Resolve the plugin root from this SKILL.md and run
`node <plugin-root>/scripts/grind.mjs close [initiative] --outcome <delivered|abandoned> --result <location-or-summary> --notes <handled|parked> --json`,
adding `--workspace <directory>` when needed. Close never commits application code,
switches branches, or deletes checkouts. If a close operation is pending, retry the
same command after resolving the reported failure so its journal can finish.

For retention archival, run
`node <plugin-root>/scripts/grind.mjs archive [initiative] --json`. Archive is allowed
only after more than 60 days, with no unresolved notes or pending operation, and when
none of the initiative's owned branches is checked out in any linked worktree. Do not
switch or delete worktrees merely to make it eligible. Archived work is read-only;
resume the subject through a new linked initiative.
