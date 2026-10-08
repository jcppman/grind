---
name: coordinate
description: Coordinate work between Grind inits by adding a focused note to another init's ledger and returning a prompt the user can relay to its working session. Use for cross-init design, dependency, or implementation coordination; this does not send messages or start the receiving init's work.
---

Use the [context workflow](../context/SKILL.md) to resolve the source and receiving
inits and read their current decisions, progress, and relevant contracts. Reuse
complete context already loaded unless it needs refreshing. Ask only if the target
or requested coordination is ambiguous. Read-only comparisons do not authorize a
ledger edit; a request to coordinate through a ledger authorizes the note and prompt.

## Record the coordination

Keep the substantive design or finding in its authoritative source document. Update
that document first if the user's request includes capturing it. Do not create a
separate handoff file or duplicate the full design in the receiving ledger.

Inspect the state repository's instructions and dirty/staged state. Re-read the
receiving ledger immediately before editing, since its working session may have
updated it. Add or update a dated coordination section containing:

- The source init and a relative link to the exact authoritative section.
- The change or finding and why it affects the receiving init.
- What is agreed, what is proposed, and what the receiver should check or adjust.
- Relevant ownership, sequencing, and integration boundaries.

Keep the note proportionate. Preserve the receiver's working state, next action,
repository tracking, verification evidence, and unrelated edits. A coordination
note does not imply that the receiver accepted a proposal, implemented it, or must
stop its current work. Do not rewrite its contracts or lifecycle state unless the
user separately requested that change. Closed or archived targets require resolving
the appropriate active destination rather than silently reopening or editing history.

Check links and the diff, then follow the [save workflow](../save/SKILL.md) for each
changed init. Do not include another session's unsaved edits in your checkpoint:
if the scoped save would commit them, leave your note uncommitted and report that
limitation. Record the save result honestly; a written note is not a saved checkpoint.

## Return the relay prompt

Provide a concise, copyable prompt naming the receiving init, the coordination
section in its ledger, and the linked source design. Ask its working session to
check the proposal against current implementation, make appropriate adjustments
within the user's scope, and record conclusions or conflicts in its ledger. Direct
shared-design changes back to the authoritative source so the two records do not
drift. Include any specific integration question the receiver needs to resolve.

Report links to the changed records and checkpoint results alongside the prompt.
Return the prompt to the user; do not send it to another chat or external service
unless the user explicitly asks. Receiving a relay or coordination note alone does
not authorize sending a reply to another chat.
