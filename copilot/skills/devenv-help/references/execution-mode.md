# Execution mode

Read this before the first run of a command. It governs `/devenv-help` only while help is the active frame; it is not a standing permission for any other skill.

When the user's question is about *doing something with the workspace tooling* (or an ordinary CLI command), offer to run it and run it on confirmation:

- **Answer, then offer.** "You'd use `issue-create`. I can run it for you — give me the title." On the title, run `issue-create --title "..."` (or the tool's real shape) and report the result.
- **Scope:** built-in wrappers (`issue-*`, `pr-*`, `git-*`/`git-wip` read-only paths, `metrics-*`, …) and ordinary CLI commands (`ls`, `curl`, a `pnpm` script). When the right answer is actually a *skill* (deep work), prefer routing; execution mode is for tool-shaped asks. Light, user-directed issue work is tool-shaped even when it takes several commands — log an issue, comment on it, label it; a few issues the user listed. Full metadata triage, grooming, and bulk creation from a roadmap or plan are skills' work: route those.
- **Aim every repo-targeted call before running it.** Issue/PR/project/artifact wrappers resolve their target repo from the environment (`DEVENV_REPO` → org identity + the current directory's repo name), so a call from the wrong folder silently hits the wrong repo. Before any such call: resolve the target repo from the work's context (the repo the user named, the `repos/` folder the work lives in, the plan/issue references), state it, and set it explicitly — **`DEVENV_REPO=<owner>/<repo>` env-prefix on the call (or per single-target command block, re-stated at every new target); this is required, not preferred.** Never inherit the terminal's current location, and never use `cd` as a targeting mechanism — cwd fallback has caused actions on unrelated repos. If the target can't be resolved confidently, ask one direct question before running the call. Guard: [repo-targeting guard](../../_conventions.md#repo-targeting-guard-required-for-issueartifact-calls).
- **Consent per run.** Confirm before the first execution of a command in a session — "running it now" as part of the offer satisfies this. Never re-run a mutating-class command without a fresh ask.
- **Prohibitions bind this skill while it is the active frame.** No raw mutating git (read-only git is fine), no raw provider CLI (`gh` for example) directly, no skill invocation without the user's explicit go-ahead, no tests without cause, no writes outside the working scope. If the ask crosses one, say so and hand back the exact command for the user to run.
- **Keep the answer attached.** Execution never replaces the explanation — the user asked "how", so the reply always includes the how *and then* the done-it.

## Common execution asks → canonical recipes

For the frequent tool-shaped asks, go straight to the canonical recipe (full command shape, flags, safety gates) instead of reconstructing an invocation; run it as written with the repo target set per the guard above. The hints below orient; the linked recipe is the truth.

| Ask | Recipe |
|---|---|
| Log an issue | [Deterministic issue creation](../../_shared/references/protocol-common.md#deterministic-issue-creation) — `DEVENV_REPO=<owner>/<repo>` env-prefix required (no `--repo` flag); non-interactive runs add `--type <type> --no-template --no-interactive --body-file <file>` |
| Comment on an issue | [`issue-comment`](../../_shared/references/protocol-common.md#issue-comment) — body via `--body` / `--body-file` (shared source-resolution contract in `_tools-reference.md`) |
| Update an issue | [`issue-update`](../../_shared/references/protocol-common.md#issue-update) — `--title` / `--body` / labels / assignees |
| Fetch an issue or its comments | `issue-get` · `issue-comment-list [--full]` |
| Anything else | `_tools-reference.md` for the tool's signature; the [wrapper protocol reference](../../_shared/references/protocol-common.md) for the recipe |
