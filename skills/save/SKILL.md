---
name: save
description: Prepare and persist a resumable Grind init (initiative) checkpoint after meaningful work or on explicit request. Use for initiative records, not automatic commits of application code.
---

Read Choosing what to preserve, Verification records and external workflows, the ledger,
During-work update, and Session-end sections of the [shared operating protocol](../../docs/protocol.md). Inspect current repository state and
validation evidence. Rewrite current state, remove superseded observations and
duplicate history, and retain relevant verification references and open questions.
Reconcile frontmatter, working state, and verification as one checkpoint; identify
which revision each retained result covers. Check relevant external facts when they
change, and label unavailable verification. Apply the protocol's evidence retention
rules even when another workflow supplies the checkpoint requirements.
Preserve parked notes and lifecycle recovery records. Record a concrete candidate
next task, not routine workflow instructions;
update other artifacts only when their corresponding facts changed. Preserve
Reference snapshots and follow the protocol’s Reference documents section for
corrections or successors. Keep artifact content paths workspace-relative. Reading context alone earns no checkpoint.

Resolve the plugin root from this SKILL.md and run
`node <plugin-root>/scripts/grind.mjs save [initiative] --message <milestone> --json`,
with `--workspace <directory>` if needed. Report the returned commit or no-op.
Do not stage unrelated work, reset an index, push, or retry failed commits blindly.
A failed commit preserves staged changes: inspect and resolve that state before
retrying. A pending lifecycle journal must be resumed with its original start, close,
or archive command before saving. Verify a lock owner has exited before removing its
lock directory.
