---
name: devenv-pre-commit
description: Run the project's lint, format, type-check, and test commands against changed files as the last sanity pass before the user commits. USE WHEN the user says "run pre-commit checks", "lint and test before I commit", "is this ready to commit", "check my changes before commit", or has finished editing and wants quality gates verified before `git commit`. Auto-detects project type (package.json / *.csproj / pyproject.toml / etc.), reads commands from README and package.json scripts, and uses devenv conventions (`pnpm test`, `dotnet test`). Scopes to changed files since merge-base by default. Runs all checks, reports all failures together with file:line, suggests fixes when obvious, and offers to apply tool auto-fixes with confirm. **Never runs `git commit`, `git add`, `--no-verify`, or any git-mutating command** — explicitly the last step before YOU commit. DO NOT USE FOR opening a PR (use `/devenv-open-pr`), code review (use `/devenv-code-review`), or coverage regression checks.
argument-hint: Optional — `--all` to run on whole project instead of changed files
---

# Pre-commit

Run the project's quality gates (lint, format, type-check, tests) against changed files. Report all failures together. **Never commits.**

This is the last step before *you* commit. The skill stops at "the checks passed" or "here's what's broken" — it never runs `git commit`, `git add`, `--no-verify`, or any other git-mutating command.

## When to use this skill

- You've finished editing and want to verify quality gates before committing.
- You want to know whether lint/format/tests are clean before opening a PR.
- You want auto-fixes (formatter, lint --fix) applied to the changed files.

If you want to open a PR, use `/devenv-open-pr` (which assumes the work is committable). For code review, use `/devenv-code-review`.

## Detection

Detect the relevant project(s) for the changed files:

1. **Walk up from each changed file** to find a project root (`package.json`, `*.csproj`, `pyproject.toml`, `Cargo.toml`, `go.mod`).
2. **Group changes by project root** so a multi-repo workspace runs each project's commands separately.
3. **Resolve commands** in this order:
   - Documented in the project README (look for "Test", "Lint", "Format" sections).
   - `package.json` `scripts` (`lint`, `format`, `test`, `typecheck`, `check`).
   - Known devenv conventions: `pnpm test`, `pnpm lint`, `dotnet test`, `dotnet format`, `dotnet build`.
   - As a last resort, ask the user.

If detection finds nothing, stop and ask. Don't guess at commands that might not exist.

## Scope

**Default: changed files only** — files staged or modified since `git merge-base HEAD <default-branch>`.

- Run linters with explicit file arguments where the tool supports it (`eslint <files>`, `dotnet format --include <files>`).
- Run tests scoped to changed projects (don't re-test unrelated repos in a multi-repo workspace).
- For tools that can't be scoped (e.g. some type-checkers), run them at project level but only for projects with changes.

`--all` flag overrides to whole-project.

If there are no changed files, stop and tell the user — there's nothing to check.

## Checks

In order, but **run all of them and report all failures together** (don't stop on first failure):

1. **Format check** (e.g. `prettier --check`, `dotnet format --verify-no-changes`)
2. **Lint** (e.g. `eslint`, `dotnet format analyzers --verify-no-changes`)
3. **Type-check** (e.g. `tsc --noEmit`, `pyright`, `dotnet build`)
4. **Tests** (e.g. `pnpm test`, `dotnet test`)

## Compatibility Layer Gate

Before final sign-off, run a quick checklist for suspicious compatibility-layer changes introduced in this work:

1. Search changed files for shim-like markers (`shim`, `compat`, `adapter`, `extension`, `legacy`, `bridge`).
2. Identify any newly added test-only compatibility extensions or adapters that recreate old API shapes.
3. If found, require explicit confirmation that the user approved this workaround path.
4. If approval is not explicit, do not mark pre-commit as clear; report a blocker and ask whether to remove or revise the workaround.

Use the shared [workaround decision policy](../common/references/workaround-decision-policy.md).

For each check, capture exit code + stderr/stdout. After all are complete, present a single report.

## Report format

```markdown
## Pre-commit results

Scope: <N changed files in M project(s)>

### ✅ Passed
- format (prettier)
- typecheck (tsc)

### ❌ Failed

#### lint (eslint)
- [src/foo.ts:42](repos/my-lib/src/foo.ts#L42) — `'unused' is defined but never used`
- [src/bar.ts:10](repos/my-lib/src/bar.ts#L10) — `Missing return type on function`

  💡 Suggested fix: `pnpm eslint --fix src/foo.ts src/bar.ts`
  Apply auto-fix? (y/n)

#### tests (pnpm test)
- [tests/baz.test.ts:88](repos/my-lib/tests/baz.test.ts#L88) — `expected 3, got 2`

  No obvious auto-fix — review and update.
```

Per-tool sections only when there are failures. Skip the "Passed" section if everything passed (just say "All checks passed").

## Auto-fix policy

- **Suggest** any auto-fix the tool supports.
- **Apply** only with confirm. One confirm per tool (not per file).
- **Re-run that tool only** after applying, to verify the fix didn't introduce new issues.
- Never apply test fixes automatically (no test code is auto-fixable in a meaningful way).

## What this skill never does

- **Never runs `git commit`** — that's the user's job.
- **Never runs `git add`** — staging is the user's decision.
- **Never bypasses with `--no-verify`** or equivalent skip flags.
- **Never modifies hooks** (`.git/hooks/`, `.husky/`, etc.) — this skill replaces hooks for the duration of an interactive session, it doesn't install them.
- **Never re-runs all checks after a single auto-fix** — only re-runs the tool that was fixed.

## Anti-patterns

- **Running `git commit` "since everything passed"** — the user commits.
- **Stopping on first failure** — run everything, report once.
- **Running whole-project checks when only one file changed** — wasteful; scope to changed files.
- **Inventing commands** — if you can't detect a lint/test command, ask. Don't guess `npm test` for a non-Node project.
- **Applying auto-fixes without confirm** — even "obviously safe" formatter fixes need confirmation; the user might be in the middle of staging.
- **Suppressing failures** — don't filter out warnings the project considers errors. Report what the tool reported.
- **Treating warnings as failures (or vice versa)** — match the project's strictness. If the project's CI fails on warnings, so should this skill.
- **Clearing pre-commit with unapproved workaround shims** — compatibility bridges added only to force tests/build to pass require explicit user agreement.

## Sibling skills

- `/devenv-open-pr` — once checks pass and you've committed, open the PR.
- `/devenv-code-review` — for human-style review feedback on the diff (separate from automated checks).
- `/devenv-address-pr-comments` — if checks reveal issues that came from PR feedback.

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.
