---
name: start
description: Enter execution on an existing Grind initiative and resume its recorded work, offering a choice list when the initiative is omitted. Use when the user requests starting or continuing an initiative, rather than context alone.
---

Load the [context workflow](../context/SKILL.md), then follow Enter execution in the
[shared operating protocol](../../docs/protocol.md). Resolve the plugin root from
this SKILL.md and run `node <plugin-root>/scripts/grind.mjs start [initiative] --json`
with `--workspace <directory>` if needed.

This release starts only open initiatives whose checkouts already match their
recorded branches. Stop on unsupported switches, reopening, or archival. Do not
simulate success with manual lifecycle changes. State the governing specification
and plan's approval coverage and whether unreviewed changes are substantive;
coverage alone does not block execution. Do not invent human approval events.

Surface and handle relevant review notes according to the protocol and current
user request. Reconcile observed state and resume the next action consistent with
the intended outcome. Use the [save workflow](../save/SKILL.md) at meaningful
checkpoints. An ordinary checkpoint does not commit application code.
