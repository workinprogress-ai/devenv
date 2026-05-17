---
name: devenv-refine-implementation-plan
description: Revise an existing Implementation_plan-*.md (or GitHub issue body containing a plan) after discovery work, scope changes, or new requirements. USE WHEN the user says "refine the plan", "update the plan", "revise the implementation plan", "the plan needs updating", "rework the plan based on what we learned", or hands off a stale plan that needs new tasks added or existing tasks adjusted. Auto-detects whether input is a file path or a GitHub issue number, preserves all existing `[x]` checkbox state, appends new tasks at the end of each affected phase (next sequential number — never reflows), records changes in a `## Revision history` section at the top of the file, and writes the result back in place. DO NOT USE for creating a brand-new plan from scratch (use `/devenv-create-implementation-plan`), for ad-hoc edits to a single task line (just edit the file directly), or for reporting plan progress without modifying it (use `/devenv-plan-status` once it exists).
argument-hint: Path to an Implementation_plan-*.md OR a GitHub issue number containing a plan in the body
---

# Refine implementation plan

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

Take an existing implementation plan and revise it based on new information — discovery work, scope changes, fresh requirements, or lessons from initial implementation. Preserve all existing progress; never silently undo work.

## When to use this skill

- The user has an `Implementation_plan-*.md` (or a GitHub issue with a plan in its body) that needs new tasks added, existing tasks reworded, or scope adjusted.
- A previous `/devenv-create-implementation-plan` run is now out of date.
- Discovery during Phase 1 revealed sub-tasks that didn't exist when the plan was written.

If there is no existing plan, stop and redirect to `/devenv-create-implementation-plan`.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `Implementation_plan-issue-42-001.md`, `repos/foo/Implementation_plan-003.md`. Treated as a literal markdown file to read and write back.
- **A GitHub issue number** — e.g. `42`. The plan is read from the issue body via `tools/issue-get N --pretty`. After refinement, offer to push the updated body back via `tools/issue-update N --body-file <path>`.

**Auto-detection rule:** if the argument matches `^[0-9]+$`, treat as issue number; otherwise treat as a file path. If both could plausibly apply, ask the user which they meant.

## Workflow

### 1. Load and parse the existing plan

- Read the source (file or `issue-get` output).
- Identify the phase headings (`### Phase N — Title`) and task lines (`- [ ]` / `- [x]`).
- Note the highest existing task number per phase (e.g. Phase 2 has tasks up to 2.7 → next is 2.8).
- Extract any existing `## Revision history` section so new entries can be prepended to it.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — new tasks to add, or themes for new tasks.
- **What's wrong** — tasks whose descriptions are now misleading or whose scope changed.
- **What's done outside the plan** — work completed that should be marked `[x]` retroactively.
- **What's no longer relevant** — tasks to mark as cancelled (do NOT delete; strike through and annotate).

Do not assume. If the new requirements imply renumbering or reordering, flag it and ask before proceeding.

### 3. Apply changes — preserve everything

**Hard rules:**

- **Never reflow existing task numbers.** A task numbered `2.3` stays `2.3` for its entire lifetime.
- **Never silently uncheck a `[x]`.** If a completed task's scope must change, leave it checked and add a new task for the additional work.
- **New tasks are appended to the end of their phase** with the next sequential number (e.g. if Phase 2 ends at 2.7, the next new task is 2.8).
- **Cancelled tasks** stay in place with the task line wrapped in `~~strikethrough~~` and an inline note (e.g. `~~- [ ] 2.4 Add foo~~ — cancelled in revision 2025-11-08; superseded by 2.9`).
- **Reworded tasks** keep their number; the prior wording is recorded in the revision history.

### 4. Record the revision

Add or update a `## Revision history` section directly under the plan's title (above the first phase). Format:

```markdown
## Revision history

### 2025-11-08 — Discovery findings from Phase 1

- Added 2.8: integration test harness for X (discovered during 1.3)
- Added 3.4: handle Y edge case (raised by user feedback)
- Reworded 4.1: previous wording assumed REST; clarified it's gRPC
- Cancelled 4.3: superseded by 3.4
- Marked 1.2 [x]: completed during exploration before plan was finalized

### 2025-10-22 — Initial plan created
```

Most recent revision goes on top. The very first entry (when the plan was first written) may simply read "Initial plan created".

### 5. Write the result

- For file input: overwrite the file in place. The user can `git diff` to review and revert if needed.
- For issue input: write the refined plan to a temp file, then offer to push it: "Update issue #N body with the refined plan? (`tools/issue-update N --body-file <path>`)" Wait for explicit yes before running.

Do not require a separate approval step for the write itself — the user invoked the skill to refine the plan; trust that intent. Git is the safety net.

### 6. Report back

Summarise inline:

- How many tasks were added / reworded / marked done / cancelled
- Which phases were affected
- The new total task count
- (For issue input) whether the issue body was updated

## Anti-patterns

- **Renumbering existing tasks** — breaks every external reference (PR descriptions, commit messages, issue comments). Always append.
- **Silently unchecking `[x]`** — discards user progress. If completed work needs to be redone, add a new task.
- **Deleting cancelled tasks** — leaves a confusing gap in the numbering and erases history. Strike through and annotate instead.
- **Skipping the revision history** — turns the file into a black box where readers can't tell what changed.
- **Assuming what changed** — always interview before editing. The user knows things you don't.

## Sibling skills

- `/devenv-create-implementation-plan` — for brand-new plans from scratch.
- `/devenv-plan-status` — for reporting progress without modifying the plan.
- `/devenv-pair-programming` and `/devenv-delegation` — for actually executing the (refined) plan.

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
