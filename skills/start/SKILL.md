---
name: start
description: Start or resume work on a Grind init (initiative) — the entry for "let's work on init X". Loads its context, finds or creates its worktree, and reports where to work. Accepts a unique fragment of the init ID and offers a choice list when omitted.
---

Load the [context workflow](../context/SKILL.md) for the init, then follow Prepare an
initiative in the [shared operating protocol](../../docs/protocol.md). Pass the user's
fragment as the identifier; the CLI resolves a unique fragment and reports ambiguity.

If the init is closed, ask whether to reopen it before anything else, and reopen it
by editing the ledger as the protocol describes.

Resolve the plugin root from this SKILL.md. For each repository with a recorded
branch, run
`node <plugin-root>/scripts/grind.mjs worktree <init> [--repo <repository>] --json`,
adding `--workspace <directory>` when needed. It prints the path where the init's
work lives and creates the standard worktree when the branch is not checked out.
`CHECKOUT_HELD` means the branch is in the user's canonical checkout: say so and ask
whether to work there or wait. Do not switch or stash the canonical checkout. An
init with no recorded branch gets no branch or worktree until implementation needs
one; then run `worktree` with `--repo`, which records a branch named after the init.

Report the working path, the branch's state against its remote (`git status -sb`
there), review notes, discrepancies, and the recorded next action. Do the work in the
reported path. If the user gave a task, carry it out within the current
specification, plan, ledger, and conversation. Otherwise ask what they want to do and
wait; the next action is never executed automatically and a bare start does not
authorize processing review notes.

Look the path up again with `worktree` before resuming after a pause; the user may
have moved the work with `grind switch`. Use the [save workflow](../save/SKILL.md) at
meaningful checkpoints. An ordinary checkpoint does not commit application code.
