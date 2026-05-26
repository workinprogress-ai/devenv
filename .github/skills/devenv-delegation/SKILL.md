---
name: devenv-delegation
description: 'Drive implementation of a pre-existing plan with the AI doing the bulk of the work and the user reviewing. USE WHEN the user says "delegate this to you", "you take this", "run with this", "implement this plan", "work through this plan", or "do this for me" with a plan attached, AND the work is mechanical, rote, or low-impact (refactors, rename sweeps, test scaffolding, cleanup, docs). REQUIRES an existing implementation plan (file path or GH issue with a plan in the body). Analyzes plan suitability per phase, proposes work-session groupings (default: one phase per session), keeps user engaged via brief task-start pings and inline concern surfacing, and ends each session with a structured summary including review hotspots. SUGGESTS switching to `/devenv-pair-programming` for any high-impact phase. DO NOT USE for ad-hoc work, plans that don''t exist yet (use `/devenv-create-implementation-plan` first), or high-impact work like public API changes, data shape changes, security, or novel architecture (use `/devenv-pair-programming`).'
argument-hint: '<issue-number | path-to-plan> [phase or task range]'
user-invocable: true
---

# Delegation

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

The AI implements; the human reviews. For work that is mechanical, rote, or low-impact enough that pair-programming ceremony would be overkill — but still warrants enough engagement that important decisions don't slip past the human.

## When to Use

Trigger phrases:

- "delegate this to you" / "you take this" / "run with this"
- "implement this plan" / "work through this plan"
- "do this for me" — when a plan is attached
- A plan + intent for AI to drive (not collaborate)

Do **not** use for:

- Work without an existing plan → use [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) first.
- High-impact / collaborative work → use [`/devenv-pair-programming`](../devenv-pair-programming/SKILL.md).
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

## Output Signals

Use the emoji vocabulary defined in `copilot-instructions.md` consistently:

| Signal | Use when |
|--------|----------|
| `📁` | Opening a **Files in scope** block |
| `🔶` | A **decision is required** before continuing |
| `→` | Starting a task (task-start ping) |
| `✅` | Task accepted / checkpoint passed |
| `⚠️` | Concern or heads-up surfaced inline |
| `🛑` | Blocker — mid-session abort triggered |
| `🏁` | Opening the end-of-session summary |

**File and method references:** Whenever a specific class, method, or file is mentioned **anywhere in chat output** — task announcements, concerns, session summaries, suitability analysis — use a clickable workspace-root-relative link. Never use backtick code formatting as a substitute for a link when the location is known. If the exact line isn't known, link to the file without `#L`. Same convention as the hotspot format below.

## Session Kickoff

Run these in order.

### 1. Load the plan

Ask if not provided: GH issue # or path to a plan markdown.

- **GH issue**:
  1. First, check whether a local `Implementation_plan-issue-<N>-*.md` already exists in the target repo root. If it does, **use it** — it carries checkbox progress from prior sessions and is the source of truth. Skip to the drift check.
  2. If no local file exists, fetch the plan body via `gh issue view <N> --json body --jq .body`. Confirm the body contains a plan (task list, phase structure).
  3. Write the fetched body to the target repo root as `Implementation_plan-issue-<N>-001.md` (or the next available suffix — never overwrite an existing file).
  4. **Work exclusively from the local file from this point on.** Record its workspace-relative path (e.g. `repos/lib.cs.services.bulk-sync/Implementation_plan-issue-42-001.md`) — this is the `<plan_file>` argument for every `markdown-plan-complete-task` call throughout the session. Always pass it explicitly; never rely on the tool's default directory search. Checkbox updates go to the file; issue body syncs at phase boundaries push the file back to the issue.
- **Plan file**: read it.
- **No plan or too thin**: refuse delegation. Redirect to `/devenv-create-implementation-plan` to draft one first.

### 1b. Quick drift check

After loading, scan for obvious staleness signals before going any further:

- File paths in `Files:` bullets or task descriptions that don't exist in the workspace.
- Class or method names mentioned in tasks that a quick `grep_search` can't find.
- A `## Revision history` or plan creation date suggesting the plan is more than a few weeks old *and* unchecked tasks still reference codebase specifics.
- A large ratio of `[x]` tasks in early phases with `[ ]` tasks in later phases that reference the same code areas — suggests significant time has passed.

**If two or more signals are present**, flag it before continuing:

> *"This plan shows signs of drift: [list the specific signals]. I'd recommend running `/devenv-refresh-implementation-plan` before we start to make sure we're working from a plan that matches the current codebase. Want to do that now, or proceed as-is?"*

Wait for the user's answer. If they say proceed, note the signals in the session summary's open questions section and continue. If they say refresh, tell them to invoke `/devenv-refresh-implementation-plan` (new skill invocation required) and stop.

**If fewer than two signals**, continue silently.

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

- If **any** in-scope phase is `better-as-pair`, recommend running `/devenv-pair-programming` for **that phase only** and delegation for the rest.
- If **all** in-scope phases are `better-as-pair`, recommend switching to `/devenv-pair-programming` entirely.
- For `borderline`, state the concern and ask.

> **Important — skill-switching requires a new invocation.** If the user agrees to switch to pair-programming for any phase, they must start a **new chat and invoke `/devenv-pair-programming`** (or type `/devenv-pair-programming` in the current chat to re-invoke it). Simply saying "switch" in this session does not load the pair-programming skill rules. Make this explicit in the recommendation.

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

> **📁 Files in scope — Phase 2:**
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

> "→ Starting 2.1."
> "✅ 2.1 done, moving to 2.2."
> "✅ 2.2 done."

### No-assumptions rule (mid-task)

Stop and ask when hitting:

- A non-trivial implementation choice not specified in the plan.
- Ambiguous acceptance criteria.
- Multiple existing patterns to choose from.
- Anything that contradicts the plan.

Don't ask about: mechanical choices that match existing style.

### Surfacing concerns inline

Don't wait for end of session. As soon as something looks wrong, surface it — including when a tempting shortcut would paper over a real problem. A shortcut is dubious when it avoids proper work rather than doing it: restoring a removed parameter to dodge test fixes, skipping a refactor the plan calls for, hardcoding a value instead of wiring it properly. When that impulse arises, name it and ask:

> *"The path of least resistance here is to restore `x` to avoid fixing the tests — but that feels like the wrong call. Want me to fix the tests properly instead?"*

The same rule applies to any non-obvious design choice made under time pressure.

> "Heads up — 2.3 is touching the public `IBulkSyncStep` contract. The plan called this 'mechanical' but it's actually a breaking change for consumers. To get proper pair-programming behaviour, you'd need to start a new chat with `/devenv-pair-programming` — switching here won't load those rules. Want me to pause so you can do that, or shall we continue with the usual delegation safety checks?"

### Mid-session abort conditions

Stop the session and reconvene with the user when **any** of these happen:

- More than ~3 blocking unknowns hit on a single task.
- A task turns out to be high-impact mid-implementation → suggest switching to `/devenv-pair-programming` for that task, or pausing so the user can resolve.
- Tests start failing in unexpected ways (not just the test you're working on).
- A build or environment failure appears that is unrelated to the current changes — restore errors, version conflicts, missing dependencies in files not touched this session.
- Scope creep detected — work expanding beyond the plan.

When aborting, summarize what was done so far in the same format as a normal session summary.

### Failure investigation is bounded by allowed tools

When a build or test failure is encountered, **surface it immediately** — even if it appears pre-existing or unrelated to the current changes. Do not self-assign an investigation task that requires a prohibited operation.

**Never use `git stash`, `git checkout`, `git reset`, or any mutating git command to isolate whether a failure pre-dates the current changes — not even to "just confirm before reporting."** The prohibition applies here exactly as everywhere else. The correct action is to surface the failure with the evidence already available: the error output, which files were changed this session, what commands were run.

**When read-only evidence is not enough.** If the AI genuinely needs information that would require a mutating git operation (e.g. a before/after baseline comparison to confirm whether failures are pre-existing), it must not run those commands itself. Instead:

1. State the objective clearly — what question needs answering and why read-only tools can't answer it.
2. Draft the exact sequence of commands the user should run.
3. Ask the user to run them and report back.

Example:

> *"🔴 I want to confirm these 90 test failures are pre-existing and not introduced by my changes. To get a clean baseline, please run:*
> *1. `git stash` — sets aside my current changes*
> *2. `dotnet test --filter Category=DeferredCommit 2>&1 | tail -5` — records the pre-change failure count*
> *3. `git stash pop` — restores my changes*
> *How many failures did the baseline show?"*

Example format for failure surfacing:

> *"🛑 Hit a build failure that appears pre-existing and unrelated to my changes: `NU1605` version conflict in `ChangeHistory.csproj` (I never touched this file). It cascades to the test build. Tasks 1.1–1.6 are complete but I can't verify the build with them in place until this is resolved. How would you like to handle it?"*

The user decides how to investigate. The AI provides evidence; the human directs.

> **Switching to pair-programming mid-session:** if the user wants to switch, tell them explicitly: *"To get the full pair-programming rules, please start a new chat and invoke `/devenv-pair-programming` — continuing in this session means the pair-programming skill isn't loaded and its rules won't apply."* Do not continue in delegation mode pretending to pair-program.

## Always Work From Current Files

The AI's in-context memory of a file's contents is a **cache**. That cache is invalidated the moment any edit is made — by the AI or any tool. After that point, the in-context copy must be treated as stale until re-read.

**Before answering a question about the current state of any file, the AI must re-read it if any edits have occurred in the session.** This applies to:

- Answering "is X done?", "did that change land?", "why isn't Y working?"
- Giving advice that depends on what a method, class, or file currently contains
- Confirming that a previously written change was actually applied

The rule: **if you wrote to the file, re-read it before making any claim about its contents.** Do not say "I can see from earlier that..." when referring to a file that has been edited. Read it now.

If for some reason the file cannot be read, say so explicitly: *"I'd want to re-read [`BulkSyncWorker.cs`](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs) before answering — the in-context version may be stale."* Never answer as if the stale copy is current.

## Phase Completion Gate

Before wrapping a phase and syncing the issue body, run the committability checklist from [phase-rules.md](../devenv-create-implementation-plan/references/phase-rules.md):

- [ ] All tests pass — including any tests written in the failing state (TDD) during this phase; the red-green cycle must close before this gate
- [ ] Coverage has not regressed vs. the start of the phase
- [ ] Tests added this phase assert observable behaviour — not just execute code
- [ ] No blocking TODOs

If coverage has dropped, **stop** — add a hotspot entry and surface it to the user before proceeding:

> *"Coverage dropped from 87% to 84% in this phase. I need to add tests for [X] before this phase is committable. Taking those now unless you'd prefer to handle them."*

The exception path (documented last resort) must be explicitly surfaced and agreed before the phase is marked done.

The user can override the rule for a phase by:
- **Explicitly rejecting it** for this phase — their call, accept it and move on.
- **Applying coverage exclusion** to the code in question using the appropriate language attribute (e.g. `[ExcludeFromCodeCoverage]` in C#, `/* istanbul ignore */` in TypeScript).
- **Adding verbiage to the plan** that modifies or waives the rule for specific phases — if that's present, honour it without re-raising the blocker.

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

## Plan Progress (Checkbox Updates)

The AI owns checkbox updates in delegation — the user isn't driving the work, so they shouldn't have to maintain the plan manually.

### Plan file (source of truth)

Mark a task complete as soon as the user accepts the work for that task. Do not batch to end of session.

Run `markdown-plan-complete-task <task_number> <plan_file>` in a terminal, where `<plan_file>` is the workspace-relative path recorded at plan load. Confirm briefly: *"✅ Ticked 2.1."* To reopen a task: `markdown-plan-complete-task --uncomplete <task_number> <plan_file>` in a terminal.

### Inconsistencies and plan gaps

If, while updating the plan, anything surfaces that can't be resolved by a checkbox tick — a task description that doesn't match what was built, a missing task, an already-completed task that isn't in the plan, an assumption that no longer holds — **stop immediately and discuss with the user before continuing**. Do not silently add tasks, adjust descriptions, or reorder phases. These inconsistencies often signal a real plan gap or an undetected scope change that needs to be understood before work continues.

### GH issue body sync

GitHub issue bodies are a single markdown blob — every checkbox update is a full overwrite. If the issue body is edited between syncs, the next write will silently clobber those changes.

To avoid this, **sync the issue body only at phase boundaries** (not per-task). **Do this proactively as part of closing each phase — don't wait for the user to ask.**

1. At the end of each phase, fetch the current issue body.
2. Apply all checkboxes completed during that phase in one edit.
3. Show the diff, wait for explicit confirmation, then run `issue-update <N> --body-file <path>`.

Never sync mid-phase. If the session ends mid-phase, offer a sync for whatever tasks were completed.

## After the Summary

Wait. The user reviews the hotspots and either:

- Accepts → AI proceeds to the next session (or wraps up if last).
- Pushes back → AI fixes per feedback, then re-summarizes.

Do **not** auto-proceed.

## Issue Integration

Same protocol as pair-programming — see [issue-integration.md](../devenv-pair-programming/references/issue-integration.md). Differences for delegation:

- **Auto-offer a status comment after each work session**, not just at session end. Show the draft, wait for "yes".
- **Checkbox updates are handled per-task** as work is approved — see [Plan Progress](#plan-progress-checkbox-updates) above. Do not re-do them here unless some were missed.
- All write commands (`issue-comment`, `issue-update`, `issue-create`) still require explicit confirmation.

If an adjacent bug is discovered, offer both an `issue-comment` on the parent and a new `issue-create` for the bug.

## Anti-patterns

- Starting work without an explicit plan.
- Skipping the suitability analysis.
- Delegating high-impact work without flagging it.
- Batching concerns to the end of the session instead of surfacing them inline.
- Taking a dubious shortcut (restoring reverted code, skipping a required step, papering over a failure) without surfacing it and getting explicit approval.
- A summary without **review hotspots**.
- Auto-proceeding to the next session without user review.
- Ceremony-heavy task announcements (this isn't pair-programming).
- Silently expanding scope beyond what was delegated.
- Emitting file links that haven't been confirmed to exist (guessed paths).

## Sibling skills

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.
