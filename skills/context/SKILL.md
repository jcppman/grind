---
name: context
description: Load or refresh a Grind initiative from its identifier, initiative folder, associated checkout, or a choice list when omitted. Use at session entry when Grind is configured or when the user requests initiative context; context alone is read-only.
---

Read the Context loading section of the [shared operating protocol](../../docs/protocol.md#context-loading).
Resolve the plugin root from this SKILL.md's location. Invoke its matching CLI as
`node <plugin-root>/scripts/grind.mjs status [initiative] --json`, adding
`--workspace <directory>` when discovery cannot reach the workspace. Do not use a
global Grind installation. Node.js 24+ and Git are required.

Read the returned index, intent, ledger, and the specific shared constraint sections
identified by the index. Inspect repository state and pending notes, then give a
concise orientation with discrepancies, the candidate next action, and unresolved
decisions. Load detailed specifications, plans, and other protocol sections only
when needed for the user's chosen topic; the ledger's next action alone does not
trigger those reads. Refresh with the same command when explicitly requested.

On automatic discovery, WORKSPACE_NOT_FOUND or INITIATIVE_UNRESOLVED with no stale
pointer is quiet and leaves ordinary work alone. When the user explicitly invokes
this skill without an identifier, first try folder or checkout discovery. If no
initiative resolves, run `list --json`. Select the sole available initiative
directly; when several are available, show their identifiers and current tasks and
ask the user to choose with the platform's choice UI when available. Do not require
the user to retype a full identifier. Report ambiguity and malformed state instead
of guessing.

When an explicitly supplied identifier does not resolve, run `list --json` and offer
the same choice flow alongside the error and workspace hint.

Context alone never executes the next action, fetches, switches branches, reopens,
repairs pointers, handles notes, or writes a checkpoint. Closed initiatives and
mismatched checkouts remain readable. If the user also requests work, use this
context for that work and follow the protocol's execution and checkpoint rules.
