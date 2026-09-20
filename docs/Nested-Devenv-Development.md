# Developing Devenv Itself (Nested Clone Workflow)

This guide covers the supported workflow for making changes to the devenv
environment while running inside it: working in the nested clone under
`repos/devenv/` (or opening that clone in a second VS Code window), running its
tests, and pushing changes for a PR.

## Why work in a nested clone?

Editing the running environment in place means every change takes effect under
you immediately — a broken script can break your own tooling mid-edit. The
nested clone at `repos/devenv/` isolates your work: you edit, test, and commit
there, then push a branch and open a PR. The running environment only picks up
your changes after they merge.

```bash
repo-get devenv   # clone devenv into repos/devenv/ like any other repo
cd repos/devenv
```

## Running devenv's own tests

```bash
bash tools/tests/run-devenv-tests.sh
```

Scripts resolve their tools root from their own location (the self-root
contract: self-location wins; an exported `DEVENV_TOOLS`/`DEVENV_ROOT` is
honored only when it points at the same checkout). This means the commands
above always exercise **this checkout**, even though the outer environment
exports `DEVENV_ROOT=/workspaces/devenv`.

## Tool entry points: stubs, not symlinks

The short-name commands in `tools/` (e.g. `issue-get`, `plan-parse`) are **generated stub files**, each one line of dispatch:

```bash
exec bash "$(dirname "$0")/scripts/issue-get.sh" "$@"
```

They are owned by the idempotent `.devcontainer/entry-stubs-sync.sh`, which bootstrap runs: it creates a stub for every `tools/scripts/` script except underscore-prefixed internal scripts (`_*.sh` — those are invoked via their `tools/scripts/` path directly and get no depth-1 entry; stale stubs for them are removed), converts stale symlinks, links the test runner as `tools/run-devenv-tests`, and is a no-op when everything is in sync. Never hand-edit a stub — edit the real script in `tools/scripts/` and re-run the sync if you added a new script.

## Committing

The clone's own `.husky` hooks run markdown lint, script lint, and the full
test suite when you touch `tools/` or `.devcontainer/`, and carry the devenv
wip-gate block. They operate on the checkout you are committing in.

Normal flow:

```bash
git checkout -b my-change
# ...edit, test...
git add -A && git commit   # hooks run here
git push -u origin my-change
# open the PR
```

## Targeting devenv with the issue/PR tools

The `issue-*` / `pr-*` tools guard against accidentally operating on the
devenv repo (they exist to manage *project* repos). To target devenv itself:

```bash
GITHUB_REPO=workinprogress-ai/devenv issue-list
issue-get 42 --devenv          # or pass the tool's --devenv flag
```

## Skill and knowledge development caveat

The live Copilot session reads skills and knowledge through `~/.copilot`
symlinks pointing at the **running** environment (`/workspaces/devenv/copilot`),
not your clone. Edits to `copilot/skills/` or `copilot/knowledge/` inside
`repos/devenv/` are invisible to the running assistant until they merge and
the canonical copy refreshes (container restart/rebuild). To preview skill
changes, temporarily copy them into the running tree — and revert afterwards.

## Known environment behaviors (by design, not bugs)

- **Update gate prompts target the running environment.** The
  "uncommitted changes / do you want to update?" messages on new shells refer
  to `/workspaces/devenv`, not your clone.
- **Credentials in clone remotes.** Clones made by the environment's tooling
  embed a token in the remote URL so unattended push works. Treat `.git/config`
  as sensitive.
- **Never set a global `core.hooksPath`** pointing at devenv's tools — it
  overrides every repo's own hooks. Repos opt into the wip-gate via the block
  in their own `.husky/pre-commit` instead.

## Related

- Dev container overview: [Dev-container-environment.md](Dev-container-environment.md)
- Tooling standards: [Tooling-Standards.md](Tooling-Standards.md)
