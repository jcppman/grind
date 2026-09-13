# Grind

Grind is a vendor-neutral plugin and CLI for resumable development initiatives.
It separates shared workflow instructions, private initiative state, and application
repositories. Repository contents and Git state remain the final authority.

Read [the operating protocol](docs/protocol.md) for the workflow. Grind will ship
shared context, create, start, save, and close skills with Codex and Claude Code plugin
manifests. The CLI will own deterministic filesystem and Git mechanics.

Initiative artifacts belong in the workspace's configured private state repository,
not in this implementation repository. Find `grind-workspace.json` by walking
upward to the nearest enclosing workspace boundary.

## Status

Development is being bootstrapped. This build contains the workspace and artifact
reader: workspace discovery, initiative resolution from an identifier, folder, or
checkout, frontmatter and ledger validation, sidecar parsing, and approval coverage.
No lifecycle command is implemented yet; `grind <command>` reports which increment
delivers it.

## Development

Requires Node.js 24 or later. Tests and the source entry point run directly on
Node's native TypeScript type stripping; consumers use the compiled output.

```sh
npm install
npm test          # node --test over src/**/*.test.ts
npm run typecheck
npm run build     # emits dist/, including the grind bin entry
node dist/cli.js --help
```
