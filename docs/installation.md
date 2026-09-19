# Install Grind

Node.js 24 or later and Git are required. This build provides `create`, `list`,
`status`, recoverable `start`, `save`, `close`, `archive`, and the `agent-note`
writer through shared Codex and Claude Code skills, plus a local dashboard. Init and doctor belong to later
milestones.

## Build and package

From the source checkout:

```sh
npm ci
npm test
npm run typecheck
npm run test:package
```

`build/grind` is a relocatable Codex and Claude Code plugin containing the matching
compiled CLI, shared protocol and skills, platform manifests, and runtime
dependencies. Copy the whole folder; copying only skills or dist is insufficient.
No compiler or global Grind command is needed at runtime. The package smoke test
copies it outside the checkout and executes real creation, persistence, and
read-only inspections.

For terminal use, `npm pack` creates the npm artifact; install that artifact with
`npm install --global <tarball>`. Plugin installation alone does not add `grind`
to PATH. Both entry points use the same compiled CLI.

During development, `npm run build && npm link` links both `grind` and
`agent-note` from the checkout. Rebuild after source changes because the linked
commands execute the compiled files in `dist/`.

## Codex installation

Use a local Codex marketplace entry pointing at the packaged plugin. For a personal
marketplace, place the package at `~/plugins/grind` and register it in
`~/.agents/plugins/marketplace.json` using Codex's plugin-creator scaffold workflow.
Preserve other marketplace entries. Then run:

```sh
codex plugin add grind@personal
```

Use the marketplace's actual name if it differs. Start a fresh Codex session after
installation; existing sessions do not acquire the newly installed skills.

For automatic context loading, append the thin paragraph in
[codex-adapter.md](codex-adapter.md) to the workspace's `AGENTS.md`, preserving its
existing instructions. This adapter routes to the installed shared context skill;
it does not contain an independent workflow. Without the adapter, explicitly ask
for Grind context or use the installed context skill. Hooks are not required.

Skill helpers run `node <installed-plugin-root>/scripts/grind.mjs ...`; locate the
root relative to the installed SKILL.md, never by assuming a global CLI or the
source checkout. To update a local installation, rebuild and replace the packaged
folder, use plugin-creator's cachebuster helper, and reinstall from the same
marketplace. The base CLI and plugin versions remain aligned.

## Claude Code installation

Validate and add the repository or packaged directory as a local marketplace,
then install Grind from that marketplace:

```sh
claude plugin validate build/grind --strict
claude plugin marketplace add "$PWD/build/grind" --scope user
claude plugin install grind@grind-local --scope user
```

The marketplace source is `./`, so Claude Code loads the plugin from the selected
directory. Keep that directory in place while the marketplace is registered. Start
a fresh Claude Code session after installation.

For automatic context loading, append the thin paragraph in
[claude-code-adapter.md](claude-code-adapter.md) to the workspace's `CLAUDE.md`,
preserving its existing instructions. The adapter routes to the installed shared
context skill and does not define separate state or workflow. Without the adapter,
invoke `/grind:context [initiative]` explicitly. `/grind:start [initiative]` prepares
the initiative through the same compiled CLI and records used by Codex, then asks
what you want to do. It executes work only when you also request a task.
Both commands accept no initiative argument: they discover from the current folder
when possible and otherwise offer the workspace's available initiatives for selection.

## Workspace setup

Until `init` exists, create a workspace-level `grind-workspace.json` containing:

```json
{ "stateRepository": "./private-state" }
```

The directory must exist inside an initialized Git repository with a Git author
identity configured. It may be a subdirectory of that repository. Paths are based
on the directory containing the config, and the nearest enclosing config wins.
Pass `--workspace <directory>` when running outside the boundary. Keep private
initiative state out of the implementation repository.

```sh
grind create outcome --scope app
grind status app/outcome
grind start app/outcome
grind save app/outcome --message 'outcome: clarify intent'
grind close app/outcome --outcome delivered --result 'release/v1' --notes handled
grind archive app/outcome
```

Scope selects an existing workspace folder and does not infer repository tracking
or branch ownership. Populate repository tracking only for checkouts and branches
established as initiative work, following [Creating an initiative](protocol.md#creating-an-initiative).
An observed current branch alone does not establish ownership. All commands support
`--json` and `--workspace`.

Start automatically excludes the root `.grind.md` sidecar when needed by appending
`/.grind.md` to Git's local `info/exclude`. Existing entries are preserved; linked
worktrees share this file. No global Git configuration or repository `.gitignore`
change is needed. A tracked sidecar must be untracked explicitly. If another ignore
rule overrides the local exclusion, start reports the conflict for resolution.

## Dashboard

Run `grind dashboard` from the workspace, or pass `--workspace <directory>`.
Open the printed URL in a browser. The process serves on `127.0.0.1` with an
available port; Ctrl-C stops it. `--json` emits the URL in the normal success
envelope for tools. The dashboard does not automatically open a browser.

The overview shows open, closed, and archived initiatives, current work, recorded
branches, and observed checkout state. Use the status filters or search, and click
Refresh to reread local files. Invalid records and unavailable checkouts remain
visible with diagnostics.

The initiative's copy icon copies a command for its directory. Each associated
checkout has its own copy icon, including worktrees. Tooltips identify each action. Commands quote paths
for POSIX shells such as zsh and bash. Copying does not run the command or switch a
branch. Missing checkouts have disabled buttons; if clipboard access fails, the
command appears as selectable text for manual copying.

The server only reads local records and Git state. It uses a random URL for each
run and does not accept mutations or serve arbitrary files. Keep it running while
using the page; refreshing after shutdown requires restarting the command and
opening its new URL.

## Initiative root metadata

An initiative's `intent.md` must declare:

```yaml
---
type: Intent
grind:
  root: true
---
```

`create` supplies this metadata. For existing records, change `type: Initiative Intent`
to `type: Intent` and add `root: true` under `grind`, preserving other metadata and
content. Migrate archived initiative intents too. Unmarked intents no longer establish
initiative boundaries; optional milestone intents use `type: Intent` without the
root marker. Nested roots are invalid. Read-only commands never migrate records.

## Recovery

- `STATE_LOCKED`: inspect the reported lock's owner PID, hostname, and timestamp.
  Verify that owner has exited before manually removing the lock directory. Locks
  live in the Git common directory and cover linked state-repository worktrees.
  They coordinate Grind writers, not arbitrary Git/editor processes.
- `INITIATIVE_EXISTS` or incomplete creation: inspect the destination and preserve
  its contents. Creation never overwrites it or claims a partial result succeeded.
- `INDEX_NOT_CLEAN`: inspect the entire state repository's staged changes. Finish
  or otherwise resolve that staging intentionally, then retry. Grind does not reset it.
- `COMMIT_FAILED`: prepared files and staged changes remain. Fix the hook, author,
  signing, or other reported failure, then retry the same lifecycle command when
  a journal is pending. Never blindly reset unrelated work.
- `ARTIFACT_INVALID`: repair the reported record or link; save does not normalize it.
- `START_BLOCKED`: follow the reported preflight blocker. Grind does not stash,
  commit, discard, merge, or delete application work to make a switch possible.
- `OPERATION_PENDING`: use status to inspect the operation, then rerun start for the
  same target or the original close/archive command. Completed steps remain in place.
- `REPOSITORY_LOCKED`: verify the recorded owner has exited before removing the lock.
  Age alone is not evidence that a lock is abandoned.
- `ARCHIVE_BLOCKED`: retain the closed initiative until it is old enough, every
  owned branch is absent from all linked worktrees, and all notes are resolved.

The CLI never pushes. Automatic context discovery without an initiative is quiet;
explicit unresolved or ambiguous requests report a usable error.
