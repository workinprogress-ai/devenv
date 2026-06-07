---
name: devenv-refine-implementation-plan
description: Revise an existing Implementation_plan-*.md (or GitHub issue body containing a plan) after discovery work, scope changes, or new requirements. USE WHEN the user says "refine the plan", "update the plan", "revise the implementation plan", "the plan needs updating", "rework the plan based on what we learned", or hands off a stale plan that needs new tasks added or existing tasks adjusted. Auto-detects whether input is a file path or a GitHub issue number, preserves all existing `[x]` checkbox state, appends new tasks to the end of each affected phase (next sequential number — never reflows), and creates new phases when the target phase is already fully complete. Records changes in a `## Revision History` section near the bottom of the file, and writes the result back in place. DO NOT USE for creating a brand-new plan from scratch (use `/devenv-create-implementation-plan`), for ad-hoc edits to a single task line (just edit the file directly), or for reporting plan progress without modifying it (use `/devenv-plan-status`).
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
- **A GitHub issue number** — e.g. `42`. The plan is read from the issue body via `issue-get N --pretty`. After refinement, offer to push the updated body back via `issue-update N --body-file <path>`.

**Auto-detection rule:** if the argument matches `^[0-9]+$`, treat as issue number; otherwise treat as a file path. If both could plausibly apply, ask the user which they meant.

## Workflow

### 1. Load and parse the existing plan

- Read the source (file or `issue-get` output).
- Identify the phase headings (`### Phase N — Title`) and task lines (`- [ ]` / `- [x]`).
- Note the highest existing task number per phase (e.g. Phase 2 has tasks up to 2.7 → next is 2.8).
- **Assess completion state**: for each phase, note whether it is fully complete (all tasks `[x]`), partially complete, or untouched. Note the highest existing phase number — this is used if new phases need to be created.
- Extract any existing `## Revision History` section so new entries can be prepended to it.
- Preserve the high-level section order introduced by the current template: goals/AC first, context/orientation second, phases third, detailed task tracking later.
- If `## Pending Questions` exists, preserve it and keep it immediately above `## Reference Information`.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — new tasks to add, or themes for new tasks.
- **What's wrong** — tasks whose descriptions are now misleading or whose scope changed.
- **What's done outside the plan** — work completed that should be marked `[x]` retroactively.
- **What's no longer relevant** — tasks to remove; deletion will be logged in Revision History with the task number, a one-line summary, and the reason
- **Acceptance criteria changes** — whether any ACs need to be added, revised, or deprecated as a result of the scope change. Infer candidate changes from the new requirements and present them for the user to confirm rather than asking the user to define them from scratch. See AC rules in Step 3.
- **Pending questions** — whether any unresolved questions should be added, answered, moved inline under a task/phase, or spun out into a follow-up issue.
- **Legacy code exposure** — if new tasks will introduce implementations that coexist with existing legacy code in the same files across multiple phases, flag the issue: the plan likely needs an early cleanup phase. See [phase-rules.md](../devenv-create-implementation-plan/references/phase-rules.md) for available patterns (demolition, hollow-out, rename suffix, branch by abstraction). Surface the viable options and a recommendation before writing new tasks; don't silently pick one.

Do not assume. If the new requirements imply renumbering or reordering, flag it and ask before proceeding.

### 3. Apply changes — preserve everything

**Hard rules:**

- **Never reflow existing task numbers.** A task numbered `2.3` stays `2.3` for its entire lifetime.
- **Never reflow existing AC-N identifiers.** An AC numbered `AC-3` stays `AC-3` for its entire lifetime — same principle as task numbers.
- **Never silently uncheck a `[x]`.** If a completed task's scope must change, leave it checked and add a new task for the additional work.
- **New tasks are appended to the end of their phase** with the next sequential number (e.g. if Phase 2 ends at 2.7, the next new task is 2.8). New tasks must use the full task format: `- [ ] **N.M [S|M|L] Title**` header, descriptive sub-bullets first, then `Files:` / `decision:` / `owner:` / `depends on` metadata. Do not add skeletal or title-only tasks.
- **When the target phase is fully complete (`[x]` on all its tasks), do not append to it.** Adding tasks to a complete phase misrepresents how the work progressed and resets progress markers. Instead, create one or more new phases numbered sequentially after the last existing phase (e.g. if the plan ends at Phase 4, new work goes in Phase 5, 6, etc.). This applies equally when the entire plan is complete — the canonical case is a plan that was finished and committed, then new downstream requirements surface that should have been part of the original scope.

  New phases must follow the same phase rules as any other phase: each must be committable, cover its own tests, and the final new phase must include cleanup and docs tasks for the new scope. If the original Cleanup phase is already complete, add a new Cleanup phase for the new scope rather than reopening the original.

  The first of the new phases must include an explicit task to **review the new scope and place forward guidance comments** (`TODO:(DEVENV[...])`) at anticipated touch points — the same role Phase 1 plays in a fresh plan. Example task: `- [ ] **5.1 [S] Review new scope and place forward guidance comments** — scan files affected by phases 5–6, add TODO:(DEVENV[...]) comments at integration points and stubs that later tasks will fill.`

  Surface this to the user before writing: *"Phase 3 is fully complete — I'll add the new work in a new Phase 5 rather than appending to Phase 3. The existing Cleanup (Phase 4) is also done, so I'll add a new Phase 6 for cleanup of the new scope. Does that structure work for you?"*
- **Prefer rewrite/addition over removal.** If the work still matters but the original task is misleading, keep the number and reword it, or add a follow-on task. Only strike through a task when the obsolete record is materially useful to preserve.
- **Cancelled tasks** that truly should remain visible are kept in place, wrapped in `~~strikethrough~~` on the task header line and annotated with the reason inline (e.g. `~~- [ ] **4.3 [S] Add foo**~~ — cancelled: superseded by 2.9`), and recorded in `## Revision History` with the task number, a one-line summary, and the reason.
- **Reworded tasks** keep their number; the prior wording is recorded in the Revision History.
- **Pending questions**: task- or phase-specific questions live inline under the relevant task/phase as `[QUESTION] ...`; general plan-level questions live in `## Pending Questions` immediately above `## Reference Information`. Resolved minor questions may be folded directly into the plan and removed. Significant question resolutions should be recorded in `## Revision History`.

**Acceptance criteria changes:**

- **New ACs**: infer from the new scope, mark `*(inferred)*`, append to the `## Goals and Acceptance Criteria` section with the next `AC-N` number (e.g. if AC-4 is the last, the next is AC-5). Use the canonical format: `- [ ] **AC-N** criterion text *(inferred)*`.
- **Minor revision** (clarification or wording improvement — same intent, same observable outcome): rewrite the criterion text in place and append a revision note: `- [ ] **AC-N** Revised text *(inferred)* — *revised: brief note*`. Record in Revision History.
- **Significant change** (scope, acceptance conditions, or observable outcome changes meaningfully):
  1. Remove the `- [ ]` checkbox, wrap the criterion in `~~strikethrough~~`, and append `*(superseded by AC-M)*`
  2. Add a new criterion: `- [ ] **AC-M** replacement text *(inferred)*` (next available AC-N number)
  3. Record both in Revision History.
- **AC ticking is done by the execution skills** (pair-programming / delegation) during the AC Review phase — do not tick ACs here unless the user explicitly confirms a criterion is already met.

### 4. Record the revision

Add or update a `## Revision History` section near the bottom of the plan (after `## Additional Task Context`). Format:

```markdown
## Revision History

### 2025-11-08 — Discovery findings from Phase 1

- Added 2.8: integration test harness for X (discovered during 1.3)
- Added 3.4: handle Y edge case (raised by user feedback)
- Reworded 4.1: previous wording assumed REST; clarified it's gRPC
- Cancelled 4.3: superseded by 3.4
- Marked 1.2 [x]: completed during exploration before plan was finalized
- Added AC-5: inferred from new scope — service must handle empty batch gracefully
- Revised AC-2: wording clarified (same intent)
- Deprecated AC-3: superseded by AC-6 (scope narrowed by discovery)

### 2025-10-22 — Initial plan created
```

Most recent revision goes on top. The very first entry (when the plan was first written) may simply read "Initial plan created".

### 5. Write the result

- For file input: overwrite the file in place. The user can `git diff` to review and revert if needed.
- For issue input: write the refined plan to a temp file, then offer to push it: "Update issue #N body with the refined plan? (`issue-update N --body-file <path>`)" Wait for explicit yes before running.

Do not require a separate approval step for the write itself — the user invoked the skill to refine the plan; trust that intent. Git is the safety net.

### 6. Report back

Summarise inline:

- How many tasks were added / reworded / marked done / cancelled
- Which phases were affected
- The new total task count
- (For issue input) whether the issue body was updated

## Anti-patterns

- **Renumbering existing tasks** — breaks every external reference (PR descriptions, commit messages, issue comments). Always append.
- **Renumbering existing AC-N identifiers** — same principle. AC-3 stays AC-3; append new ACs at the next available number.
- **Silently unchecking `[x]`** — discards user progress. If completed work needs to be redone, add a new task.
- **Deleting cancelled tasks** — leaves a confusing gap in the numbering and erases history. Strike through and annotate instead.
- **Skipping the Revision History** — turns the file into a black box where readers can't tell what changed.
- **Assuming what changed** — always interview before editing. The user knows things you don't.

## Sibling skills

- `/devenv-create-implementation-plan` — for brand-new plans from scratch.
- `/devenv-plan-status` — for reporting progress without modifying the plan.
- `/devenv-pair-programming` and `/devenv-delegation` — for actually executing the (refined) plan.

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.
