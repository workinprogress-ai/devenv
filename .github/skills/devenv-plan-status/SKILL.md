---
name: devenv-plan-status
description: Report progress on an existing Implementation_plan-*.md or GitHub issue containing a plan, without modifying it. USE WHEN the user says "what's the status of the plan", "how's the plan going", "where are we on this plan", "report on plan progress", "plan status", "what's left on this plan", or hands off a plan and asks for a progress check. Auto-detects whether input is a file path or a GitHub issue number, computes overall and per-phase completion percentages, lists blocked tasks (whose `depends on` references aren't yet `[x]`), surfaces next actionable tasks, reports time since last update, and extracts any open questions or TODOs embedded in the plan body. DO NOT USE for modifying the plan (use `/devenv-refine-implementation-plan`), for creating a new plan (use `/devenv-create-implementation-plan`), or for executing tasks from the plan (use `/devenv-pair-programming` or `/devenv-delegation`). Read-only.
argument-hint: Path to an Implementation_plan-*.md OR a GitHub issue number containing a plan in the body
---

# Plan status

Report progress on an existing implementation plan without changing it. Read-only.

## When to Use

- The user wants to know "how's the plan going" or "what's left to do".
- A plan has been in flight for a while and someone needs a snapshot.
- Before a standup, handoff, or session-end summary.

If there is no existing plan, stop and redirect to `/devenv-create-implementation-plan`.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `Implementation_plan-issue-42-001.md`.
- **A GitHub issue number** — e.g. `42`. The plan body is read via `issue-get N --pretty`.

**Auto-detection rule:** if the argument matches `^[0-9]+$`, treat as issue number; otherwise treat as a file path. If ambiguous, ask.

## Workflow

### 1. Load the plan

- File input: read the markdown file directly.
- Issue input: `issue-get N --pretty`, then extract the body field.

### 2. Parse structure

- **Phases**: lines matching `^### Phase N — Title` (capture title and ordering).
- **Tasks**: lines matching `^- \[( |x)\] N\.M(\.K)?` — capture number, checkbox state, summary line.
- **Cancelled tasks**: lines wrapped in `~~strikethrough~~` — track separately, exclude from completion math.
- **Dependencies**: indented `- depends on N.M, N.M2` lines under each task.
- **Last update**: most recent date in `## Revision history` section if present; otherwise file mtime (file mode) or `updatedAt` from the issue (issue mode).
- **Open questions**: lines starting with `> Q:`, `**Open question:**`, `TODO:`, or under a `## Open questions` section if present.

### 3. Compute progress

- **Overall**: `done / (total - cancelled) * 100` rounded to nearest int.
- **Per phase**: same formula scoped to each phase.
- **Blocked tasks**: any unchecked task whose `depends on` references include at least one unchecked, non-cancelled task.
- **Next actionable**: unchecked, non-cancelled, non-blocked tasks. Limit to first 5 in plan order unless `--all` was requested.

### 4. Report

Default output is markdown to chat. Format:

```markdown
## Plan status — <plan title or "Implementation_plan-NNN.md">

**Source**: `path/to/plan.md` (or `issue #42`)
**Last updated**: 2025-11-08 (12 days ago) — from revision history
**Overall progress**: 14 / 22 tasks (64%) — 1 cancelled

### By phase
- Phase 1 — Discovery: 4/4 (100%) ✅
- Phase 2 — Tooling: 7/7 (100%) ✅
- Phase 3 — Skills: 3/8 (38%)
- Phase 4 — Working-mode: 0/3 (0%)

### Next actionable (5)
- 3.2 Create plan-status skill
- 3.3 Create plan-from-spec skill
- 4.1 Create code-review skill
- ...

### Blocked (2)
- 5.3 Create open-pr skill — waits on 2.7 (in progress)
- 8.1 Skills index page — waits on all of Phase 3, 4, 5

### Cancelled (1)
- ~~4.3 Old approach~~ — superseded by 3.4

### Open questions
- Q from plan body: "Should we support a --json flag everywhere?"
```

If `--json` flag is used, emit a single JSON object with the same data structured for tooling:

```json
{
  "source": "issue:42",
  "title": "...",
  "lastUpdated": "2025-11-08",
  "daysSinceUpdate": 12,
  "totals": { "done": 14, "total": 22, "cancelled": 1, "percent": 64 },
  "phases": [ { "title": "...", "done": 4, "total": 4, "percent": 100 }, ... ],
  "nextActionable": [ { "id": "3.2", "summary": "..." } ],
  "blocked": [ { "id": "5.3", "waitsOn": ["2.7"] } ],
  "cancelled": [ { "id": "4.3", "note": "superseded by 3.4" } ],
  "openQuestions": [ "..." ]
}
```

### 5. Do not modify

This skill is strictly read-only. It does not write to the plan, post issue comments, or update the issue body. If the user asks for changes, redirect to `/devenv-refine-implementation-plan`.

## Anti-patterns

- **Counting cancelled tasks toward total** — inflates the denominator and makes a "100% done" plan look incomplete forever.
- **Treating dependency lines casually** — if `depends on` text refers to a task that doesn't exist, surface that as a warning, not a silent blocker.
- **Suggesting actions** — this skill reports; it does not recommend pairing, delegating, or refining. The user decides next steps.
- **Modifying the plan** — even a "small fix" while reading is out of scope. Use `/devenv-refine-implementation-plan`.

## Sibling skills

- `/devenv-create-implementation-plan` — for brand-new plans.
- `/devenv-refine-implementation-plan` — for revising plans after discovery.
- `/devenv-pair-programming` and `/devenv-delegation` — for executing plan tasks.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
