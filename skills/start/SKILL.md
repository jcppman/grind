---
name: start
description: Enter execution on an existing Grind initiative and resume its recorded work, offering a choice list when the initiative is omitted. Use when the user requests starting or continuing an initiative, rather than context alone.
---

Load the [context workflow](../context/SKILL.md), then follow Enter execution in the
[shared operating protocol](../../docs/protocol.md). Resolve the plugin root from
this SKILL.md and run `node <plugin-root>/scripts/grind.mjs start [initiative] --json`
with `--workspace <directory>` if needed.

Start performs the complete preflight before changing any checkout. It may fetch,
park and restore notes, switch clean clones, repair pointers, resume a pending
operation, and reopen closed work after checkout preparation succeeds. Report a
blocker instead of committing, stashing, discarding, merging, pushing, deleting a
branch, or stealing a lock. A substantive user instruction to implement, continue,
or proceed authorizes work consistent with the current specification, plan, ledger,
and conversation. Discuss material changes in direction before taking them.

Surface and handle relevant review notes according to the protocol and current
user request. Reconcile observed state and resume the next action consistent with
the intended outcome. Use the [save workflow](../save/SKILL.md) at meaningful
checkpoints. An ordinary checkpoint does not commit application code.
