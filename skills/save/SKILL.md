---
name: save
description: Prepare and persist a resumable Grind initiative checkpoint after meaningful work or on explicit request. Use for initiative records, not automatic commits of application code.
---

Read the [shared operating protocol](../../docs/protocol.md), particularly the
During-work update and Session-end protocols. Inspect current repository state and
validation evidence. Update the ledger with what is true and an exact next action;
update other artifacts only when their corresponding facts changed. Keep artifact
content paths workspace-relative. Reading context alone earns no checkpoint.

Resolve the plugin root from this SKILL.md and run
`node <plugin-root>/scripts/grind.mjs save [initiative] --message <milestone> --json`,
with `--workspace <directory>` if needed. Report the returned commit or no-op.
Do not stage unrelated work, reset an index, push, or retry failed commits blindly.
A failed commit preserves staged changes: inspect and resolve that state before
retrying. Verify a lock owner has exited before removing its lock directory.
