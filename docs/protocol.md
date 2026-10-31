# Grind operating protocol

This document owns the instructions for an agent carrying out initiative work.
The CLI implements deterministic mechanics; skills apply judgment using this
protocol. Follow the available command's documented capabilities and stop when a
required operation is unavailable. Initiative-specific limitations and temporary
manual procedures belong in that initiative's ledger and plan.

## Terminology

Use **init** (plural **inits**) as the short name for an initiative in conversation.
Accept both names for the same workflows, including “create an init for…” and
“save this init.” Documentation may use the full term. Command names, stored paths,
JSON fields, and artifact types retain their existing names.

## What counts as an initiative

An initiative is a coherent body of work with one intended outcome, potentially
spanning multiple repositories, tickets, pull requests, tasks, and agent
sessions. It is larger than a single task, but it need not be a large
organisational program.

Typical initiatives include a cross-repository feature, a substantial
migration, a coordinated release, or a multi-session investigation and
implementation. A typo, dependency bump, question, or small localised change
does not need an initiative folder.

```text
initiative: overall outcome
├── ticket: trackable unit of responsibility
├── task: concrete implementation work
└── commit or pull request: delivery and review unit
```

An initiative starts the moment an idea is worth writing down. `grind create`
creates `index.md`, `intent.md`, and `ledger.md`; specifications, plans, and
supporting artifacts appear as the work earns them.

## Read only the relevant procedure

This page is the entry point. The linked references own the detailed contracts;
skills link directly to the portions they need. Context loading alone does not
require reading these documents. Do not load every reference recursively.

### Creating an initiative

See [Creating an initiative](protocol/create.md#creating-an-initiative).

### Initiative artifacts

See [Initiative artifacts](protocol/artifacts.md#initiative-artifacts).

### Index and document scope

See [Index and document scope](protocol/artifacts.md#index-and-document-scope).

### Paths in artifacts

See [Paths in artifacts](protocol/artifacts.md#paths-in-artifacts).

### Frontmatter and interoperability

See [Frontmatter and interoperability](protocol/artifacts.md#frontmatter-and-interoperability).

### Execution authorization and verification

See [Execution authorization and verification](protocol/artifacts.md#execution-authorization-and-verification).

### `intent.md`

See [intent.md](protocol/artifacts.md#intentmd).

### Specifications

See [Specifications](protocol/artifacts.md#specifications).

### Plans

See [Plans](protocol/artifacts.md#plans).

### Reference documents

See [Reference documents](protocol/artifacts.md#reference-documents).

### Roadmaps

See [Roadmaps](protocol/roadmaps.md#roadmaps).

### Choosing what to preserve

See [Choosing what to preserve](protocol/checkpoints.md#choosing-what-to-preserve).

### Verification records and external workflows

See [Verification records and external workflows](protocol/checkpoints.md#verification-records-and-external-workflows).

### `ledger.md`

See [ledger.md](protocol/checkpoints.md#ledgermd).

### During-work update policy

See [During-work update policy](protocol/checkpoints.md#during-work-update-policy).

### Session-end protocol

See [Session-end protocol](protocol/checkpoints.md#session-end-protocol).

### Checkouts and worktrees

See [Checkouts and worktrees](protocol/execution.md#checkouts-and-worktrees).

### Proportionate execution

See [Proportionate execution](protocol/execution.md#proportionate-execution).

### Small, localised work

See [Small, localised work](protocol/execution.md#small-localised-work).

### Ambiguous or consequential work

See [Ambiguous or consequential work](protocol/execution.md#ambiguous-or-consequential-work).

### Large or cross-repository work

See [Large or cross-repository work](protocol/execution.md#large-or-cross-repository-work).

### Testing and debugging

See [Testing and debugging](protocol/execution.md#testing-and-debugging).

### Reading review notes

See [Reading review notes](protocol/execution.md#reading-review-notes).

### Session-start protocol

See [Session-start protocol](protocol/execution.md#session-start-protocol).

### Context loading

See [Context loading](protocol/execution.md#context-loading).

### Prepare an initiative

See [Prepare an initiative](protocol/execution.md#prepare-an-initiative).

### Closing an initiative

See [Closing an initiative](protocol/lifecycle.md#closing-an-initiative).

### Archiving

See [Archiving](protocol/lifecycle.md#archiving).

## Operating rule

The files provide continuity; the code provides truth. Every agent begins by
validating the recorded checkpoint and ends by leaving a better one, committed,
when meaningful work occurred.
