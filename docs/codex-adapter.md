# Initiative workflow

Use the installed Grind context skill when the user requests init context or the
chosen task needs it. Load context explicitly with /grind:context; the plugin has
no SessionStart hook. Loading is read-only and never executes the recorded next
action. Use /grind:start to find or create the init's worktree, and save at meaningful
checkpoints. An init explicitly chosen by the user takes precedence over directory
or branch association.
