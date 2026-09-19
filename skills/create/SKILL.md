---
name: create
description: Create a Grind init (initiative) for a coherent development outcome and clarify its intent. Use when the user asks to create an init or initiative, or start tracking substantial work.
---

Read the [shared operating protocol](../../docs/protocol.md), especially Creating
an initiative. Clarify material uncertainty about intent before writing it; defer
unresolved design and execution choices as open questions rather than assumed
requirements. Choose a name and the narrowest workspace-relative folder containing
its repositories. Omit scope when no repository has been chosen.

Resolve the plugin root from this SKILL.md. Run
`node <plugin-root>/scripts/grind.mjs create <name> [--scope <folder>] --json`,
with `--workspace <directory>` if needed. Node.js 24+ and Git are required.
The CLI creates only index, intent, and ledger templates; it does not infer branch
ownership, create branches, or commit. Elaborate intent from the user's actual
request and keep the ledger resumable. Track only established initiative branches;
otherwise leave `grind.repositories` empty and name candidate repositories in the
working state. Defer new branches and worktrees until execution needs them.
Add specifications or plans only as needed.
Use the [save workflow](../save/SKILL.md) for the resulting checkpoint.

On a collision or incomplete creation, inspect the reported destination and preserve
its contents. A held lock requires verifying the owner has exited before manual
removal; do not retry in a loop or steal it.
