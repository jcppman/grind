---
name: context
description: Load or refresh a Grind initiative from its identifier, initiative folder, or associated checkout. Use at session entry when Grind is configured or when the user requests initiative context; context alone is read-only.
---

Read the [shared operating protocol](../../docs/protocol.md), especially Context loading.
Resolve the plugin root from this SKILL.md's location. Invoke its matching CLI as
`node <plugin-root>/scripts/grind.mjs status [initiative] --json`, adding
`--workspace <directory>` when discovery cannot reach the workspace. Do not use a
global Grind installation. Node.js 24+ and Git are required.

Read the returned index, intent, ledger, shared constraints, and documents relevant
to the user's request or recorded next action. Inspect repository state and pending
notes. Report discrepancies, governing approval coverage, next action, and unresolved
decisions. Refresh with the same command when explicitly requested.

On automatic discovery, WORKSPACE_NOT_FOUND or INITIATIVE_UNRESOLVED with no stale
pointer is quiet and leaves ordinary work alone. For explicit selection, report
unresolved selection with a usable identifier or workspace hint; report ambiguity
and malformed state instead of guessing. Use `list --json` when identifiers are needed.

Context alone never executes the next action, fetches, switches branches, reopens,
repairs pointers, handles notes, or writes a checkpoint. Closed initiatives and
mismatched checkouts remain readable. If the user also requests work, use this
context for that work and follow the protocol's execution and checkpoint rules.
