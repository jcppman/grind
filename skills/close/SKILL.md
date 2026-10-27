---
name: close
description: Close or archive a Grind init (initiative) after verifying its outcome, checkpoint, notes, and repository state. Use when work is delivered, abandoned, or ready for retention archival.
---

Load the [context workflow](../context/SKILL.md), then follow Closing an initiative
in [closing and archiving](../../docs/protocol/lifecycle.md). Confirm the outcome and
result location from the work itself. Complete the protocol's asset review and any
resulting repository documentation work before final closure checks. Prepare a valid
checkpoint and decide whether all review notes in `notes.md` are handled or stay
there as parked notes. For delivered code, verify the resulting changes in each
remote default branch, or the final branch explicitly chosen by the user, and record
that branch and revision. An intermediate-branch merge or PR handoff leaves the init
open. Research and deliberate abandonment follow their distinct outcome criteria
in the protocol; closure does not authorize merges or releases.

Apply the protocol's manual verification gate before delivered closure. When
`grind.need_verify` is true, leave the init open until the user explicitly confirms
local verification of the current outcome. Automated checks or a request to close
do not count as that confirmation.

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
