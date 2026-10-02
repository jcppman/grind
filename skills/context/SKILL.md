---
name: context
description: Load or refresh a Grind init (initiative) from its identifier or a unique fragment of it, its folder, a checkout of one of its branches, or a choice list when omitted. Use at session entry when Grind is configured or when the user requests init or initiative context; context alone is read-only.
---

Resolve the plugin root from this SKILL.md's location. Run
`node <plugin-root>/scripts/grind.mjs context [initiative] --json`, adding
`--workspace <directory>` when discovery cannot reach the workspace. Use the full
scoped identifier or a unique fragment of it. Do not use a global Grind installation. Node.js 24+ and Git
are required.

The result includes intent, ledger, required constraints, where each recorded
branch is checked out, review notes, navigation, resolved roadmaps, and entry rules. Roadmaps provide
planning context, not execution authorization; the root intent’s `grind.roadmap`
identifies the initiative association. Do not reread these sources or the
full protocol merely to load context. If `complete` is false, explain diagnostics
and resolve missing required context before substantive work. Observations do not
verify arbitrary claims in ledger prose.

When the user requests roadmap authoring or reorganization, read the Roadmaps
section of the [shared protocol](../../docs/protocol.md). Keep product direction
and cross-initiative priorities in the roadmap; route detailed decisions and
next actions to the initiative that owns the outcome.

Give a concise orientation naming the selected init and workspace, discrepancies,
candidate next action, and unresolved decisions. An automatic hook describes
directory association only; an init explicitly chosen by the user takes precedence.
When the hook already supplied complete context for the requested init, use it
without another call unless a refresh is needed. A notice alone is not loaded
context: run this command for the user's task when needed.

Load detailed specifications, plans, references, and operation-specific guidance
only when needed for the chosen task. The next action alone does not trigger those reads.
Treat Reference documents as dated evidence, not current requirements or execution
authorization. Use **init** as the conversational short name for initiative.

On automatic discovery, WORKSPACE_NOT_FOUND or INITIATIVE_UNRESOLVED is quiet and
leaves ordinary work alone. When the user explicitly invokes
this skill without an identifier, first try folder or checkout discovery. If no
initiative resolves, run `list --json`. Select the sole available initiative
directly; when several are available, show their identifiers and current tasks and
ask the user to choose with the platform's choice UI when available. Do not require
the user to retype a full identifier. Report ambiguity and malformed state instead
of guessing.

When an explicitly supplied identifier does not resolve, run `list --json` and offer
the same choice flow alongside the error and workspace hint.

Context alone never executes the next action, fetches, creates worktrees, switches
branches, reopens, handles notes, or writes a checkpoint. Closed initiatives remain
readable. If the user also requests work, use the [start workflow](../start/SKILL.md)
to find where the work lives; load any existing relevant specification and plan
before changing behavior, inspect review notes before implementation, and use the
save skill at meaningful checkpoints.
