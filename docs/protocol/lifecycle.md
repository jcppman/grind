# Closing and archiving

## Closing an initiative

When the outcome is delivered, or the work is deliberately dropped:

1. Review initiative assets for durable knowledge that is not obvious from the code
   itself, such as rationale, external constraints, or operational caveats. Distill
   useful material into documentation in the relevant repository, checking it against
   the actual repository state. Decide placement, format, and structure at closeout from each
   repository's documentation conventions; this protocol does not prescribe them.
   Avoid copying assets wholesale, restating code, or preserving superseded proposals
   as current guidance. If nothing qualifies, no documentation change is needed.
   Deliver any documentation changes through the repository's normal workflow before
   finalizing closure, respecting existing authorization for external actions.
2. For a delivered code outcome, verify that all required changes, including any
   closeout documentation, are integrated into each repository's remote default
   branch. Use a different final branch only when the user explicitly chose it.
   Check the actual resulting code and PR destination, accounting for squash or
   rebase merges; merged status or commit ancestry alone may be insufficient.
   Record the verified target branch and revision in the ledger. A merge into an
   intermediate epic or feature branch leaves the init open, even when another
   init owns final integration. An approved PR handoff may finish a run without
   closing the init. Keep release claims separate from source integration.
3. Confirm each tracked PR is merged or abandoned and record its disposition in
   the ledger. Abandoned required work cannot satisfy
   delivered closure; deliberate abandonment requires the user's decision and the
   abandoned outcome. Research-only inits close against their agreed non-code
   outcome. These checks do not authorize merging, publishing, or changing scope.
4. Prepare a valid checkpoint. Handle every review note, or choose the explicit
   parked disposition to keep the remaining notes in `notes.md`.
5. Run `grind close` with delivered or abandoned outcome, result location, and note
   disposition. The CLI records the prior execution checkpoint in lifecycle history
   and commits only the initiative state.

The folder stays where it is. A closed initiative can bounce back through QA
feedback or a production regression; reopen it as described in [Prepare an initiative](execution.md#prepare-an-initiative).

## Archiving

An initiative closed for more than 60 days is archived with `grind archive`: moved
to `initiatives/_archive/<scope>/<name>/`, keeping its scope path, and committed.
Pending operations, unresolved notes, missing repositories, destination collisions,
and any owned branch that is still checked out block archival.

Session-start inspection lists closed initiatives past the 60-day mark as ready
to archive. Context loading only reports them. Perform eligible moves during an
execution workflow, not merely because a session opened or context was requested.

An archived initiative is read-only history. Work that resumes on the same
subject is a new initiative whose `intent.md` links to the archived one, not a
move back out of `_archive/`.
