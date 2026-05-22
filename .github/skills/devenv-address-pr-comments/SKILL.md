---
name: devenv-address-pr-comments
description: 'Work through PR review feedback collaboratively — grouped by type, with a suggested AI/user split, and per-thread control over code changes, replies, and resolution. USE WHEN the user says "address PR comments", "work through the review feedback", "go through the PR comments with me", "respond to reviewer comments", "let''s address this PR review together", "fix the nits", or wants any guided workflow for PR review feedback. Groups threads into Nits / Questions / Requests-for-change / Design+Architecture / Praise; suggests who should handle each group; lets the user adjust the split; then both work their items with full control over code, replies, and whether to resolve. Understands that PR comments are not always code changes — some are questions, pushbacks, or conversations, and resolving too eagerly shuts down discussion. DO NOT USE FOR opening a PR (use `/devenv-open-pr`), doing the code review yourself (use `/devenv-code-review`), or responding to CI failures.'
argument-hint: PR number (auto-detected from current branch if omitted)
user-invocable: true
---

# Address PR Comments

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Do NOT run `--help` on any tool.** All CLI signatures are pre-documented in [`../_tools-reference.md`](../_tools-reference.md) — read that file instead.

Work through PR review feedback together. Threads are grouped by type and split between AI and user based on what makes sense for each. Both work their items with full control at every step.

## The mental model

PR comments are not tasks in an implementation plan. They are messages from another human and each one is fundamentally different in nature:

- Some want a **code change**.
- Some are **questions** — the reviewer wants to understand something, and may want to keep the conversation going.
- Some are **pushback** — the reviewer disagrees, and this needs discussion, not silent resolution.
- Some are **praise** — no action needed at all.
- Some are a **mix** — a question that also implies a code change if the answer is yes.

A reply and a code change can go together, but neither implies the other. And resolving a thread closes the conversation — which is wrong when the reviewer is expecting more back.

**Default resolution policy:**
- Code change → resolve after applying (unless the comment also has open questions)
- Reply to question → **leave open** by default (reviewer may respond)
- Pushback reply → **leave open** (this is a conversation, not a fix)
- Praise → resolve silently
- Nit addressed → resolve after applying

The user has the final say on resolution for every thread.

## When to use this skill

- A reviewer left inline comments and you want to address them thoughtfully.
- Some comments need a code change, others a reply, others just acknowledgement.
- You want AI-drafted replies you can edit before posting.
- You want a human in the loop for every code change.

For a fast "fix everything" pass without per-comment choices, use the GitHub PR extension's `address-pr-comments`. To review code yourself, use `/devenv-code-review`. For CI failures, fix them directly — this skill is for reviewer comments.

## Prerequisites

- A PR exists with unresolved review threads.
- The branch is checked out (for AI-addressed code changes to apply cleanly).

---

## Phase 0 — Load and classify

1. Detect PR number: from argument, or `pr-list --head <current-branch> --limit 1 | jq -r '.[0].number'`.
2. Run `pr-threads-get <N>` (unresolved only).
3. If 0 threads: report "No unresolved review threads." and stop.
4. Classify each thread into one of five groups:

| Group | Classification | Signal |
|---|---|---|
| A | **Nit / style** | Minor formatting, naming, whitespace, preference |
| B | **Question** | Interrogative — reviewer is asking, not demanding |
| C | **Request for change** | Reviewer wants specific code changed |
| D | **Design / architecture** | Concerns about approach, scalability, structure |
| E | **Praise** | Positive; no action expected |

When a thread is ambiguous, classify **up** (D > C > B > A). A comment that combines a question with an implied change is a request for change.

---

## Phase 1 — Grouped summary and suggested split

Show all threads grouped, with a suggested owner for each, and a top-level split recommendation:

```
─────────────────────────────────────────
PR #42 — 11 unresolved threads across 4 files
─────────────────────────────────────────

GROUP A — Nits / style (4)                        → suggested: AI
  format.ts:12   "extra blank line after import"
  utils.ts:22    "rename `tmp` → `tempBuffer`"
  utils.ts:45    "missing semicolon"
  types.ts:8     "prefer `type` over `interface` here"

GROUP B — Questions (3)                           → suggested: You
  parser.ts:55   "why is this parsed twice?"
  db.ts:12       "is this intentional or a bug?"
  cache.ts:99    "should this be async?"

GROUP C — Requests for change (2)                 → suggested: split
  session.ts:88  "token refresh races with logout"    → AI (localised fix)
  auth.ts:34     "input not validated"                → You (knows domain rules)

GROUP D — Design / architecture (1)               → suggested: You + consider a plan
  api.ts:120     "this approach won't scale to multi-tenant"

GROUP E — Praise (1)                              → suggested: AI resolves silently
  utils.ts:44    "great pattern here, love it"

─────────────────────────────────────────
Suggested: AI takes Groups A + E + session.ts:88 | You take Groups B + C(auth.ts) + D

Adjust the split, or say "looks good" to proceed:
```

Accept free-form adjustments: "I'll take the nits too", "do all the requests for change", "skip the design comment for now". Echo the revised split back before starting work.

If any Group D threads exist, proactively note:
> "The design thread on api.ts:120 may be too complex to resolve inline. Once we've discussed it, I can offer to open an implementation plan."

---

## Phase 2 — Work

Once the split is agreed, both lanes proceed. AI works its items; user works theirs. Either party can pause to review or ask a question at any time.

### AI lane — per-thread protocol

For each AI-lane thread, surface it:

```
─────────────────────────────────────────
[AI] Thread 1 of 6 — [src/format.ts:12](src/format.ts#L12)  🔗 [view on GitHub](<comments[0].url>)
─────────────────────────────────────────
@reviewer (2026-05-14):
> Extra blank line after import block.

Code context:
  10:  import { foo } from './foo';
  11:
  12:                                   ← comment is on this line
  13:  export function bar() {

Classification: nit
Proposed action: remove blank line → resolve
─────────────────────────────────────────
```

**Deciding the action:** Before proposing anything, determine whether this thread needs:
- A **code change** (nit, request-for-change)
- A **reply** (question, pushback, complex explanation)
- **Both** (change + explanation of what was done)
- **Neither** (praise — resolve silently)

For nits and straightforward requests-for-change, propose the change:

```
Before:
  10:  import { foo } from './foo';
  11:
  12:

After:
  10:  import { foo } from './foo';
  11:

Apply? (y / n / edit)
```

Never apply without `y`. On `edit`: user describes adjustment; re-propose.

For questions the AI can answer, draft a reply directly — no code change unless the answer implies one.

After any action, determine resolution:

```
Resolve this thread? (y / leave open)
  [default shown in brackets based on thread type]
```

Default is:
- Nit / request-for-change addressed → `y`
- Question answered → `leave open`
- Pushback reply → `leave open`
- Praise → `y` (silent, no prompt needed)

**Drafting replies:** For any thread that gets a reply (all types except silent praise), show the draft:

```
Proposed reply: "Done — removed the extra blank line."
Send? (s / edit / skip)
```

On `edit`: user types their version. On `skip`: no reply posted. On `s`: post via `pr-thread-reply <N> --comment-id <id> --body "<text>"`.

**For design/architecture threads:** After discussing in chat, offer:
> "This looks complex enough to warrant a proper plan rather than an inline fix. Want me to open an implementation plan for this via `/devenv-create-implementation-plan`?"

If yes, capture the thread details and context, then hand off. The thread stays unresolved; note it in the summary.

### User lane — protocol

Tell the user which threads are theirs and give a brief summary of each:

```
Your threads:
  B1 — parser.ts:55  "why is this parsed twice?"
  B2 — db.ts:12      "is this intentional or a bug?"
  B3 — cache.ts:99   "should this be async?"
  C2 — auth.ts:34    "input not validated"
  D1 — api.ts:120    "this approach won't scale to multi-tenant"

Work through them whenever you're ready. For each one, let me know:
- What you did (code change, reply, skip)
- Whether you want help drafting a reply
- Whether to resolve it

I'll wait. Type "done with [thread]" when you've finished one and want to move on.
```

When the user signals done with a thread:
- If code was changed: read the relevant lines and give a brief acknowledgement (not a full review unless asked).
- If they want help drafting a reply: draft one, show it, let them edit.
- Ask: "Resolve this one? (y / leave open)"
- Default: follow the same resolution policy as the AI lane.

Don't rush the user. They can work threads in any order and take breaks.

---

## Phase 3 — Summary

```
─────────────────────────────────────────
Done — 11 threads
─────────────────────────────────────────
  AI addressed:     5  (4 nits + session.ts:88 + 1 praise)
  You addressed:    4  (B1–B3 + auth.ts:34)
  Left open:        2  (db.ts:12 — awaiting reply; api.ts:120 — needs plan)
  Resolved:         9
  Unresolved:       2
─────────────────────────────────────────
```

Then:
- If any code was changed → "Run `/devenv-pre-commit` before pushing."
- If threads left open → list each with a one-line reminder of what's pending.
- If an implementation plan was offered → remind the user to follow up with `/devenv-create-implementation-plan`.
- If all resolved → "All threads resolved. PR may be ready for another look from the reviewer."

---

## Guardrails

- **Never apply a code change without `y`.** Every AI-proposed edit is shown as before/after and requires explicit confirmation.
- **Never post a reply without showing the draft.** User sees and approves every reply before it's sent.
- **Never resolve a question thread by default.** Questions leave the conversation open unless the user explicitly resolves.
- **Never resolve a pushback or disagreement thread.** These are conversations, not tasks.
- **Never batch-resolve threads the user hasn't seen.** Every thread is surfaced before action.
- **When in doubt about resolution, ask.** The default policy is a guide, not a rule.
- **`quit` at any prompt** exits cleanly and shows the partial summary.
- **Uncommitted local edits:** before applying any AI code change, warn if affected files have dirty state.
- **`--dry-run` propagates** — all `pr-thread-reply` and `pr-thread-resolve` calls use `--dry-run`.

---

## Anti-patterns

- **Proposing a code change before reading the file** — always read the relevant section first.
- **Treating every comment as a code change request** — questions are not tasks; praise is not a bug.
- **Resolving a question thread after answering it** — leave it open; the reviewer may respond.
- **Resolving a pushback thread** — if you pushed back, the reviewer hasn't agreed yet. Leave it open.
- **Posting a reply without showing the draft** — the user edits every reply before it goes out.
- **Trying to inline-fix a design/architecture comment** — offer an implementation plan instead.
- **Rushing the user lane** — the user works their threads in their own time; don't prompt repeatedly.
- **Continuing past a failed tool call** — surface the error, ask whether to retry or leave open.
- **Using unified diff format** — always show before/after code blocks, not `+`/`-` lines.

---

## Sibling skills

- `/devenv-code-review` — you do the reviewing; this skill is for addressing feedback you've received.
- `/devenv-open-pr` — for opening the PR before review starts.
- `/devenv-pre-commit` — run quality gates after making changes in response to comments.
- `/devenv-create-implementation-plan` — for design/architecture threads too complex to resolve inline.
- `/devenv-session-handoff` — if you need to stop mid-review and hand off to the next session.
- GitHub PR extension's `address-pr-comments` — for a fast batch-fix-all workflow without per-comment choices.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
