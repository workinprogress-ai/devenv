---
name: devenv-plan-update
description: Make small, surgical edits to an existing Implementation_plan-*.md (or GitHub issue body containing a plan). USE WHEN the user says "mark 3.4 done", "tick off task 2.1", "answer that open question", "add a note to task X", "add one more task to phase 3", or wants to record progress without restructuring the plan. Auto-detects file path vs. issue number, requires a one-line confirm before each write, records every change in `## Revision History`, never silently unchecks a `[x]`, and never reflows numbering. Hard limit: refuses if more than 3 changes are requested in one invocation, redirecting to `/devenv-refine-implementation-plan`. DO NOT USE for rewording existing tasks, restructuring or reordering phases, cancelling tasks, or any bulk additions — use `/devenv-refine-implementation-plan` instead. For read-only progress reports use `/devenv-plan-status`.
argument-hint: Path to an Implementation_plan-*.md OR a GitHub issue number, plus the edit to make
---

# Plan update

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

Apply small, surgical edits to an existing implementation plan without running a full revision interview. Sits between `/devenv-plan-status` (read-only) and `/devenv-refine-implementation-plan` (full restructure).

## When to Use

- Mark a task `[x]` (it's done).
- Resolve / answer an open question recorded in the plan.
- Append a short clarifying note to a single task line.
- Add a single new task to the end of a phase.

If the user wants to reword tasks, restructure phases, cancel tasks, or make several changes at once, redirect to `/devenv-refine-implementation-plan`.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `Implementation_plan-issue-42-001.md`.
- **A GitHub issue number** — e.g. `42`. Plan body is read via `issue-get N --pretty`.

Plus the specific edit(s) requested in the chat.

**Auto-detection rule:** `^[0-9]+$` → issue number; otherwise file path. Ambiguous → ask.

## Workflow

### 1. Load the plan

- File input: read the markdown file.
- Issue input: `issue-get N --pretty` and extract the body.

### 2. Validate scope

Count the requested operations. **Hard limit: 3 per invocation.** If more, stop and recommend `/devenv-refine-implementation-plan`.

For each operation, confirm it falls within the supported set:

| Operation | Supported here? |
|---|---|
| Mark task `[x]` | yes |
| Mark task `[ ]` (undo) | only if it was ticked in this current session (e.g. ticked by mistake); for checkboxes from any prior session or revision, refuse and suggest adding a new task instead |
| Answer/resolve an open question | yes |
| Append a short note to a task line | yes |
| Add one new task at the end of a phase | yes |
| Reword an existing task | **no** — `/devenv-refine-implementation-plan` |
| Restructure or reorder phases | **no** |
| Cancel a task (strikethrough) | **no** — structural edit, use `/devenv-refine-implementation-plan` |
| Modify acceptance criteria (AC-N) | **no** — any AC change (add, revise, or deprecate) routes to `/devenv-refine-implementation-plan` |
| Bulk edits | **no** |

### 3. Confirm each operation

For each edit, show a one-line preview and ask for explicit confirmation:

> "Mark task **3.4 Create plan-update skill** as done? (y/n)"
> "Append note to **2.7**: 'fix landed in commit abc123'? (y/n)"
> "Add new task **3.5 Add JSON output flag** to Phase 3? (y/n)"

Use `vscode_askQuestions`. Do not batch all confirmations into one prompt — each edit gets its own.

If the user says no to any edit, skip it and move to the next.

### 4. Apply changes

**Hard rules** (same as `/devenv-refine-implementation-plan`):

- Never reflow existing task numbers.
- Never silently uncheck a `[x]`.
- New tasks are appended to the end of their phase with the next sequential number.
- Notes appended to a task go on the same line as `— note: <text>` or as an indented sub-bullet.
- Resolved open questions: either inline-edit the `[QUESTION]` line to add `— answered: <text>` or fold the answer into the surrounding task/phase/plan text and remove the question. Prefer inline for short answers.

### 5. Record in Revision History

Add (or extend) the `## Revision History` section with today's date and one bullet per material change or batch of related minor edits:
Keep the entry concise and avoid separate bullets for low-value tweaks when they came from the same request.

```markdown
## Revision History

### 2026-05-08 — Progress update
- Marked 3.4 [x]
- Added 3.5: Add JSON output flag
- Answered open question: "Should plan-update support undo?" — answered: yes, only for the most recent revision

### 2025-10-22 — Initial plan created
```

If no Revision History exists yet, create it after `## Additional Task Context` so the human-facing reading flow stays intact.

### 6. Write

- File input: overwrite in place. Git is the safety net; user can `git diff` to review.
- Issue input: write the updated body to a temp file, then offer:
  > "Update issue #N body via `issue-update N --body-file <path>`?"
  Wait for explicit yes. Do not auto-push.

### 7. Report

One-line summary per change applied, plus the new task counts and overall progress (e.g. "13/22 tasks done, 59%").

## Anti-patterns

- **Batching confirmations** — each edit gets its own y/n. The user must be able to say no to one without rejecting all.
- **Silent edits while reading** — even a "small typo fix" while loading the plan is out of scope. Surface it; don't auto-fix.
- **Skipping the Revision History** — every material persisted change goes in the log. Batch small related edits into one concise entry instead of one bullet per tweak.
- **Re-checking work via this skill** — if more than 3 changes are needed, recommend `/devenv-refine-implementation-plan`. Don't grow the limit.
- **Auto-pushing to issue body** — writes to GitHub require explicit confirmation, every time.
- **Unchecking a `[x]` from a prior session or revision** — refuse. Suggest adding a new task for the additional work instead. The only valid undo is a mistake made in the current invocation of this skill.

## Sibling skills

- `/devenv-plan-status` — read-only progress reports.
- `/devenv-refine-implementation-plan` — for rewording, restructuring, or bulk changes.
- `/devenv-create-implementation-plan` — for brand-new plans.
- `/devenv-create-implementation-plan` — for generating a plan from an existing design doc or complete spec.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
