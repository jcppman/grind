# Install the milestone 1.5 build

Node.js 24 or later and Git are required. This build provides `create`, `list`,
`status`, non-switching `start`, `save`, and `approve` through shared Codex and
Claude Code skills. Switching, reopening, close, init, and doctor belong to later
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
copies it outside the checkout and executes real creation, persistence, approval,
and read-only inspections.

For terminal use, `npm pack` creates the npm artifact; install that artifact with
`npm install --global <tarball>`. Plugin installation alone does not add `grind`
to PATH. Both entry points use the same compiled CLI.

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
invoke `/grind:context [initiative]` explicitly. `/grind:start [initiative]` enters
work through the same compiled CLI and initiative records used by Codex.

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
grind approve private-state/initiatives/app/outcome/intent.md
grind save app/outcome --message 'outcome: record approval'
```

Scope selects an existing workspace folder and does not infer repository tracking
or branch ownership. Populate the ledger from verified repository state. Approval
is a deliberate human action on a committed document, not a consequence of tests
passing. `approve` defaults to the state repository's Git `user.name`; `--by`
selects another explicitly supplied identity. Document paths are relative to the
working directory. All commands support `--json` and `--workspace`.

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
  signing, or other reported failure, then deliberately commit or unstage the
  prepared paths before retrying. Never blindly reset unrelated work.
- `DOCUMENT_DIRTY`: commit the reviewed document before recording approval.
- `ARTIFACT_INVALID`: repair the reported record or link; save does not normalize it.
- `TRANSITION_UNSUPPORTED`: this release cannot switch branches or reopen work.
  Inspect context without starting, or arrange the required checkout deliberately.

The CLI never pushes. Unknown approval revisions are diagnostic and do not imply
current approval. Automatic context discovery without an initiative is quiet;
explicit unresolved or ambiguous requests report a usable error.
