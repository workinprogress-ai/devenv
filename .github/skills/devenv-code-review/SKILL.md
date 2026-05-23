---
name: devenv-code-review
description: Review changed code and produce structured, actionable feedback. The inverse of `/devenv-delegation`: the human (or another agent) wrote the code, the AI reviews it. USE WHEN the user says "review this PR", "review my changes", "code review", "look over this branch", "review the diff", or hands off a PR / branch / local diff for assessment. Auto-detects input: a PR number → fetches via `pr-get` + `pr-diff`; two refs → diffs locally; nothing → defaults to current-branch-vs-default-branch. Produces a 1–2 sentence summary, then findings grouped by severity (Blocker / Concern / Nit / Praise) using the same hotspot bullet format as `/devenv-delegation`. Focuses only on what changed; flags missing tests; surfaces TODO/FIXME left in the diff. Default is print-to-chat; offers to post via `pr-comment` only with explicit confirmation. DO NOT USE for writing or refactoring code (use `/devenv-pair-programming` or `/devenv-delegation`), for resolving review comments on your own PR (use `/devenv-address-pr-comments`), or for general codebase Q&A.
argument-hint: PR number, two refs (--base BASE --head HEAD), or nothing (defaults to current branch vs. default branch)
---

# Code review

Review code changes and produce structured, actionable feedback. Inverse of `/devenv-delegation`: the human or another agent wrote the code; the AI reviews it.

> **Do NOT run `--help` on any tool.** All CLI signatures are pre-documented in [`../_tools-reference.md`](../_tools-reference.md) — read that file instead.

## When to use this skill

- Reviewing a PR before approving / requesting changes.
- Reviewing local work-in-progress before opening a PR.
- Reviewing a branch's diff against the default branch as a self-check.

If the user wants the AI to *write* or refactor code, use `/devenv-pair-programming` or `/devenv-delegation` instead. If the user wants to *respond to* review comments on their own PR, use `/devenv-address-pr-comments`.

## Inputs

The user provides one of:

- **A PR number** — e.g. `123`. Fetch via `pr-get N --pretty` (title, body, base/head refs, author, labels, draft state). Fetch the diff via `pr-diff N`.
- **Two refs** — e.g. `--base master --head my-feature`. Use `pr-diff --base BASE --head HEAD`.
- **Nothing** — default mode: diff the current branch against the repository's default branch (`master` or `main`). Use `pr-diff --base <default> --head HEAD`.

**Auto-detection rule:** `^[0-9]+$` → PR number. Two refs given → ref-diff mode. No args → current-branch-vs-default mode (announce this so the user knows what's being reviewed).

For the no-args mode: detect the default branch via `git symbolic-ref refs/remotes/origin/HEAD` (or fall back to `master` then `main`), and use the current branch as head.

## Workflow

### 1. Load context

- For PR mode: capture title, body, author, labels, draft status, base/head refs.
- For all modes: get the changed file list (`pr-diff --name-only` or `git diff --name-only`).
- Get the unified diff. If the diff exceeds ~1500 changed lines, warn the user and ask whether to proceed or narrow scope (e.g. specific files).
- If PR is in draft state, note it in the summary but proceed (drafts are valid review targets when explicitly requested).

### 2. Read the changes

- **Focus only on what changed.** Do not review unchanged code surrounding the diff unless context is needed to judge a change.
- Read each changed file's diff and any relevant unchanged context.
- Identify: new behavior, removed behavior, behavior changes, refactors, dead code removal, dependency changes, test changes.

### 3. Build the review

Output structure (markdown, in this order):

````markdown
## Code review — <PR title or "branch <head> vs. <base>">

**Source**: PR #123 (or `branch feature-x vs. master`)
**Files changed**: 12 (+340 / -85)
**Author**: @username (PR mode)
**Status note**: draft (only if applicable)

### Summary
<1–2 sentences: what this change does, plus your overall take ("looks good", "a few concerns", "needs significant rework", etc.)>

### Findings

#### 🛑 Blocker
- [repos/path/file.ts:42](repos/path/file.ts#L42) — <reason: correctness bug, security issue, breaking API change, missing critical test>

#### ⚠️ Concern
- [repos/path/file.ts:88](repos/path/file.ts#L88) — <reason: design issue, maintainability, performance, edge case not handled>

#### 💭 Nit
- (Skip this section unless a nit materially affects readability or correctness.)

#### ✅ Praise
- [repos/path/file.ts:120](repos/path/file.ts#L120) — <what's done well: clear abstraction, good test coverage, helpful comment, simplification>

### Missing tests
- <List new behavior in the diff that lacks corresponding test coverage. Empty list = explicit "tests cover the new behavior".>

### TODO/FIXME left in the diff
- [repos/path/file.ts:55](repos/path/file.ts#L55) — `// TODO: handle empty input`

### Questions for the author
- <Open questions where the diff isn't self-explanatory: "Is the retry count of 3 intentional or arbitrary?" "Why does this prefer X over Y?">
````

### 4. Severity rules

- **Blocker**: must change before merge. Correctness bugs, security issues, breaking changes without migration, missing critical tests, contract violations.
- **Concern**: should be discussed; may or may not block. Design choices that look risky, performance issues, edge cases, missing error handling at boundaries.
- **Nit**: only include if it materially affects readability or correctness. Skip pure style preferences.
- **Praise**: call out genuinely good work. Skip if there's nothing specific to praise — don't fabricate.

### 5. Hotspot format

Every finding is a single bullet in the format:

```
- [file:line](workspace-root-relative-path#L42) — <one-line reason>
```

Paths must be **workspace-root-relative** so VS Code renders them as clickable links — e.g. `repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs`, not just `BulkSyncWorker.cs`. Do not emit a path you haven't confirmed exists.

For ranges: `[file.ext:42-58](path/file.ext#L42-L58)`. For multiple non-contiguous lines: separate bullets.

### 6. Print to chat

Default: print the full review to chat. Do **not** post to GitHub yet.

### 7. Offer to post (PR mode only)

After printing, ask:

> "Post this review as a PR comment on #123 via `pr-comment 123 --body-file <temp-path>`?"

Use `vscode_askQuestions`. Wait for explicit yes. Do not auto-post.

For inline review comments tied to specific lines, note that this skill produces a top-level conversation comment only (via `pr-comment`). For inline threads, the user can use the GitHub web UI or `gh pr review` directly — there is no `tools/` wrapper for creating inline review comments.

## Anti-patterns

- **Reviewing unchanged code** — out of scope. Stick to the diff. If unchanged context reveals a problem, mention it in the summary, not as a hotspot finding.
- **Padding with nits** — empty `Nit` section is better than 20 bullets about formatting. Skip the section entirely if nothing material.
- **Fabricating praise** — don't manufacture a "Praise" entry to soften critical feedback. Skip the section if there's nothing specific to call out.
- **Auto-posting** — every push to GitHub requires explicit confirmation.
- **Reviewing without reading** — skim-based reviews produce vague findings. If the diff is too large to read carefully, narrow the scope or refuse.
- **Mixing review with rewrite** — this skill produces feedback. It does not modify the code under review. If the user wants fixes, switch to `/devenv-pair-programming` or `/devenv-delegation` after the review.

## Sibling skills

- `/devenv-delegation` — inverse: AI implements, human reviews. Same hotspot format.
- `/devenv-pair-programming` — interactive collaboration with review checkpoints during the work.
- `/devenv-pre-commit` — local-diff review before opening a PR (subset of this skill's no-args mode).
- `/devenv-address-pr-comments` — for the PR author responding to review comments.

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.
