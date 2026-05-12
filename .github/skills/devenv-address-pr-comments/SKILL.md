---
name: devenv-address-pr-comments
description: Walk through every unresolved review comment on a PR one at a time with interactive per-comment choices. USE WHEN the user says "address PR comments", "work through the review feedback", "go through the PR comments with me", "respond to reviewer comments one at a time", "let's address this PR review together", or wants a guided, comment-by-comment workflow with full control over each response. For each thread: surfaces comment + code context, asks who addresses it (AI / user / skip), reviews changes together, then offers to reply (AI-drafted) or resolve. Distinct from the GitHub PR extension's batch `address-pr-comments` (which reads all → fixes all → resolves all in one pass). DO NOT USE FOR batch-addressing without review (use the GitHub PR extension's `address-pr-comments`), opening a PR (use `/devenv-open-pr`), doing the code review yourself (use `/devenv-code-review`), or responding to CI failures.
argument-hint: PR number (auto-detected from current branch if omitted)
---

# Address PR comments

An interactive, one-comment-at-a-time workflow for working through PR review feedback. You stay in control of every decision: who addresses each comment, whether to reply, and whether to resolve the thread.

> **Do NOT run `--help` on any tool.** All CLI signatures are pre-documented in [`../_tools-reference.md`](../_tools-reference.md) — read that file instead.

**This is not a batch tool.** For a fast "fix everything and resolve all threads" pass, use the GitHub PR extension's `address-pr-comments` skill instead. This skill is for when you want to think through each comment with the AI as a partner.

## When to use this skill

- A reviewer left inline comments and you want to address them carefully, not all at once.
- Some comments need a code change (by you or the AI), others just need a reply or a resolve.
- You want AI-drafted replies that you edit before posting.
- You want a human in the loop for every code change — no auto-applying.

If you want to open a PR, use `/devenv-open-pr`. To review the code yourself, use `/devenv-code-review`. For CI failures on an open PR, fix them directly — this skill is for reviewer comments.

## Prerequisites

- A PR exists with unresolved review threads.
- `tools/pr-threads-get` returns at least one thread.
- The branch is checked out (for AI-addressed changes to apply cleanly).

## Flow

### Step 0 — Load and warn

1. Detect PR number: from argument, or `tools/pr-list --head <current-branch> --limit 1 | jq -r '.[0].number'`.
2. Run `tools/pr-threads-get <N>` (unresolved only, sorted by file then line).
3. If 0 threads: report "No unresolved review threads. Nothing to do." and stop.
4. If > 20 threads: warn upfront and offer to filter by file or reviewer before starting.
5. Show a brief summary: "N unresolved threads across M files. Starting with thread 1 of N."

### Step 1 — Surface the thread

For each thread, display:

```
─────────────────────────────────────────
Thread 2 of 7 — [src/auth/session.ts:88](src/auth/session.ts#L88)
─────────────────────────────────────────
@reviewer (2026-05-07):
> The token refresh here races with logout under load. Consider holding a lock
> or moving refresh into the logout path.

Code context:
  86:   if (token.isExpired()) {
  87:     await this.refreshToken();   // ← comment is on this line
  88:   }
  89:   await this.doLogout();

Classification: request-for-change
```

Classification is one of: `request-for-change` / `question` / `nit` / `praise` / `unclear`. Derive from tone and phrasing; show it but don't block on it.

### Step 2 — Who addresses it?

Ask:

```
Address this comment:
  [A] AI proposes a change
  [U] I'll make the change myself
  [S] Skip / no code change needed

Choice:
```

**A — AI addresses:**

1. AI reads the relevant file section and proposes a minimal change.
2. Shows the diff in chat.
3. Asks "Apply this change? (y/n/edit)". Never applies without confirmation.
4. On `y`: apply the edit.
5. On `edit`: user specifies adjustments, AI re-proposes.

**U — User addresses:**

1. AI waits: "Make the change, then press Enter (or type 'done') to continue."
2. Once the user signals done, AI reads the changed lines and shows a brief diff summary for confirmation.
3. No auto-review unless the user asks for it.

**S — Skip (no code change):**

Proceed immediately to step 3.

### Step 3 — Reply or resolve?

After the change decision (or skip):

```
What next for this thread?
  [R] Reply (I'll draft one for you to edit)
  [X] Resolve without replying
  [L] Leave open (move on, come back later)

Choice:
```

**R — Reply:**

1. AI drafts a context-appropriate reply based on what just happened:
   - Code was changed: "Done — <brief description of change>."
   - Skip / no change, question: "Good question — <answer or pointer>."
   - Skip / no change, nit or praise: "Noted, thanks!"
   - Disagreement: "I kept this as-is because <reason>. Happy to discuss."
2. Shows draft: "Proposed reply: `<text>` — Edit or send? (e/s)"
3. On `e`: user types their version.
4. On `s`: post via `tools/pr-thread-reply <N> --comment-id <id> --body "<reply>"`.
5. After posting: offer to also resolve the thread (since it was just replied to).

**X — Resolve without replying:**

Run `tools/pr-thread-resolve <thread-id>`.

**L — Leave open:**

Move on. Thread stays unresolved. The final summary will list it.

### Step 4 — Move to next thread

Repeat steps 1–3 until all threads are processed (or the user types `quit`/`done` to stop early).

### Step 5 — Summary

```
─────────────────────────────────────────
Done — 7 threads processed
─────────────────────────────────────────
  Addressed (AI):   3   (threads 1, 4, 6)
  Addressed (you):  1   (thread 3)
  Skipped:          1   (thread 5)
  Replied to:       5
  Resolved:         6
  Left open:        1   (thread 2 — token refresh race)
─────────────────────────────────────────
```

Suggest next steps:

- If any code was changed → "Run `/devenv-pre-commit` to verify quality gates."
- If threads left open → "Thread 2 is still open — revisit when ready."
- If all resolved → "All threads resolved. PR may be ready to merge."

## Guardrails

- **Never auto-apply a code change.** Every AI-proposed diff requires explicit `y` from the user.
- **Never auto-resolve a thread.** User must choose `X` or confirm after a reply.
- **Never auto-post a reply.** Draft is shown; user confirms before `pr-thread-reply` is called.
- **Skip threads where resolution is blocked** — if `pr-threads-get` shows a thread that can't be resolved (informational note, external bot comment), flag it and move on.
- **`--dry-run` propagates** — if invoked with `--dry-run`, all `pr-thread-reply` and `pr-thread-resolve` calls use `--dry-run` too.
- **`quit` at any prompt** exits the loop cleanly and shows the partial summary.

## Anti-patterns

- **Proposing a code change before reading the file** — always read the relevant section first.
- **Batch-resolving threads the user hasn't seen** — each thread must be surfaced before resolution.
- **Posting a reply without showing the draft** — the user edits the draft before it goes out.
- **Continuing past a failed `pr-thread-reply` or `pr-thread-resolve` call** — surface the error and ask whether to retry or leave open.
- **Treating praise as requiring action** — classify it as `praise`, offer one-click resolve, don't make the user read a wall of options.
- **Applying AI changes to files with uncommitted local edits** — warn and ask the user to stash first.

## Sibling skills

- `/devenv-code-review` — you do the reviewing; this skill is for addressing feedback you've received.
- `/devenv-open-pr` — for opening the PR before review starts.
- `/devenv-pre-commit` — run quality gates after making changes in response to comments.
- `/devenv-session-handoff` — if you need to stop mid-review and hand off to the next session.
- GitHub PR extension's `address-pr-comments` — for a fast batch-fix-all workflow without per-comment choices.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
