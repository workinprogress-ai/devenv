# AGENTS.md — devenv (workspace root)

The devenv dev-container workspace: custom AI skills, workspace tooling wrappers,
org repo clones, and the docs that govern how AI sessions work here. Thin
dispatcher — the authoritative guides live in `docs/`, this file routes.

## Commands

- Test (workspace suite): `pnpm test` (runs `tools/tests/run-devenv-tests.sh`)
- Lint (shell scripts): `pnpm lint`
- Lint (skills): `lint-skills`
- Refresh repo cache: `repo-cache-update`

## Layout

- `copilot/` — AI skills (`copilot/skills/`), conventions, knowledge and
  engineering imports
- `tools/` — workspace wrappers (`issue-*`, `pr-*`, `repo-commit`,
  `skill-orient`, …), their implementations in `tools/scripts/`, libs, tests
- `docs/` — workflow and conventions documentation (see below)
- `repos/` — cloned org repos, including the six `template.*` repos
- `setup/`, `.devcontainer/` — container bootstrap
- `playground/`, `tmp/`, `write_file/` — scratch areas

## Repo context

Start with `docs/README.md` (documentation index) and `docs/Workflow.md` (the
workflow: session discipline, planning, execution, review, commit). Skill
behavior and catalog: `docs/Skills.md` and
`copilot/skills/devenv-help/references/skills-registry.md`. Always read
`copilot/copilot-instructions.md` before editing anything — it is the
binding conventions file for AI sessions in this workspace.

## Notes

- `docs/Skills.md` is a hardlink twin of `copilot/skills/_shared/docs/Skills.md`
  (same inode — one edit covers both); verify with `ls -i` before assuming sync.
- The repo cache under `tools/cache/` is machine-managed — never edit;
  it refreshes from committed HEAD via `repo-cache-update`.
- The AI never runs mutating git commands; commits go through `/devenv-commit`
  (the `repo-commit` tool).
