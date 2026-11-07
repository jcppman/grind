# Creating an initiative

Creation captures intent; it does not authorize implementation or checkout changes.
Before writing the intent, ask focused clarification questions when uncertainty
about the desired outcome, scope, success criteria, or constraints would materially
change what is recorded. Use the current conversation to avoid asking questions
already answered. Do not turn plausible assumptions into agreed requirements.
Design and execution choices that can wait belong as open questions in the ledger,
with clarification or investigation as the next action when needed.

Choose placement from the repositories the intended work targets, independently
of the agent's current working directory. Unless the user explicitly specifies a
different location, work targeting one repository uses that repository's
workspace-relative folder as `--scope`. For multiple target repositories, use
their narrowest common containing folder. Repositories consulted only as references
do not widen the scope. Omit `--scope` when no target repository is known.

Resolve and verify the target repository's folder before running create; a known
target determines placement even when it has no assigned initiative branch or
`grind.repositories` entry yet. For example, with a workspace containing
`audio/rytho`, work solely on Rytho uses `create <outcome> --scope audio/rytho`
even when the working directory is `audio`. This creates
`initiatives/audio/rytho/<outcome>/` in the state repository. A `rytho-` name
prefix is not a substitute for the repository scope.

`grind.repositories` records repositories, by the workspace-relative path of their
canonical checkout, and the exact branches assigned to initiative work, not every
repository consulted. A checkout's current branch is evidence of its state, not
evidence that the branch belongs to this initiative. A legacy `checkout` field is
accepted and ignored. During creation,
record an existing branch only when its association with the initiative is
established by the user or verified initiative work. Otherwise leave
`grind.repositories` empty and describe candidate repositories in the ledger's
working state. Do not invent branch names to fill the required field or put
placeholder branches in tracking records.

Choose and create new branches when execution needs them, following the
repository's branching rules, then record the verified branch. `grind worktree`
records a branch named after the init when it creates one for an untracked
repository. Creation alone does not create or switch branches. Repositories used
only as references do not need an initiative branch or tracking entry.

A repository entry holds one branch, and `grind switch` and `grind worktree` act on
it. When initiative work in a repository forms a stack of dependent pull requests,
record the top branch and its pull request, and list the layers in order in the
ledger body. Update the entry whenever a layer is added on top.
