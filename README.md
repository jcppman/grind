# Grind

Grind is a vendor-neutral plugin and CLI for resumable development initiatives.
It separates shared workflow instructions, private initiative state, and application
repositories. Repository contents and Git state remain the final authority.

Development is being bootstrapped. No CLI or installable plugin is available yet.

Read [the operating protocol](docs/protocol.md) for the workflow. Grind will ship
shared context, create, start, save, and close skills with Codex and Claude Code plugin
manifests. The CLI will own deterministic filesystem and Git mechanics.

Initiative artifacts belong in the workspace's configured private state repository,
not in this implementation repository. Find `grind-workspace.json` by walking
upward to the nearest enclosing workspace boundary.
