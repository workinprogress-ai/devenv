---
name: plan-update
description: Make small, surgical edits to an existing Implementation_plan-*.md (or GitHub issue body containing a plan). USE WHEN the user says "mark 3.4 done", "tick off task 2.1", "answer that open question", "add a note to task X", "add one more task to phase 3", or wants to record progress without restructuring the plan. Auto-detects file path vs. issue number, requires a one-line confirm before each write, records every change in `## Revision history`, never silently unchecks a `[x]`, and never reflows numbering. Hard limit: refuses if more than ~3 changes are requested in one invocation, redirecting to `/refine-implementation-plan`. DO NOT USE for rewording existing tasks, restructuring or reordering phases, cancelling tasks, or any bulk additions — use `/refine-implementation-plan` instead. For read-only progress reports use `/plan-status`.
argument-hint: Path to an Implementation_plan-*.md OR a GitHub issue number, plus the edit to make
---

# Plan update

Apply small, surgical edits to an existing implementation plan without running a full revision interview. Sits between `/plan-status` (read-only) and `/refine-implementation-plan` (full restructure).

## When to use this skill

- Mark a task `[x]` (it's done).
- Resolve / answer an open question recorded in the plan.
- Append a short clarifying note to a single task line.
- Add a single new task to the end of a phase.

If the user wants to reword tasks, restructure phases, cancel tasks, or make several changes at once, redirect to `/refine-implementation-plan`.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `Implementation_plan-issue-42-001.md`.
- **A GitHub issue number** — e.g. `42`. Plan body is read via `tools/issue-get N --pretty`.

Plus the specific edit(s) requested in the chat.

**Auto-detection rule:** `^[0-9]+$` → issue number; otherwise file path. Ambiguous → ask.

## Workflow

### 1. Load the plan

- File input: read the markdown file.
- Issue input: `tools/issue-get N --pretty` and extract the body.

### 2. Validate scope

Count the requested operations. **Hard limit: ~3 per invocation.** If more, stop and recommend `/refine-implementation-plan`.

For each operation, confirm it falls within the supported set:

| Operation | Supported here? |
|---|---|
| Mark task `[x]` | yes |
| Mark task `[ ]` (undo) | only if it was just set in the most recent revision; otherwise refuse |
| Answer/resolve an open question | yes |
| Append a short note to a task line | yes |
| Add one new task at the end of a phase | yes |
| Reword an existing task | **no** — `/refine-implementation-plan` |
| Restructure or reorder phases | **no** |
| Cancel a task (strikethrough) | **no** — structural edit, use `/refine-implementation-plan` |
| Bulk edits | **no** |

### 3. Confirm each operation

For each edit, show a one-line preview and ask for explicit confirmation:

> "Mark task **3.4 Create plan-update skill** as done? (y/n)"
> "Append note to **2.7**: 'fix landed in commit abc123'? (y/n)"
> "Add new task **3.5 Add JSON output flag** to Phase 3? (y/n)"

Use `vscode_askQuestions`. Do not batch all confirmations into one prompt — each edit gets its own.

If the user says no to any edit, skip it and move to the next.

### 4. Apply changes

**Hard rules** (same as `/refine-implementation-plan`):

- Never reflow existing task numbers.
- Never silently uncheck a `[x]`.
- New tasks are appended to the end of their phase with the next sequential number.
- Notes appended to a task go on the same line as `— note: <text>` or as an indented sub-bullet.
- Resolved open questions: either inline-edit the question line to add `— answered: <text>` or move the resolution under a `## Resolved questions` section. Prefer inline for short answers.

### 5. Record in revision history

Add (or extend) the `## Revision history` section with today's date and one bullet per change:

```markdown
## Revision history

### 2026-05-08 — Progress update
- Marked 3.4 [x]
- Added 3.5: Add JSON output flag
- Answered open question: "Should plan-update support undo?" — answered: yes, only for the most recent revision

### 2025-10-22 — Initial plan created
```

If no revision history exists yet, create it (above the first phase, below the title).

### 6. Write

- File input: overwrite in place. Git is the safety net; user can `git diff` to review.
- Issue input: write the updated body to a temp file, then offer:
  > "Update issue #N body via `tools/issue-update N --body-file <path>`?"
  Wait for explicit yes. Do not auto-push.

### 7. Report

One-line summary per change applied, plus the new task counts and overall progress (e.g. "13/22 tasks done, 59%").

## Anti-patterns

- **Batching confirmations** — each edit gets its own y/n. The user must be able to say no to one without rejecting all.
- **Silent edits while reading** — even a "small typo fix" while loading the plan is out of scope. Surface it; don't auto-fix.
- **Skipping the revision history** — every persisted change goes in the log. No exceptions.
- **Re-checking work via this skill** — if more than ~3 changes are needed, recommend `/refine-implementation-plan`. Don't grow the limit.
- **Auto-pushing to issue body** — writes to GitHub require explicit confirmation, every time.
- **Unchecking a `[x]` from a prior revision** — refuse. Suggest adding a new task for the additional work instead.

## Sibling skills

- `/plan-status` — read-only progress reports.
- `/refine-implementation-plan` — for rewording, restructuring, or bulk changes.
- `/create-implementation-plan` — for brand-new plans.
- `/plan-from-spec` — for generating a plan from an existing design doc.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
