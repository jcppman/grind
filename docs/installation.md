# Install Grind

Node.js 24 or later and Git are required. This build provides `create`, `list`,
`status`, `context`, recoverable `start`, `save`, `close`, `archive`, and the `agent-note`
writer through shared Codex and Claude Code skills, plus a local dashboard. Init and doctor belong to later
milestones.

## Distribution

Every push to `main` runs the tests, packages the plugin, and force-pushes the
package to the `plugin` branch of `jcppman/grind`. That branch holds the compiled
CLI, shared protocol and skills, hooks, platform manifests, and runtime
dependencies, so hosts install it without a build step. Both hosts install from
it as a Git marketplace named `grind`.

The base version in `package.json` and both plugin manifests must match; bump it
by hand when skills, commands, or record formats change. Publishing appends the
commit, as in `0.4.0+abc1234`, because hosts only refresh a cached install when
the version string changes.

To build and check the package locally:

```sh
npm ci
npm test
npm run typecheck
npm run test:package
```

`build/grind` is relocatable: the package smoke test copies it outside the
checkout and executes real creation, persistence, and read-only inspections.

For terminal use, `npm pack` creates the npm artifact; install that artifact with
`npm install --global <tarball>`. Plugin installation alone does not add `grind`
to PATH. Both entry points use the same compiled CLI.

During development, `npm run build && npm link` links both `grind` and
`agent-note` from the checkout. Rebuild after source changes because the linked
commands execute the compiled files in `dist/`. To try unmerged plugin changes in
Claude Code, run `npm run package:plugin` and start a session with
`claude --plugin-dir build/grind`.

## Codex installation

```sh
codex plugin marketplace add jcppman/grind --ref plugin
codex plugin add grind@grind
```

Start a fresh Codex session after installation; existing sessions do not acquire
the newly installed skills.

Use the [workspace opt-in](#automatic-context-loading) for automatic loading.
Review and trust the bundled hook through the host's hook controls when required;
installing a plugin does not bypass host trust. Explicit Grind context remains
available with hooks disabled.

Skill helpers run `node <installed-plugin-root>/scripts/grind.mjs ...`; locate the
root relative to the installed SKILL.md, never by assuming a global CLI or the
source checkout.

## Claude Code installation

```sh
claude plugin marketplace add jcppman/grind@plugin
claude plugin install grind@grind --scope user
```

Claude Code leaves auto-update off for third-party marketplaces. Enable it once in
`/plugin` → Marketplaces → `grind` → Enable auto-update; new builds then install in
the background after a session starts and load on the next launch or
`/reload-plugins`. Start a fresh Claude Code session after installation.

Use the [workspace opt-in](#automatic-context-loading) for automatic loading, or
invoke `/grind:context [initiative]` explicitly. `/grind:start [initiative]` prepares
the initiative and then asks what you want to do unless you also requested work.
Both skills discover from the current folder when no identifier is supplied and
offer available inits for selection when discovery cannot choose one.

## Updating

`npm run update-plugin` refreshes the `grind` marketplace and reinstalls the plugin
in both hosts. Set `CODEX=<path>` when the `codex` on PATH has no `plugin` command.
Start a fresh session afterwards.

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
grind context app/outcome
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

## Automatic context loading

The plugin bundles a `SessionStart` hook for Codex and Claude Code. Opt in for a
workspace by adding the boolean setting to its existing `grind-workspace.json`:

```json
{
  "stateRepository": "./private-state",
  "contextOnSessionStart": true
}
```

Preserve your actual stateRepository and other settings. Omitted or false disables
loading; non-boolean values are errors. The hook checks this flag before inspecting
inits or repositories. The host must also allow/trust the plugin hook. Setting the
flag does not grant that trust. No global settings are edited by Grind.

Start a new host session after installing an updated plugin. With the hook enabled,
small contexts are injected in full; output exceeding 6,000 UTF-8 bytes becomes
only an association notice with an explicit command to load context if needed.
No partial documents, temporary output files, or per-session selection records are
created. An explicit init selected in the conversation takes precedence over the
checkout's association. Disabled hooks do not affect `grind context` or the skill.

Remove any older automatic-entry paragraph copied from the adapter docs if you
want this setting to be the sole automatic-loading control. Those instructions
can independently cause an agent to invoke the skill even when the hook is disabled.
Do not register a second copy of the bundled hook in user settings.

`grind context [full/scoped-id]` prints full Markdown; `--json` provides a versioned
payload with `complete`, source bodies/metadata, required excerpts, recorded state,
observations, note locations, diagnostics, and navigation. A false `complete` means
required context is missing or invalid. The operation stays read-only even on error.
Declare mandatory constraints under `## Read on every context load` in the root
index using Markdown list links; other documents stay on demand. Required targets
must be Markdown within the workspace or state directory. Relative links resolve
from their source document, and fragments use GitHub-style heading slugs.

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

`create` supplies this metadata. Grind 0.4.0 requires it, so records created by
earlier versions need this migration. For existing records, change `type: Initiative Intent`
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
