---
name: save
description: Prepare and persist a resumable Grind initiative checkpoint after meaningful work or on explicit request. Use for initiative records, not automatic commits of application code.
---

Read the ledger, During-work update, and Session-end sections of the
[shared operating protocol](../../docs/protocol.md). Inspect current repository state and
validation evidence. Rewrite current state, remove superseded observations and
duplicate history, and retain relevant verification references and open questions.
Preserve parked notes and lifecycle recovery records. Record a concrete candidate
next task, not routine workflow instructions;
update other artifacts only when their corresponding facts changed. Keep artifact
content paths workspace-relative. Reading context alone earns no checkpoint.

Resolve the plugin root from this SKILL.md and run
`node <plugin-root>/scripts/grind.mjs save [initiative] --message <milestone> --json`,
with `--workspace <directory>` if needed. Report the returned commit or no-op.
Do not stage unrelated work, reset an index, push, or retry failed commits blindly.
A failed commit preserves staged changes: inspect and resolve that state before
retrying. A pending lifecycle journal must be resumed with its original start, close,
or archive command before saving. Verify a lock owner has exited before removing its
lock directory.
