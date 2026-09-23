---
name: devenv-commit
description: 'Review, craft, and create a commit — the only skill that commits, and only through the repo-commit tool. USE WHEN the user says "commit this", "let''s commit", "craft a commit message", "is this commit-worthy", "review my staged changes before commit", or is ready to land the current work. Interviews at invocation (review first?), reviews the STAGED diff only (warns on unstaged/untracked — never stages), evaluates atomicity and master-worthiness (suggests the git-wip lane for low-value work), crafts a convention-aware suggested message (commitlint config as oracle; plan context when present), warns on ephemeral plan references in messages, runs the DEVENV marker gate on the staged diff, then commits via repo-commit — which always opens the git editor; the editor save is the permission gate. Never runs tests, never checks hooks (infrastructure owns enforcement), never stages. DO NOT USE FOR running quality gates without committing (say "run pre-commit checks" and the checks-only flow applies, still no commit unless you confirm), opening a PR (use /devenv-open-pr), or code review (use /devenv-review).'
argument-hint: 'Optional: "--all" quality-gate scope, or a hint like "WIP" / "split this"'
user-invocable: true
---

# Commit

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

This is the only skill in the workspace permitted to create a commit — and it does so exclusively through the `repo-commit` tool, which always opens the user's configured git editor with the suggested message. **The editor save is the permission gate**: if the user empties the message or aborts the editor, no commit exists. The skill never commits directly with `git commit`.

## The two lanes

**Checks lane** — the historical behavior, kept intact: run the project's quality gates (lint, format, type-check, tests) against changed files, report all failures together, suggest (never silently apply) auto-fixes. Trigger phrases: "run pre-commit checks", "is this ready to commit". **The checks lane never commits.**

**Commit lane** — the new capability: review staged work, craft the message, evaluate the commit's worth, and create the commit through `repo-commit`. This lane runs only after the invocation interview confirms the user wants a commit.

## Invocation interview (commit lane, always)

At invocation, ask via the structured interview:

1. **Review first?** — "Review the staged changes before committing?" (yes, review first / no, go straight to message + commit / checks only — no commit)
2. If staging is empty at invocation, surface it immediately: *"Nothing is staged. Staging is manual — stage what you want committed (I never run `git add`), then tell me to proceed."* Stop there.

## Shared orientation (commit lane)

Run `skill-orient` at invocation for the staged/unstaged/untracked counts and any active plan (its context feeds message crafting). The staged-only review below remains the required detailed pass.

## Staged-only review (commit lane)

Review **what is staged** — `git diff --cached` — never the working tree at large.

- **Unstaged modifications** to files that also have staged changes → warn: *"foo.ts has staged changes AND further unstaged edits — only the staged state will commit."*
- **Untracked files** → list them; ask whether their absence is intentional (do not stage them, ever).
- **Unstaged-only files** → one-line note; no action.

The review covers: what changed at a glance (files, insertions/deletions, the shape of the diff), obvious hazards (debug leftovers, commented-out code, conflict markers, generated files), and the DEVENV marker gate below.

**Questions beget questions.** When the review surfaces something worth confirming — an unexpectedly large deletion, a file that seems unrelated to the stated intent, a suspicious-looking constant, a generated file that may or may not be intentional — **ask before proposing the message**, preferably as a structured interview (`vscode_askQuestions`, batched: one ask, all the questions). Don't silently fold doubts into the message; don't interrogate over trivia either — ask only what would change the message, the commit split, or the go-ahead.

## DEVENV marker gate (staged diff, blocking)

Run `devenv-marker-check` scoped to the staged files before proposing the commit:

- Any **plan-bounded `FIXME:DEVENV[...]`** marker added by this work → blocker: *"The staged diff introduces a FIXME marker — resolve it or convert it to the TODO form with a discharge condition before committing."*
- Any **condition-less `TODO:DEVENV[...]`** → blocker per the marker spec (a TODO without a discharge condition is a defect).
- Cross-plan `TODO:DEVENV[...]: ... — remove when <condition>` markers → sanctioned to ship; surface each in one line as a session constraint for the record.

## Atomicity and master-worthiness evaluation

Judge the staged work as a candidate for the permanent record:

- **Atomic?** One concern per commit. Mixed concerns → suggest splitting: name the groups (files + suggested message each) and let the user stage per group; offer per-group commits through this skill.
- **Master-worthy?** Would we want this permanently in the record? Red flags: broken intermediate state, debugging scaffolding, throwaway experiments, changes whose message would have to apologize for them.
- **Low-value verdict → suggest alternatives, never execute them:** the WIP lane (`git-wip` — a temporary snapshot commit recoverable via `git-unwip`) for not-yet-worthy work; a pairing session (`/devenv-pair`) for work that needs reshaping before it's worth recording. Suggestion only — the user decides and runs the tool.

## Commit message crafting

Derive the suggestion from the staged diff, in the target repo's convention:

- **Oracle:** the repo's `commitlint.config.js` — read it; repos extend `@commitlint/config-conventional` and may add custom types (this workspace's own config adds `major`/`minor`/`patch`). The config, not memory, is the authority on legal types. No commitlint config → conventional-commits defaults; say which convention you're following.
- **Subject:** `type(optional-scope): subject` — imperative mood, ≤ 72 chars, no trailing period. Derived from the dominant change.
- **Body:** short by default. Omit it for most commits — a well-written subject usually suffices. Add bullets only when the subject genuinely can't carry the information (non-obvious rationale, a deliberate trade-off, a follow-up obligation). Never pad; two high-value bullets beat five procedural ones.
- **Plan context:** when an active plan file exists (`.local-artifacts/Plan-*.md` in the repo), read its goals/ACs so the message describes how the change serves the whole, not just the diff mechanics. The plan informs the *message* — plan task numbers still never appear in it.
- **Mixed changes:** suggest split commits — one message per group, in order.

### Ephemeral-reference warning (message hygiene)

Before proposing the message, scan the draft for ephemeral workflow vocabulary: `Phase \d+`, `task \d+\.\d+`, `Plan-\d+`, `WIP`, `TODO`, `FIXME`, audit/report filenames, dates-as-annotations ("Phase 2 complete, all tests passing"). The commit is the permanent record: **durable information only** — what changed and why it matters, stated so it stays true after the workflow that produced it is forgotten. Workflow state belongs to the plan and the handbacks, not the history. Rewrite offenders as durable statements of what changed and why.

**Issue references are durable — include them when applicable.** An issue number is permanent, resolvable history, not ephemeral workflow state. When the staged work demonstrably relates to an issue — it implements it, fixes it, or advances it — reference it: `(#N)` at the end of the subject line, or on the relevant body bullet. Relevance is the bar: cite the issues the commit genuinely touches (check the branch name, staged content, and any active plan's issue linkage); never decorate a commit with numbers it doesn't relate to.

## Executing the commit — `repo-commit` only

When the user confirms, run:

```bash
repo-commit "<suggested message>"
```

Contract of the tool (enforced by the tool, not just this skill):

- The suggested message is pre-loaded into the **git editor, which always opens** — `repo-commit` prefers VS Code (`code --wait`) with nano as fallback when no editor is configured; it has no non-interactive path and refuses `-m`, `--yes`, option-shaped arguments, and known non-interactive editors (`true`, `:`, `echo`, …).
- The commit is created from the **existing index only**; unstaged work is never swept in.
- The user may edit the message freely in the editor; **their saved text is the commit message** — the suggestion is a starting point.
- Editor emptied or aborted → no commit, staged state untouched.
- Hooks run normally — the tool never bypasses them (`--no-verify` appears nowhere in its vocabulary).

After the commit: report the landed `hash subject`, and offer `/devenv-open-pr` if the branch's work is complete.

## Checks lane detail (unchanged behavior)

**Scope:** default changed files only — staged or modified since `git merge-base HEAD <default-branch>`; `--all` overrides to whole-project. Group by project root (`package.json`, `*.csproj`, `pyproject.toml`, `Cargo.toml`, `go.mod`); resolve commands from README → package scripts → devenv conventions (`pnpm test`, `dotnet test`) → ask. If detection finds nothing, stop and ask — don't guess.

**Checks, all run, all reported together:** format → lint → type-check → tests. Per-tool failure sections with file:line links; suggest auto-fixes, apply only with confirm (one confirm per tool), re-run only the fixed tool.

**Compatibility Layer Gate** (checks lane and commit lane both): scan changed files for shim-like markers (`shim`, `compat`, `adapter`, `legacy`, `bridge`); newly added test-only compatibility shapes require explicit user approval of the workaround path — unapproved, the gate is not clear. Shared [workaround decision policy](../common/references/workaround-decision-policy.md).

**Sequence with the commit lane:** if the user wants both checks and a commit, run the checks first; any failure blocks the commit proposal until fixed or explicitly waived by the user.

## What this skill never does

- **Never runs `git commit` directly** — commits go through `repo-commit`, whose editor gate makes every commit human-confirmed.
- **Never runs `git add`** — staging is the user's decision, always.
- **Never bypasses with `--no-verify`** or equivalent skip flags; the tool it calls doesn't either.
- **Never runs tests as a commit prerequisite** and never checks whether hooks are installed — infrastructure owns enforcement; the commit lane's gates are the marker gate and message hygiene, not test re-runs.
- **Never modifies hooks** (`.git/hooks/`, `.husky/`, …).
- **Never executes the WIP lane** — `git-wip` is a suggestion for the user, not a tool this skill invokes.
- **Never re-runs all checks after a single auto-fix** — only the fixed tool.

> **Micro-fix lane:** an explicit user ask to fix one reported failure ("just fix that lint error for me") may run in-session under the shared [incidental implementation protocol](../common/references/incidental-implementation-protocol.md) (micro ceiling, supervised handback). The never-runs boundaries above still apply inside the lane.

## Anti-patterns

- **Committing via raw `git commit` "since everything passed"** — the only commit path is `repo-commit`.
- **Staging on the user's behalf** — including "helpfully" staging a stray file; propose, never stage.
- **Treating an empty editor abort as a failure to retry** — it is the user declining the commit; stop.
- **Sweeping unstaged changes into the commit** — the tool prevents it; the skill must not route around it.
- **Skipping the marker gate** because "it's just a small commit."
- **Ephemeral vocabulary in the message** ("Phase 2 complete, all tests passing") — the permanent record must read as durable history, not session bookkeeping.
- **Executing the WIP lane for low-value work** — suggest `git-wip`; the user runs it.
- **Running hooks/tests as a commit precondition** — not this skill's job (the checks lane exists because the user asked for it, not as a hidden gate).
- **Stopping on first check failure** — run everything, report once.
- **Inventing commands** — if you can't detect a lint/test command, ask.
- **Suppressing or misclassifying failures** — report what the tool reported; match the project's strictness.

## Sibling skills

- `/devenv-open-pr` — once the work is committed and the branch is complete.
- `/devenv-review` — human-style review feedback on the diff (separate from automated checks).
- `/devenv-address-pr-comments` — if checks reveal issues that came from PR feedback.
- `/devenv-pair` / `/devenv-delegate` — execution skills; they never commit, and hand off here when the user says "commit this".

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
