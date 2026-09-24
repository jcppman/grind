# Grind

Grind is a vendor-neutral plugin and CLI for resumable development initiatives.
It separates shared workflow instructions, private initiative state, and application
repositories. Repository contents and Git state remain the final authority.

Call an initiative an **init** for short: “create an init for xxx,” “start this
init,” or “save this init.” Both names select the same workflows. For an explicit
command, use `/grind:create xxx`.

Read [the operating protocol](docs/protocol.md) for the workflow. Grind will ship
shared context, create, start, save, and close skills with Codex and Claude Code plugin
manifests. The CLI will own deterministic filesystem and Git mechanics.

Initiative artifacts belong in the workspace's configured private state repository,
not in this implementation repository. Find `grind-workspace.json` by walking
upward to the nearest enclosing workspace boundary.

## Status

Milestone 2 provides recoverable branch switching and note transfer, closure and
reopening, retention archival, `agent-note`, and scoped checkpoint saves. The matching
compiled CLI and shared context/create/start/save/close skills run in Codex and
Claude Code from the same relocatable package.

See [installation and recovery](docs/installation.md) for packaging, workspace
setup, terminal use, and opt-in session hooks.

`grind context [initiative]` assembles read-only context in one call. Enable
`contextOnSessionStart: true` in the workspace configuration for automatic hook
loading; it is disabled by default. Oversized contexts produce only an association
notice and a command to load the full context if needed.

The initiative argument is optional for context and start. From an initiative folder
or associated checkout, Grind resolves it automatically. Elsewhere, invoke
`/grind:context` or `/grind:start` without an argument to choose from the initiatives
in the current workspace.

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
