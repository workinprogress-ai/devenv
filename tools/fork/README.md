# tools/fork/

A fork's own tools, and its overrides of the provided tools. This folder is
committed in the fork. A script placed here gets a depth-1 entry in `tools/` the
same way a script in `tools/scripts/` does; a file with the same name as a
provided tool replaces it.

Precedence: `tools/custom/` (a user's machine-local files) over `tools/fork/`
over `tools/scripts/` (the provided tools). Underscore-prefixed scripts have no
depth-1 entry, so they cannot be overridden this way.

Each entry is written at sync time and points at the winning file, so after
adding or removing an override run `entry-stubs-sync` (bootstrap runs it too).
See `docs/Forking.md`.
