---
name: start
description: Prepare an existing Grind initiative for the session, then ask what the user wants to do. Offer a choice list when the initiative is omitted. Use when the user requests starting or switching into an initiative.
---

Load the [context workflow](../context/SKILL.md), then follow Prepare an initiative in the
[shared operating protocol](../../docs/protocol.md). Resolve the plugin root from
this SKILL.md and run `node <plugin-root>/scripts/grind.mjs start [initiative] --json`
with `--workspace <directory>` if needed.

Start performs the complete preflight before changing any checkout. It may fetch,
park and restore notes, switch clean clones, repair pointers, resume a pending
operation, and reopen closed work after checkout preparation succeeds. Report a
blocker instead of committing, stashing, discarding, merging, pushing, deleting a
branch, or stealing a lock.

Reinspect the checkout and surface relevant review notes, discrepancies, and the
recorded next action. A bare start prepares the initiative; it does not authorize
executing that action or processing review notes. Ask what the user would like to
do next and wait. The user may want to discuss the initiative.

If the user also gives a substantive task, carry out that task within the current
specification, plan, ledger, and conversation. Discuss material changes in direction
before taking them. Use the [save workflow](../save/SKILL.md) at meaningful
checkpoints. An ordinary checkpoint does not commit application code.
