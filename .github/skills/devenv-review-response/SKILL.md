---
name: devenv-review-response
description: Walk through PR review comments interactively — with an upfront summary, free-form batch instructions, and a per-thread interactive lane. USE WHEN the user says "address PR comments", "work through the review feedback", "go through the PR comments with me", "respond to reviewer comments one at a time", "let's address this PR review together", "fix all nits", or wants any guided workflow for PR review feedback. Starts with a classified summary and intent prompt; supports free-form instructions ("fix all nits then walk me through the blockers"), batch auto-resolve with single confirm, and per-thread interactive mode. Distinct from the GitHub PR extension's batch `address-pr-comments`. DO NOT USE FOR batch-addressing without review (use the GitHub PR extension's `address-pr-comments`), opening a PR (use `/devenv-open-pr`), doing the code review yourself (use `/devenv-code-review`), or responding to CI failures.
argument-hint: PR number (optional: --interactive, --auto; auto-detected from branch if omitted)
---

# Review response

An interactive workflow for working through PR review feedback — from a quick "fix everything" to a careful thread-by-thread review. You stay in control at every stage.

> **Do NOT run `--help` on any tool.** All CLI signatures are pre-documented in [`../_tools-reference.md`](../_tools-reference.md) — read that file instead.

## When to use this skill

- A reviewer left inline comments and you want to work through them with the AI.
- You want to batch-handle easy items (nits, praise) and carefully review impactful ones.
- You want to give free-form instructions: "fix all nits, then walk me through the blockers".
- You want a human in the loop for code changes — no silent auto-applying.

If you want to open a PR, use `/devenv-open-pr`. To review code yourself, use `/devenv-code-review`. For CI failures, fix them directly — this skill is for reviewer comments.

## Invocation flags

- `--interactive` — skip the intent prompt and go straight to per-thread mode
- `--auto` — skip the intent prompt and auto-resolve everything (still shows a batch confirm before executing)

## Prerequisites

- A PR exists with unresolved review threads.
- The branch is checked out (for AI-addressed changes to apply cleanly).

---

## Flow

### Phase 0 — Load threads

1. Detect PR number: from argument, or `tools/pr-list --head <current-branch> --limit 1 | jq -r '.[0].number'`.
2. Run `tools/pr-threads-get <N>` (unresolved only).
3. If 0 threads: report "No unresolved review threads. Nothing to do." and stop.
4. Classify each thread as one of: `blocker` / `question` / `nit` / `praise` / `unclear`. Derive from tone and phrasing. A thread is a `blocker` when the reviewer explicitly requests a change or flags correctness/safety; `nit` when it is style/formatting/minor; `question` when it is interrogative without a demanded change; `praise` when positive.

### Phase 1 — Upfront summary + intent

Show the classified summary:

```
─────────────────────────────────────────
PR #99 — 12 unresolved threads across 5 files

  Blockers  (2):  session.ts:88, auth.ts:34
  Questions (3):  parser.ts:12, db.ts:55, cache.ts:9
  Nits      (6):  format.ts:12 + 5 others
  Praise    (1):  utils.ts:44
─────────────────────────────────────────
How would you like to proceed?
  [1] Walk through all one at a time
  [2] Auto-resolve everything (show batch confirm first)
  [3] Give instructions (free form)
  [4] Filter first (by file or type)
```

Accept a number **or** free-form text at this prompt — the user can type `3` or just type their instructions directly without selecting `3` first. Both are equivalent.

**If `--interactive`:** skip to Phase 3, processing all threads.
**If `--auto`:** skip to Phase 2B, building a "resolve all" plan.

### Phase 2 — Build the execution plan

#### 2A — Parse free-form instructions

When the user gives free-form instructions, extract a strategy per classification group. Examples:

| User says | Parsed plan |
|---|---|
| "Fix all nits automatically, then walk me through the blockers" | Nits → auto; Blockers → interactive; Questions/Praise → ask |
| "Fix everything except the auth.ts one, that one I'll handle" | All → auto except `auth.ts` thread(s) → user-addressed |
| "Just resolve the praise and nits silently, skip the rest" | Praise + Nits → auto-resolve; Blockers + Questions → skip |
| "Walk me through everything" | All → interactive |

After parsing, **always echo the plan back before executing anything:**

```
─────────────────────────────────────────
Plan
─────────────────────────────────────────
  Nits (6)       → AI fixes + resolves automatically
  Blockers (2)   → interactive, one at a time
  Questions (3)  → skipped (left open)
  Praise (1)     → resolve silently

Proceed? (y / edit)
```

On `edit`: user adjusts the plan in free form; re-echo before executing.

#### 2B — Auto-resolve plan (option 2 or --auto)

Build a "resolve all" plan where every thread is auto-handled:

- `blocker` / `question` / `unclear` → AI proposes a fix or reply
- `nit` / `praise` → resolve silently (or with a brief "Thanks!" for praise)

Echo the plan in the same format as 2A and require `y` before proceeding.

### Phase 3 — Execute: auto lanes

For each thread assigned to the **auto lane**, process silently and accumulate into a batch confirm:

For `nit` / `praise` → resolve only (no code change, no reply unless classification is `unclear`).  
For `blocker` / `question` → AI reads the file, proposes a minimal change or reply, adds to the pending batch.

After processing all auto-lane threads, show a single batch confirmation:

```
─────────────────────────────────────────
Ready to apply (6 auto-lane threads)
─────────────────────────────────────────
  format.ts:12   — removed trailing blank line         [resolve]
  utils.ts:22    — renamed `tmp` → `tempBuffer`        [resolve]
  utils.ts:44    — (praise) resolve silently            [resolve]
  session.ts:55  — added null-check before assignment  [resolve]
  … (2 more)

Apply all and resolve threads? (y / n / review-each)
```

- `y` — execute all writes and resolves.
- `n` — discard; fall back to interactive for each.
- `review-each` — step through the auto-lane items one at a time before committing.

### Phase 4 — Execute: interactive lane

For each thread assigned to the **interactive lane**, display:

```
─────────────────────────────────────────
Thread 2 of 4 (interactive)
📄 [src/auth/session.ts:88](src/auth/session.ts#L88)  🔗 [view on GitHub](<comments[0].url>)
─────────────────────────────────────────
@reviewer (2026-05-07):
> The token refresh here races with logout under load. Consider holding a lock
> or moving refresh into the logout path.

Code context (lines 86–89):
  86:   if (token.isExpired()) {
  87:     await this.refreshToken();
  88:   }
  89:   await this.doLogout();

Classification: blocker
─────────────────────────────────────────
  [1] AI fixes it → reply + resolve
  [2] AI fixes it → resolve (no reply)
  [3] I'll fix it (wait for me)
  [4] Reply only → resolve
  [5] Resolve silently
  [6] Skip (leave open)
```

**Links:**

- **📄 VS Code link** — `[<path>:<line>](<path>#L<line>)` using `path` and `line` from `pr-threads-get` output. Opens the file at that line in the editor.
- **🔗 GitHub link** — `comments[0].url` from `pr-threads-get` output, verbatim. Opens the comment in the browser. Do not reconstruct this URL.

Also accept free-form input at this prompt — e.g. "fix it but use a mutex instead of a lock" — and treat it as option 1 with the additional instruction folded in.

**[1] / [2] — AI fixes:**

1. Read the relevant file section.
2. Show before/after blocks (not unified diff):

````
Before:
```ts
await this.refreshToken();
await this.doLogout();
```
After:
```ts
await this.doLogout(); // token cleanup moved into logout path
```
Apply? (y / n / edit)
````

3. On `y`: apply the edit.
4. On `edit`: user describes the adjustment; AI re-proposes.
5. If [1]: draft a reply ("Done — moved token cleanup into logout path."), show it, confirm, post via `tools/pr-thread-reply <N> --comment-id <id> --body "<reply>"`, then `tools/pr-thread-resolve <thread-id>`.
6. If [2]: resolve directly via `tools/pr-thread-resolve <thread-id>`.

**[3] — User fixes:**

Say "Make the change, then type 'done' to continue." Wait. On `done`: read the changed lines, show a brief diff summary, confirm, then offer [1]/[2] style reply+resolve options.

**[4] — Reply only:**

Draft a context-appropriate reply, show it, confirm, post via `tools/pr-thread-reply`, then resolve.

**[5] — Resolve silently:**

Run `tools/pr-thread-resolve <thread-id>` immediately.

**[6] — Skip:**

Move on. Thread stays unresolved; flagged in the final summary.

### Phase 5 — Resolution summary

```
─────────────────────────────────────────
Done — 12 threads
─────────────────────────────────────────
  Auto-resolved:    6  (nits + praise)
  AI-addressed:     3  (blockers: session.ts:88, auth.ts:34, parser.ts:12)
  You addressed:    1  (blocker: cache.ts:9)
  Skipped:          2  (questions: db.ts:55, cache.ts:9)
  Left open:        0

Changes made across 4 files.
─────────────────────────────────────────
```

Then:

- If any code was changed → offer "Run `/devenv-pre-commit` to verify quality gates."
- If threads left open → list them with a one-line reminder of each comment.
- If all resolved → "All threads resolved. PR may be ready to merge — check with the reviewer."
- Always offer: "Want to review the changes before pushing? (git diff HEAD)"

---

## Guardrails

- **Never auto-apply a code change without showing before/after first.** Every AI-proposed edit requires explicit `y`.
- **Never execute the auto-lane batch without the single batch confirm.** The plan echo + `y` is mandatory even for `--auto`.
- **Never post a reply without showing the draft.** User confirms before `pr-thread-reply` is called.
- **Echo the parsed plan back before executing free-form instructions.** Misinterpretation must be catchable before anything runs.
- **Never resolve a thread the user has not seen.** Auto-lane threads are shown in the batch confirm summary before resolving.
- **Skip threads where resolution is blocked** — if `pr-threads-get` shows a thread that can't be resolved (bot comment, informational), flag it and move on.
- **`--dry-run` propagates** — all `pr-thread-reply` and `pr-thread-resolve` calls use `--dry-run`.
- **`quit` at any prompt** exits cleanly and shows the partial summary.
- **Uncommitted local edits** — before applying any AI code change, check for dirty files in the affected paths and warn/ask to stash first.

## Anti-patterns

- **Proposing a code change before reading the file** — always read the relevant section first.
- **Using unified diff (`+`/`-`) format** — always show before/after code blocks instead.
- **Silently resolving threads in the interactive lane** — every resolution requires an explicit user choice.
- **Continuing past a failed tool call** — surface the error, ask whether to retry or leave open.
- **Mis-classifying a blocker as a nit** — when in doubt, classify up (blocker > question > nit).
- **Parsing free-form instructions without echoing the plan** — always echo before executing.

## Sibling skills

- `/devenv-code-review` — you do the reviewing; this skill is for addressing feedback you've received.
- `/devenv-open-pr` — for opening the PR before review starts.
- `/devenv-pre-commit` — run quality gates after making changes in response to comments.
- `/devenv-session-handoff` — if you need to stop mid-review and hand off to the next session.
- GitHub PR extension's `address-pr-comments` — for a fast batch-fix-all workflow without per-comment choices.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
