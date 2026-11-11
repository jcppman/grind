### Roadmaps

A roadmap describes vision, desired outcomes, priorities, dependencies between
initiatives, possible future work, and open decisions. Create one when broader
planning needs a durable home. It is optional and may live anywhere in the configured
state directory; `roadmap.md` beside a project `index.md` is the usual location.
A roadmap does not create an initiative or require its own ledger.

```yaml
type: Roadmap
grind:
  id: rytho
```

Roadmap IDs are case-sensitive, nonempty strings without surrounding whitespace,
unique across the entire state directory, including archived documents. Identity
comes from `type: Roadmap` and `grind.id`, not the filename or folder. Moving a
roadmap within the state directory preserves its identity. Grind scans Markdown
files without following symlinks or entering `.git`; no registry is maintained.

Any document can declare one association:

```yaml
grind:
  roadmap: rytho
```

On an initiative's root `intent.md`, this declares the initiative's roadmap.
Other files declare only their own association; there is no folder inheritance.
Indexes may carry `grind.roadmap` alongside optional `okf_version` metadata.
Use ordinary Markdown links for human navigation. Missing or ambiguous references
and invalid IDs are diagnosed rather than resolved by proximity or filename.

`list` and `status` expose the initiative association as an ID and resolved path.
`context` also includes the roadmaps referenced by the initiative's documents,
with each body included once. Roadmaps provide planning context, not execution
authorization or automatically required constraints. References are not followed
recursively. The user's request still determines the task.

Keep each initiative's purpose and completion criteria in its intent, execution
strategy in warranted plans, and current state and concrete next action in its
ledger. Keep the roadmap at the level of product direction, outcome-level stages,
priorities, and dependencies between initiatives. Detailed research approaches,
prompts, acceptance criteria, technical choices, and concrete next actions belong
in the relevant initiative. When a roadmap discussion introduces such detail,
update that initiative and retain only the strategic implication and a link in
the roadmap. Reuse an existing initiative that owns the outcome; create a missing
one when the user asks to track it. Future ideas need not become initiatives
immediately.

Milestones may be ordinary headings in roadmaps or plans. They have no special
artifact, folder, metadata, or lifecycle in Grind. Existing folders remain valid
ordinary document organization and do not need a migration.

For a product roadmap, give most substantial initiatives a visible place under
outcome-based milestones; distant ideas and trivial work may remain unassigned.
List contributing initiatives with ordinary links and distinguish required from
optional or conditional contributions. Qualify partial contributions so milestone
readiness does not imply completion of an initiative's entire scope. Keep membership
in the roadmap; do not invent a `grind.milestone` field or duplicate status there.
