---
name: devenv-address-pr-comments
description: 'Address PR review feedback with AI handling clear threads automatically and surfacing the complex ones for direction. USE WHEN the user says "address PR comments", "work through the review feedback", "go through the PR comments with me", "respond to reviewer comments", "let''s address this PR review together", "fix the nits", or wants any guided workflow for PR review feedback. Loads threads, classifies them, auto-fixes the clear ones (nits, obvious requests-for-change) with a single consent gate, then surfaces questions, informational/praise, and high-impact threads one by one with a recommendation. Offers a conventional commit suggestion at the end — never commits. DO NOT USE FOR opening a PR (use `/devenv-open-pr`), doing the code review yourself (use `/devenv-code-review`), or responding to CI failures.'
argument-hint: PR number (auto-detected from current branch if omitted)
user-invocable: true
---

# Address PR Comments

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Do NOT run `--help` on any tool.** All CLI signatures are pre-documented in [`../_tools-reference.md`](../_tools-reference.md) — read that file instead.

Load PR review threads, auto-fix what's clear, surface everything else for direction.

## The mental model

PR comments are not tasks in an implementation plan. They are messages from another human and each one is fundamentally different in nature:

- Some want a **code change** where the right fix is obvious.
- Some are **questions** — the reviewer wants to understand something, and may want to keep the conversation going.
- Some are **pushback** — the reviewer disagrees, and this needs discussion, not silent resolution.
- Some are **informational or praise** — the user may want to acknowledge them or just close them.
- Some are **high-impact or complex** — the right path requires a decision before any code is touched.

A reply and a code change can go together, but neither implies the other. And resolving a thread closes the conversation — which is wrong when the reviewer is expecting more back.

**Default resolution policy:**
- Code change applied → resolve after applying (unless the comment also has open questions)
- Reply to question → **leave open** by default (reviewer may respond)
- Pushback reply → **leave open** (this is a conversation, not a fix)
- Praise / informational → resolve if user confirms, leave open otherwise
- Nit addressed → resolve after applying

## When to use this skill

- A reviewer left inline comments and you want to address them efficiently, with the complex ones handled thoughtfully.
- You want the clear stuff done automatically and the nuanced stuff surfaced for your input.

For code review you do yourself, use `/devenv-code-review`. For CI failures, fix them directly — this skill is for reviewer comments.

## Prerequisites

- A PR exists with unresolved review threads.
- The branch is checked out (for code changes to apply cleanly).

---

## Phase 0 — Load and classify

1. Detect PR number: from argument, or `pr-list --head <current-branch> --limit 1 | jq -r '.[0].number'`.
2. Run `pr-threads-get <N>` (unresolved only).
3. If 0 threads: report "No unresolved review threads." and stop.
4. Classify each thread:

| Group | Classification | Signal |
|---|---|---|
| A | **Nit / style** | Minor formatting, naming, whitespace, preference |
| B | **Question** | Interrogative — reviewer is asking, not demanding |
| C — clear | **Request for change (clear)** | Reviewer wants a specific change; fix is unambiguous |
| C — complex | **Request for change (complex)** | Fix requires a decision, domain knowledge, or has wider impact |
| D | **Design / architecture** | Concerns about approach, scalability, structure |
| E | **Informational / praise** | Positive or FYI; no mandatory action |
| ? | **Needs clarification** | Thread intent is genuinely unclear; cannot classify confidently |

When a thread is ambiguous, classify **up** (D > C-complex > C-clear > B > A). A comment that combines a question with an implied change is at minimum C.

**What counts as "clear" (C-clear or A):** the correct change can be identified by reading the thread + the file alone, the change is localised (does not ripple to other files or callers), and no domain knowledge or architectural decision is required.

**Needs clarification (`?`):** if the thread's intent cannot be confidently determined — the comment is vague, uses pronouns without clear referents, or could mean multiple different things — mark it `?` and surface it with a note explaining the ambiguity. Never guess at what was meant.

---

## Phase 1 — Proposed plan + ask for adjustments

Show the AI's read of the threads and what it intends to do, then give the user a chance to adjust before any work starts:

```
─────────────────────────────────────────
PR #42 — 11 unresolved threads
─────────────────────────────────────────

Will fix automatically (5):
  A  format.ts:12     "extra blank line after import"
  A  utils.ts:22      "rename `tmp` → `tempBuffer`"
  A  utils.ts:45      "missing semicolon"
  A  types.ts:8       "prefer `type` over `interface` here"
  C  session.ts:88    "token refresh races with logout"  ← localised fix

Will surface for your direction (7):
  B  parser.ts:55     "why is this parsed twice?"          [question]
  B  db.ts:12         "is this intentional or a bug?"      [question]
  B  cache.ts:99      "should this be async?"              [question]
  C  auth.ts:34       "input not validated"                [needs domain knowledge]
  D  api.ts:120       "this approach won't scale"          [design concern]
  E  utils.ts:44      "great pattern here, love it"        [informational/praise]
  ?  config.ts:7      "this looks wrong"                   [needs clarification]

─────────────────────────────────────────
Any threads you'd like to handle yourself, or should I go ahead?
```

Accept free-form adjustments: "I'll take the nits", "skip the design comment", "do all of them". Echo any changes back, then wait for a go-ahead.

If any Group D threads exist, proactively note:
> "The design thread on api.ts:120 may be too complex to resolve inline. Once we've discussed it, I can offer to open an implementation plan."

---

## Phase 2 — Automatic threads

With the go-ahead, apply all threads in the "fix automatically" list. This is a **batch** — no per-thread `y` prompt. The single go-ahead at Phase 1 is the consent.

For each thread in order:
1. Read the relevant file section.
2. Apply the change.
3. Mark resolved via `pr-thread-resolve`.
4. Log it (one line): `✅ format.ts:12 — removed blank line → resolved`

After all automatic threads are done, show a compact batch summary:

```
─────────────────────────────────────────
Auto-fixed (5):
  ✅ format.ts:12   — removed blank line
  ✅ utils.ts:22    — renamed tmp → tempBuffer
  ✅ utils.ts:45    — added semicolon
  ✅ types.ts:8     — changed interface → type
  ✅ session.ts:88  — added lock around token refresh
─────────────────────────────────────────
```

If any automatic thread fails (file not found, change can't be applied cleanly, etc.): log it as `⚠️ [thread] — could not auto-fix: [reason]`, skip it, and add it to the surfaced list with the error as context.

---

## Phase 3 — Surfaced threads

Work through the surfaced threads one at a time. For each one, show:

```
─────────────────────────────────────────
Thread 1 of 6 — [parser.ts:55](parser.ts#L55)  🔗 [view on GitHub](<url>)
─────────────────────────────────────────
@reviewer (2026-05-14):
> Why is this parsed twice?

Code context:
  53:  const first = parse(input);
  54:  validate(first);
  55:  const second = parse(input);   ← comment is on this line
  56:  return second;

Classification: question
Recommendation: The second parse is redundant — `first` is already validated and
  could be returned directly. If you agree, I can remove the second call. If there's
  a reason for it (e.g. the validator mutates), a reply explaining why would close
  the question.

How do you want to handle this? (reply / fix / both / skip / mark complete)
─────────────────────────────────────────
```

**Shortcut resolution:** If the user says *"just mark complete"*, *"mark complete"*, or *"mark resolved"* — for **the current thread only** — skip the action flow: resolve immediately via `pr-thread-resolve` and move to the next thread. This covers threads the user has handled elsewhere or wants to close without discussion. It is not a blanket instruction for all remaining threads.

**Handling each surfaced thread based on user direction:**

- **`reply`** — draft a reply, show it, let the user edit. Send via `pr-thread-reply`. Default: leave open (reviewer may respond).
- **`fix`** — show before/after diff, wait for `y / n / edit` before applying. Mark resolved after applying.
- **`both`** — apply the fix, draft a reply explaining what was done, show both for approval, then apply and mark resolved.
- **`skip`** — note it in the summary as not yet addressed; leave open.
- **Praise / informational** — draft an optional acknowledgement reply (show it), then: `Resolve this one? (y / leave open)`.
- **Design / architecture (D)** — after discussing, offer: *"This looks complex enough to warrant a proper plan. Want me to open an implementation plan via `/devenv-create-implementation-plan`?"* If yes, capture the context and hand off. Leave unresolved; note in summary.

**Drafting replies:** Always show the draft before posting:

```
Proposed reply: "Good catch — removed the redundant parse call."
Send? (s / edit / skip)
```

On `edit`: user types their version. On `skip`: no reply posted.

---

## Phase 4 — Summary

```
─────────────────────────────────────────
Done — 11 threads
─────────────────────────────────────────
  Auto-fixed:      5  (4 nits + session.ts:88)
  You directed:    4  (parser.ts:55 + db.ts:12 + cache.ts:99 + auth.ts:34)
  Skipped:         1  (api.ts:120 — needs plan)
  Resolved:       10
  Left open:       1  (api.ts:120)
─────────────────────────────────────────
```

Then:
- If any code was changed → "Run `/devenv-pre-commit` before pushing."
- If threads left open → list each with a one-line reminder of what's pending.
- If an implementation plan was offered → remind the user to follow up with `/devenv-create-implementation-plan`.
- Offer a **commit suggestion** (see below).

### Commit suggestion

The AI never commits. At the end of the summary (or if the user asks at any point), offer a conventional commit message suggestion.

Follow the workspace's commitlint convention: `type(optional-scope): subject` where type is one of `fix`, `style`, `refactor`, `feat`, `docs`, `perf`, `test`, `chore`.

**If changes are small and cohesive** (e.g. all nits): suggest a single commit:
```
style: address nits from PR review
```

**If changes are mixed or one is significantly larger than the rest**, suggest separate commits — list each one:
```
Suggested commits (in order):

1. style: address nits from PR review
   (format.ts, utils.ts, types.ts — cosmetic only)

2. fix(auth): validate input on auth endpoint
   (auth.ts:34 — significant change, warrants its own commit)
```

The threshold for "significant enough to commit separately" is: the change touches a security boundary, alters public API behaviour, fixes a real bug, or is large enough that reverting it independently would be valuable.

Never suggest `git commit` commands or run any git operations. Only suggest the commit message text.

---

## Guardrails

- **Never commit or run git operations.** Suggest commit message text only.
- **Never make changes outside the scope of a comment.** Only touch what the comment directly requires. Do not fix nearby issues, improve adjacent code, or add unrelated refactors, even if they look obviously better.
- **Never guess at a thread's intent.** If the comment is ambiguous, surface it as `[needs clarification]` and ask the user before attempting anything.
- **Never apply an automatic-lane change without first reading the relevant file.** The go-ahead is consent to apply; it is not consent to guess.
- **Never apply a surfaced-thread code change without `y`.** Every before/after is shown and confirmed before applying.
- **Never post a reply without showing the draft.** User sees and approves every reply before it's sent.
- **Never resolve a question thread by default.** Questions leave the conversation open unless the user explicitly resolves.
- **Never resolve a pushback or disagreement thread.** These are conversations, not fixes.
- **When in doubt about whether a thread is "clear", surface it.** False positives in the surfaced list are cheap; unintended changes are not.
- **`quit` at any prompt** exits cleanly and shows the partial summary.
- **Uncommitted local edits:** before applying any code change, warn if affected files have dirty state.
- **`--dry-run` propagates** — all `pr-thread-reply` and `pr-thread-resolve` calls use `--dry-run`.

---

## Anti-patterns

- **Applying an automatic thread without reading the file first** — always read before editing.
- **Making changes beyond what a comment directly requires** — no opportunistic fixes or adjacent improvements.
- **Guessing at an ambiguous comment** — surface it as `[needs clarification]` instead.
- **Treating every comment as a code change request** — questions are not tasks; praise is not a bug.
- **Resolving a question thread after answering it** — leave it open; the reviewer may respond.
- **Resolving a pushback thread** — if you pushed back, the reviewer hasn't agreed yet. Leave it open.
- **Posting a reply without showing the draft** — the user edits every reply before it goes out.
- **Trying to inline-fix a design/architecture comment** — offer an implementation plan instead.
- **Using unified diff format** — always show before/after code blocks, not `+`/`-` lines.
- **Continuing past a failed tool call** — surface the error, ask whether to retry or leave open.
- **Suggesting a single commit when changes are of mixed significance** — significant fixes deserve their own commit.

---

## Sibling skills

- `/devenv-code-review` — you do the reviewing; this skill is for addressing feedback you've received.
- `/devenv-open-pr` — for opening the PR before review starts.
- `/devenv-pre-commit` — run quality gates after making changes in response to comments.
- `/devenv-create-implementation-plan` — for design/architecture threads too complex to resolve inline.
- `/devenv-session-handoff` — if you need to stop mid-review and hand off to the next session.
- GitHub PR extension's `address-pr-comments` — for a fast batch-fix-all workflow without per-comment choices.

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.
