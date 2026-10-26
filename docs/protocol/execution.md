# Execution

### Checkouts and worktrees

The canonical checkout of a repository belongs to the user. Agents do not change
its branch unless the user asks. Unless the user already authorizes work on the
target branch in the canonical checkout, agents work in worktrees at
`<workspace>/.worktrees/<repository path>/<init name>`, where the init name is the
last segment of its ID.

An init's work lives wherever its recorded branch is checked out: the canonical
checkout, a Grind worktree, an app-managed worktree, or nowhere. Run
`grind worktree <init> [--repo <repository>]` to get that path; it creates the
standard worktree when the branch is not checked out. When the branch is in the
canonical checkout, the command returns `CHECKOUT_HELD` with its path. Check the
current branch and dirty/staged state there. If the user's instructions already
authorize work there and existing edits belong to the task, continue at that path.
Otherwise ask how to proceed, preserving unrelated edits. Do not create a detached
substitute, switch branches, or stash the user's work to bypass the held branch.
Look the path up again before resuming after any pause, because the user may have
moved the work.

`grind worktree` also links each `CLAUDE.md` and `AGENTS.md` between the
workspace root and the canonical checkout into the matching folder under
`.worktrees`, so worktrees receive the same directory-scoped instructions. It
leaves correct links alone and reports, rather than replaces, a file in the way.

`grind switch <init>` is the user's command for bringing an init into the canonical
checkout. It saves the current work in a labelled stash and moves it to its owning
init's standard worktree; it takes the target branch from its worktree after
stashing that worktree's changes. The worktree it takes a branch from is detached and
left in place with its ignored files, such as `.env` and dependencies, and is
reused when the work moves back. Ignored files in the canonical checkout do not move. Switch refuses an in-progress Git operation, uncommitted
changes on a branch no init owns, a process working inside the target worktree, and,
without `--force`, a worktree changed in the last few minutes. On failure it
reports each remaining stash and how to restore it. Agents run switch only when the
user asks. Without an argument, switch lists the repository's inits and where each
is checked out; `grind status` inside a repository also names the init owning its
current branch.

## Proportionate execution

Use the lightest process appropriate to the size, uncertainty, and risk of the
work.

### Small, localised work

State the design briefly, implement in the current session, test meaningful
logic, and perform one final review. Maintain initiative artifacts only when
the change belongs to an existing initiative.

### Ambiguous or consequential work

Clarify intent and constraints and compare viable approaches before costly
implementation when the direction could materially change. Proceed when the user's
instruction selects or accepts a direction.
Update `intent.md` only if the chosen direction changes the intended outcome or
scope. Preserve decisions and essential acceptance conditions using [Choosing what to preserve](checkpoints.md#choosing-what-to-preserve); create a specification only when a contract warrants its own reference.

### Large or cross-repository work

Choose artifacts by their durable value under [Choosing what to preserve](checkpoints.md#choosing-what-to-preserve). Divide
execution along independently verifiable boundaries, and use parallel agents only
for genuinely independent work that has been declared unattended and given a
worktree. Review applicable contracts and code quality, then perform end-to-end verification.

### Testing and debugging

Prefer red-green-refactor for branching, transformations, state transitions,
validation, boundary cases, and bug reproductions. Do not add elaborate tests
for trivial wiring or framework behaviour. During debugging, reproduce or
gather sufficient evidence, trace the cause, test the hypothesis, and only then
implement the fix.


## Reading review notes

Notes are the user's review of the code, kept in the init's `notes.md` and committed
with the init by `save`. `grind note add <file> <start> [end] <comment|->` records a
note with the init owning the file's branch, wherever that branch is checked out;
`--init` selects the init when no init or several own the branch. Each note is a
heading with a short ID and a repository-qualified reference, the anchor line, and
the comment:

```markdown
## n3 @audio/rytho:app/frontend/src/navigation.ts#40-52
> const routes = buildRoutes(config);

Extract this into the router module.
```

`grind note list [init] --json` serves editor integrations and includes each file's
path in the init's current checkout. Context loading surfaces notes without
processing them. Handle them when the user asks or before resuming execution,
respecting the user's current instruction:

1. Read them all before changing anything.
2. For each note, confirm that the anchor line still falls inside the
   referenced range; if it has moved, find it by content and use the current
   position.
3. Treat a comment as an instruction and a question as a question: answer it
   in the chat instead of changing code.
4. Work through the notes from the bottom up, so line numbers above stay valid
   while notes are still being handled.
5. Resolve each note once it is handled, with `grind note done <id>` or by deleting
   it from `notes.md`. Leave a note in place when handling it needs a decision from
   the user, and say so in the chat.
6. Report in the chat, per note, what was done.

A note that changes a decision or reveals something is recorded in the ledger,
as any decision or discovery would be. An ordinary save commits prepared initiative
artifacts; it does not automatically commit unfinished application code.


## Session-start protocol

Use `/grind:context` when the user requests context or a task needs initiative
context that is not already loaded. Context loading is explicit; the plugin has no
SessionStart hook. Directory association does not select the conversation’s init.
An explicit user selection takes precedence. Do not reload every turn.

### Context loading

Run the matching plugin CLI's `context [initiative] --json`, with `--workspace`
when needed. It resolves the init, assembles intent and ledger without summarizing,
extracts mandatory index sections, and reports where each recorded branch is checked
out, HEAD commits, review notes, lifecycle operations, and diagnostics. `complete: false`
requires resolving missing or malformed context before substantive work. Code and
Git remain authoritative over recorded prose.

Report the selected init, discrepancies, candidate next action, and unresolved
decisions. Load detailed specs and plans for the chosen topic, not merely because
the ledger mentions them. Context alone does not fetch, create worktrees, switch
branches, reopen, process notes, save a checkpoint, or execute the next action.
Closed inits remain readable. Their repository tracking is historical and does not
block an open init using the same branch. Reopening requires that no open init owns
the tracked branches.

Ambiguity and malformed state are surfaced
rather than guessed. Explicit invocation
without a resolvable init lists candidates and lets the user choose; when exactly
one candidate exists the skill may select it. No records are migrated during reads.

### Prepare an initiative

`/grind:start <init> [task]` is the entry for "let's work on init X". It accepts a
unique fragment of the init ID and offers a choice of open inits without one.

1. Load context, including roadmap position and review notes.
2. If the init is closed, ask whether to reopen it. Reopen by editing the ledger:
   set `grind.status: open`, restore `phase`, `current_task`, and `next_action`
   from `grind.resume`, remove `grind.closed`, `grind.result`, and `grind.resume`,
   and record the reopening under Lifecycle history. Save validates the result.
3. For each repository with a recorded branch, get the working path from
   `grind worktree`. Handle `CHECKOUT_HELD` under [Checkouts and worktrees](#checkouts-and-worktrees): inspect
   the returned path and existing authorization before asking again. An init with
   no recorded branch gets no branch or worktree until implementation needs one.
4. Report the working path, the branch's state against its remote, review notes,
   discrepancies, and the next action.
5. Carry out an accompanying task in the worktree. Otherwise ask what the user
   wants to do and wait; the ledger's next action is context, not an instruction
   to execute. Do not process review notes or begin substantive work on a bare start.

A substantive request accompanying context loading authorizes that requested work,
not automatic execution of a different recorded task or unrelated checkout changes.
Apply the normal work and checkpoint protocols to work actually performed.
