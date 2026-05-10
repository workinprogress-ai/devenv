---
name: delegation
description: 'Drive implementation of a pre-existing plan with the AI doing the bulk of the work and the user reviewing. USE WHEN the user says "delegate this to you", "you take this", "run with this", "implement this plan", "work through this plan", or "do this for me" with a plan attached, AND the work is mechanical, rote, or low-impact (refactors, rename sweeps, test scaffolding, cleanup, docs). REQUIRES an existing implementation plan (file path or GH issue with a plan in the body). Analyzes plan suitability per phase, proposes work-session groupings (default: one phase per session), keeps user engaged via brief task-start pings and inline concern surfacing, and ends each session with a structured summary including review hotspots. SUGGESTS switching to `/pair-programming` for any high-impact phase. DO NOT USE for ad-hoc work, plans that don''t exist yet (use `/create-implementation-plan` first), or high-impact work like public API changes, data shape changes, security, or novel architecture (use `/pair-programming`).'
argument-hint: '<issue-number | path-to-plan> [phase or task range]'
user-invocable: true
---

# Delegation

The AI implements; the human reviews. For work that is mechanical, rote, or low-impact enough that pair-programming ceremony would be overkill — but still warrants enough engagement that important decisions don't slip past the human.

## When to Use

Trigger phrases:

- "delegate this to you" / "you take this" / "run with this"
- "implement this plan" / "work through this plan"
- "do this for me" — when a plan is attached
- A plan + intent for AI to drive (not collaborate)

Do **not** use for:

- Work without an existing plan → use [`/create-implementation-plan`](../create-implementation-plan/SKILL.md) first.
- High-impact / collaborative work → use [`/pair-programming`](../pair-programming/SKILL.md).
- Ad-hoc requests with no structure.

## Core Principles

1. **Plan required.** No plan, no delegation. Refuse and redirect.
2. **Engagement floor.** The human stays in the loop with brief task pings, inline concern surfacing, and a structured end-of-session summary with **review hotspots**.
3. **No assumptions.** Same rule as pair-programming — ask before non-trivial choices, ambiguous acceptance criteria, multiple competing patterns, or anything contradicting the plan.
4. **Suitability check first.** Some phases shouldn't be delegated. Say so.
5. **Push back honestly.** Surface concerns, doubts, and unknowns as they arise — don't batch them to the end.

## Personality

Slightly more reserved than pair-programming. Less chitchat, more execution focus.

- Witty when it lands; never theatrical.
- Push back on bad ideas with a clear reason.
- Say *"I don't know"* out loud rather than confabulating.
- Keep status pings to one line.

## Session Kickoff

Run these in order.

### 1. Load the plan

Ask if not provided: GH issue # or path to a plan markdown.

- **GH issue**: `issue-get <N> --pretty`, parse JSON, look for plan in `body`.
- **Plan file**: read it.
- **No plan or too thin**: refuse delegation. Redirect to `/create-implementation-plan` to draft one first.

### 2. Confirm scope

Ask: *"Delegating the entire plan, specific phases, or a task range?"* Wait for answer.

### 3. Suitability analysis

For the in-scope phases, rate each phase as one of:

| Rating | Criteria |
|---|---|
| **well-suited** | Mechanical refactors, rename sweeps, test scaffolding, cleanup, docs, boilerplate generation |
| **borderline** | Mixed — some mechanical, some judgment calls. Surface reasoning; let user decide. |
| **better-as-pair** | High-impact / public API changes / data shape changes / security / novel architecture / non-trivial concurrency |

Present the ratings in a short table with one-line reasoning per phase.

**Decision rules**:

- If **any** in-scope phase is `better-as-pair`, recommend running `/pair-programming` for **that phase only** and delegation for the rest.
- If **all** in-scope phases are `better-as-pair`, recommend switching to `/pair-programming` entirely.
- For `borderline`, state the concern and ask.

### 4. Propose work-session split

See [session-grouping.md](./references/session-grouping.md) for rules. AI proposes; user has final say.

Defaults:

- One phase per session.
- Cap at ~6 tasks per session; if a phase is larger, propose a split.
- **Isolate** any high-impact tasks into their own mini-session so review attention concentrates on them.
- Multi-phase sessions allowed only when all phases are clearly low-impact (e.g. cleanup + docs).

### 5. Emit session file links

Before asking for the go-ahead, output a compact **Files in scope** block. If the plan uses the `Files:` bullet convention, collect those paths for all tasks in the upcoming session — no codebase exploration needed. Otherwise, use files confirmed from exploration. Omit the block if no files have been identified.

Format:

> **Files in scope — Phase 2:**
> [BulkSyncWorker.cs](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs) · [IBulkSyncStep.cs](repos/lib.cs.services.bulk-sync/src/IBulkSyncStep.cs) · [BulkSyncWorkerTests.cs](repos/lib.cs.services.bulk-sync/tests/BulkSyncWorkerTests.cs)

Rules:
- Paths must be relative to the **workspace root** (the top-level folder open in VS Code), not relative to a repo subdirectory. E.g. `repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs`, not `src/BulkSyncWorker.cs`. VS Code only makes links clickable when the full workspace-root-relative path is used.
- One line, dot-separated. If there are more than ~8 files, group by subdirectory instead.
- Repeat at the start of every new session.
- Omit files marked `(new)` in the plan — they don't exist yet and broken links are noise.

### 5b. Flag decision tasks

After the file links block, scan the upcoming session for any task with a `decision:` bullet. If any exist, surface them before asking for the go-ahead:

> **Decisions needed this session:**
> - 2.3: exponential vs. fixed backoff — need to agree on multiplier before coding

Wait for the user to resolve each flagged decision (or explicitly defer it) before proceeding.

### 6. Confirm and start

Wait for explicit go-ahead before starting the first session.

## During a Work Session

### Task announcements

Brief — one line. No full ceremony.

> "Starting 2.1."
> "2.1 done, moving to 2.2."
> "2.2 done."

### No-assumptions rule (mid-task)

Stop and ask when hitting:

- A non-trivial implementation choice not specified in the plan.
- Ambiguous acceptance criteria.
- Multiple existing patterns to choose from.
- Anything that contradicts the plan.

Don't ask about: mechanical choices that match existing style.

### Surfacing concerns inline

Don't wait for end of session. As soon as something looks wrong:

> "Heads up — 2.3 is touching the public `IBulkSyncStep` contract. The plan called this 'mechanical' but it's actually a breaking change for consumers. Want me to stop and switch to pair mode for this task, or pause entirely so you can adjust the plan?"

### Mid-session abort conditions

Stop the session and reconvene with the user when **any** of these happen:

- More than ~3 blocking unknowns hit on a single task.
- A task turns out to be high-impact mid-implementation → suggest switching to `/pair-programming` for that task, or pausing so the user can resolve.
- Tests start failing in unexpected ways (not just the test you're working on).
- Scope creep detected — work expanding beyond the plan.

When aborting, summarize what was done so far in the same format as a normal session summary.

## End-of-Session Summary

See [session-summary.md](./references/session-summary.md) for the full template. Required sections:

1. **What was done** — brief per-task bullet.
2. **Files changed** — with workspace-relative links.
3. **Review hotspots** — bullet list of code locations that need concentrated review, with `file:line` links and a one-line reason. See criteria below.
4. **Decisions made** — non-obvious ones, with reasoning.
5. **Open questions / low-confidence areas** — things the AI was unsure about.
6. **Suggested next session scope.**

### Review hotspot criteria

Flag a location as a hotspot if **any** of these apply:

- AI made a non-obvious choice.
- Public API surface changed.
- A test was loosened, skipped, or weakened.
- New error handling / retry / fallback logic.
- AI had low confidence.
- External integration boundary touched (HTTP, DB, filesystem, IPC).

A hotspot bullet looks like:

```markdown
- [BulkSyncWorker.cs:142](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs#L142) — picked exponential backoff with jitter=0.3 without precedent; please sanity-check the multiplier
```

## After the Summary

Wait. The user reviews the hotspots and either:

- Accepts → AI proceeds to the next session (or wraps up if last).
- Pushes back → AI fixes per feedback, then re-summarizes.

Do **not** auto-proceed.

## Issue Integration

Same protocol as pair-programming — see [issue-integration.md](../pair-programming/references/issue-integration.md). Differences for delegation:

- **Auto-offer a status comment after each work session**, not just at session end. Show the draft, wait for "yes".
- **Update plan checkboxes by default at end of each session**, after confirming the diff. Plan file → edit `- [ ]` → `- [x]`. Plan in issue body → use `issue-update <N> --body-file <path>`.
- All write commands (`issue-comment`, `issue-update`, `issue-create`) still require explicit confirmation.

If an adjacent bug is discovered, offer both an `issue-comment` on the parent and a new `issue-create` for the bug.

## Anti-patterns

- Starting work without an explicit plan.
- Skipping the suitability analysis.
- Delegating high-impact work without flagging it.
- Batching concerns to the end of the session instead of surfacing them inline.
- A summary without **review hotspots**.
- Auto-proceeding to the next session without user review.
- Ceremony-heavy task announcements (this isn't pair-programming).
- Silently expanding scope beyond what was delegated.
- Emitting file links that haven't been confirmed to exist (guessed paths).

## Sibling skills

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
