---
name: context
description: Load or refresh a Grind init (initiative) from its identifier, initiative folder, associated checkout, or a choice list when omitted. Use at session entry when Grind is configured or when the user requests init or initiative context; context alone is read-only.
---

Resolve the plugin root from this SKILL.md's location. Run
`node <plugin-root>/scripts/grind.mjs context [initiative] --json`, adding
`--workspace <directory>` when discovery cannot reach the workspace. Use the full
scoped identifier. Do not use a global Grind installation. Node.js 24+ and Git
are required.

The result includes intent, ledger, required constraints, observed Git state,
note locations, navigation, and entry rules. Do not reread these sources or the
full protocol merely to load context. If `complete` is false, explain diagnostics
and resolve missing required context before substantive work. Observations do not
verify arbitrary claims in ledger prose.

Give a concise orientation naming the selected init and workspace, discrepancies,
candidate next action, and unresolved decisions. An automatic hook describes
directory association only; an init explicitly chosen by the user takes precedence.
When the hook already supplied complete context for the requested init, use it
without another call unless a refresh is needed. A notice alone is not loaded
context: run this command for the user's task when needed.

Load detailed specifications, plans, and operation-specific guidance only when
needed for the chosen task. The next action alone does not trigger those reads.
Use **init** as the conversational short name for initiative.

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
context for that work; load the relevant specification and plan before changing
behavior, inspect pending notes before implementation, and use the save skill at
meaningful checkpoints.
