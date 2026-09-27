# Special / rarely-used tooling

Scripts that are **runnable again, on purpose, later** — but not part of any daily
workflow. They are intentionally **not on `PATH`**: a tool that must be invoked by
explicit path is one you have to think about before running. Each entry here states
what it does, when to run it, and its blast radius.

Invocation: `bash tools/special/<script>.sh` from the workspace root (or an absolute
path from anywhere).

## Membership criteria

A script belongs here when **all** of these hold:

1. **Not daily-driver** — no regular workflow invokes it; it serves exceptional or
   periodic situations.
2. **Significant blast radius** — it mutates state beyond one working copy (org-wide
   settings, many repositories) or is otherwise irreversible-ish.
3. **Runnable again with a purpose** — a fork, a new repo batch, or a recovery
   scenario will plausibly need it again. A migration that runs once inside its own
   PR and is then spent does *not* belong here: it executes on its branch and the
   cleanup task deletes it. History (`git log --all`) is the archive for spent
   one-time scripts — no `one-time/` folder.

## Scripts

### repo-reset-merge-config.sh

- **What:** re-applies the current repo-type configuration (rulesets + merge
  methods) from `tools/config/` to every repository in the org. Default mode is a
  **dry-run report** per repository: detected type, open PR count, and a WIP-range
  scan. `--apply` performs the configuration.
- **When to run:** (a) onboarding a fork that inherited different merge settings
  from the org policy; (b) after changing `tools/config/repo-types.yaml` or
  `ruleset-default.json`, to roll the change out to existing repositories;
  (c) recovery after a policy change left repositories in a mixed state.
- **Blast radius:** with `--apply`, mutates org-wide repository settings
  (protected-branch rulesets and merge buttons) for every scanned repository.
  Read-only without it.
- **Docs:** merge policy context in [docs/Workflow.md §Merge policy](../../docs/Workflow.md)
  and [docs/Commit-Conventions.md](../../docs/Commit-Conventions.md).
