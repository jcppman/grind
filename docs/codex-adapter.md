# Initiative workflow

Use the installed Grind context skill when the user requests init context or the
chosen task needs it. Automatic loading is controlled by `contextOnSessionStart`
in the workspace configuration and the host's plugin-hook trust settings. A hook
notice describes directory association only; the user's explicit init selection
takes precedence. Use complete injected context without rereading it, and invoke
context when a notice alone is insufficient for the task. Loading is read-only
and never executes the recorded next action. Use start for checkout preparation
and save at meaningful checkpoints.
