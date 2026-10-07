# Grind

Grind is a vendor-neutral plugin and CLI for resumable development initiatives.
It separates shared workflow instructions, private initiative state, and application
repositories. Repository contents and Git state remain the final authority.

Call an initiative an **init** for short: “create an init for xxx,” “start this
init,” or “save this init.” Both names select the same workflows. For an explicit
command, use `/grind:create xxx`.

Read [the operating protocol](docs/protocol.md) for the workflow. Grind will ship
shared context, triage, coordinate, create, start, save, close, and housekeeping
skills with Codex and Claude Code plugin manifests. The CLI will own deterministic filesystem and Git mechanics.

Initiative artifacts belong in the workspace's configured private state repository,
not in this implementation repository. Find `grind-workspace.json` by walking
upward to the nearest enclosing workspace boundary.

## Status

Grind provides per-init worktrees, foreground switching of the canonical checkout,
review notes kept with each init, closure, retention archival, and scoped
checkpoint saves. The matching
compiled CLI and shared skills run in Codex and Claude Code from the same
relocatable package.

See [installation and recovery](docs/installation.md) for packaging, workspace
setup, terminal use, and opt-in session hooks.

`grind context [initiative]` assembles read-only context in one call. Enable
`contextOnSessionStart: true` in the workspace configuration for automatic hook
loading; it is disabled by default. Oversized contexts produce only an association
notice and a command to load the full context if needed.

Say "let's work on init X" or run `/grind:start X`: the agent loads the init's
context and works in its worktree at `.worktrees/<repository>/<init>`, leaving your
canonical checkout alone. From an initiative folder or a checkout of one of its
branches, Grind resolves the init automatically; elsewhere, invoke `/grind:context`
or `/grind:start` without an argument to choose one.

To take over an agent's work yourself, run `grind switch <init>` in the canonical
checkout. It moves your current work to its init's worktree and brings the target
branch to the foreground, keeping staged, unstaged, and untracked changes. Inside a
repository, `grind status` names the init owning the current branch and where the
repository's other inits live. Review notes from `grind note add` go to the init
owning the file's branch and are committed with it.

## Dashboard

Run `grind dashboard` and open the printed local URL to see initiatives, their
status, and repository checkouts. Initiatives follow their scope folders in
collapsible groups. Choose VS Code or WebStorm in the Editor dropdown, then click
Open in editor on an initiative to open its init folder. On macOS the editor must
be installed; on other platforms its command-line launcher must be on PATH.
Expand an initiative row for details and directory copy buttons.
Search reveals matching initiatives inside collapsed groups; clearing it restores
the previous group view. Status filters update the group counts. Refresh rereads
local state and keeps expansion choices until the page is reloaded; Ctrl-C stops
the server.

## Development

Requires Node.js 24 or later. Tests and the source entry point run directly on
Node's native TypeScript type stripping; consumers use the compiled output.

```sh
npm install
npm test          # node --test over src/**/*.test.ts
npm run typecheck
npm run build     # emits dist/, including the grind bin entry
npm run test:package # builds and exercises the relocatable plugin
npm run update-plugin # reinstalls the published plugin in Claude Code and Codex
node dist/cli.js --help
```

Optional `type: Roadmap` documents describe broader vision and cross-init priorities.
Give each roadmap a unique `grind.id` within the state directory and reference it
with `grind.roadmap` on an init’s intent or another document. `roadmap.md` beside a
project index is the conventional location; IDs continue to resolve after moves.
See [Roadmaps](docs/protocol.md#roadmaps) for the metadata and discovery contract.

Use `/grind:housekeeping` for a project or roadmap to reconcile milestone
contributions, init scope, stale checkpoints, and completed work. The skill checks
delivery evidence and raises unresolved conflicts in intent or priorities with
the user. Ask for an audit only when you want findings without record changes.

Use `$grind:triage` in Codex or `/grind:triage` in Claude Code to bring up work
without choosing an init first. The skill checks relevant open inits and actual
implementation progress, including whether the addition requires revisiting work
already completed. It proposes an existing or new init, needed record changes,
and suitable roadmap placement, then waits for your confirmation before writing.
Confirming placement does not itself start implementation.

Use `$grind:coordinate` in Codex or `/grind:coordinate` in Claude Code to add a
coordination note to another init’s ledger and get a prompt to relay to its working
session. The note links to the source design and preserves the receiving init’s
current work. The skill does not send the prompt or start work in another session.
