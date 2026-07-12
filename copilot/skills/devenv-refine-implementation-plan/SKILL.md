---
name: devenv-refine-implementation-plan
description: Revise an existing Implementation_plan-*.md (or GitHub issue body containing a plan) after discovery work, scope changes, or new requirements. USE WHEN the user says "refine the plan", "update the plan", "revise the implementation plan", "the plan needs updating", "rework the plan based on what we learned", or hands off a stale plan that needs new tasks added or existing tasks adjusted. Auto-detects whether input is a file path or a GitHub issue number, preserves all existing `[x]` checkbox state, appends new tasks to the end of each affected phase by default, supports downstream task reflow when structural insertion requires it, and creates new phases when the target phase is already fully complete. Records changes in a `## Revision History` section near the bottom of the file, and writes the result back in place. DO NOT USE for creating a brand-new plan from scratch (use `/devenv-create-implementation-plan`), for ad-hoc edits to a single task line (just edit the file directly), or for reporting plan progress without modifying it (use `/devenv-plan-status`).
argument-hint: Path to an Implementation_plan-*.md OR a GitHub issue number containing a plan in the body
---

# Refine implementation plan

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

Take an existing implementation plan and revise it based on new information — discovery work, scope changes, fresh requirements, or lessons from initial implementation. Preserve all existing progress; never silently undo work.

## When to Use

- The user has an `Implementation_plan-*.md` (or a GitHub issue with a plan in its body) that needs new tasks added, existing tasks reworded, or scope adjusted.
- A previous `/devenv-create-implementation-plan` run is now out of date.
- Discovery during Phase 1 revealed sub-tasks that didn't exist when the plan was written.

If there is no existing plan, stop and redirect to `/devenv-create-implementation-plan`.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `Implementation_plan-issue-42-001.md`, `repos/foo/Implementation_plan-003.md`. Treated as a literal markdown file to read and write back.
- **A GitHub issue number** — e.g. `42`. The plan is read from the issue body via `issue-get N --pretty`. After refinement, offer to push the updated body back via `issue-update N --body-file <path>`.

**Auto-detection rule:** if the argument matches `^[0-9]+$`, treat as issue number; otherwise treat as a file path. If both could plausibly apply, ask the user which they meant.

**Upstream design source rule:** if the plan links a grooming artifact (or the user provides one), load it and treat it as the directing source for design decisions, constraints, deferred items, and non-goals. The implementation plan remains the execution artifact, but grooming is authoritative for design intent when present.

For issue-backed plan refinement, follow the shared [issue-backed artifact edit protocol](../common/references/issue-backed-artifact-edit-protocol.md).

## Workflow

### 1. Load and parse the existing plan

- Read the source (file or `issue-get` output).
- If the source is an issue body, materialize it to a local working copy before editing (repo-local file or temp file, depending on user choice when not already implied). Use that local working copy for all iterations in this refinement effort.
- Identify the phase headings (`### Phase N — Title`) and task lines (`- [ ]` / `- [x]`).
- Note the highest existing task number per phase (e.g. Phase 2 has tasks up to 2.7 → next is 2.8).
- **Assess completion state**: for each phase, note whether it is fully complete (all tasks `[x]`), partially complete, or untouched. Note the highest existing phase number — this is used if new phases need to be created.
- Extract any existing `## Revision History` section so new entries can be prepended to it.
- Detect escalation handoff markers in `## Revision History` entries: `[ESCALATION-HANDOFF] source=<...> phase=<...> status=<...>`.
- If a marker is present, treat that as high-priority refinement context: parse its linked unresolved decisions/questions first and use it to drive interview focus.
- Preserve the high-level section order introduced by the current template: goals/AC first, context/orientation second, phases third, detailed task tracking later.
- If `## Pending Questions` exists, preserve it and keep it immediately above `## Reference Information`.
- If `## Reference Information` links a grooming artifact, load it before interviewing. For issue-backed plans, also check issue comments/source context for a linked grooming artifact when the body references one indirectly.
- Treat an in-flight partially executed plan as a normal refinement case, not an exception: preserve completed work, update only the necessary downstream design/sequence/task surfaces, and avoid rewriting already-validated earlier phases unless the user explicitly asks.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — new tasks to add, or themes for new tasks.
- **What's wrong** — tasks whose descriptions are now misleading or whose scope changed.
- **What's done outside the plan** — work completed that should be marked `[x]` retroactively.
- **What's no longer relevant** — tasks to remove; deletion will be logged in Revision History with the task number, a one-line summary, and the reason
- **Acceptance criteria changes** — whether any ACs need to be added, revised, or deprecated as a result of the scope change. Infer candidate changes from the new requirements and present them for the user to confirm rather than asking the user to define them from scratch. See AC rules in Step 3.
- **Upstream design changes** — whether a design doc/RFC/Blueprint/Redesign decision changed and should be reflected in `## Appendix`.
- **Grooming carry-forward** — if a grooming artifact is present, confirm which `Confirmed` / `Deferred` / still-relevant `Pending` items must now be represented in the plan's phase watch-outs, task `decision:` metadata, `## Pending Questions`, appendix, or explicit scope boundaries.
- **Pending questions** — whether any unresolved questions should be added, answered, moved inline under a task/phase, or spun out into a follow-up issue.
- **Decision points** — identify unresolved implementation decisions that could block phase execution; resolve them during refinement when possible.
- **Escalation handoff closure** — if an escalation marker exists, confirm each recorded blocker/question and decide: resolve now, defer with explicit trigger, or re-scope tasks/phases.
- **Architectural fault classification** — if blockers/questions are architectural rather than task-scope adjustments, load and follow the [plan architectural review protocol](../common/references/plan-architectural-review.md) to locate fault points and classify type. If architectural issues are confirmed, produce a scoped brief and recommend the appropriate design skill with the plan path as argument:
  - Option-weighing / approach not settled → `/devenv-design-discussion <plan-path>`
  - Current approach needs reclassification → `/devenv-grooming <plan-path>`
  Do not continue plan refinement for architectural items until the design question is resolved.
- **Legacy code exposure** — if new tasks will introduce implementations that coexist with existing legacy code in the same files across multiple phases, flag the issue: the plan likely needs an early cleanup phase. See [phase-rules.md](../devenv-create-implementation-plan/references/phase-rules.md) for available patterns (demolition, hollow-out, rename suffix, branch by abstraction). Surface the viable options and a recommendation before writing new tasks; don't silently pick one.

Do not assume. If the new requirements imply renumbering or reordering, flag it and ask before proceeding.

### 2a. Optional pressure-test pass (user-gated)

Before applying edits, offer an optional pressure-test pass using [pressure-test-protocol.md](../common/references/pressure-test-protocol.md) when scope changes have architectural or sequencing risk.

- Never run automatically; proceed only after explicit user consent.
- Keep it bounded to at most two passes per current plan state.
- Use findings to decide whether to continue local refinement, route a bounded blocker to [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md), or route broader drift to [`/devenv-grooming`](../devenv-grooming/SKILL.md).

### 3. Apply changes — preserve everything

**Hard rules:**

- **Main plan content must describe the current target state only.** Every section except `## Revision History` must read as if refinement never happened — as a clean, current description of what the plan is trying to achieve and how. This means:
  - No dated announcements such as *"Scope was expanded on 2026-06-23 to include…"* anywhere outside `## Revision History`.
  - No before/after narration, phrases like "previously", "originally", "as of this revision", or inline change summaries.
  - No refinement-process narration in plan body sections, including phrases like "in this refinement", "during refinement", "as part of this update", or "we changed this from".
  - Rewrite affected content directly to present-state truth; do not annotate material sections with update-era wording.
  - `## Context and Orientation` describes the current scope and motivation only — it is not a changelog and must not grow stale sentences about prior revisions.
  - When scope expands, update the orientation text in place to reflect the new scope; record what changed and when in `## Revision History`.
  - Do not attribute edits to AI or model names in plan body text (for example: "AI updated", "Copilot added", "GPT revised").
- **Never reflow existing task numbers** unless a structural revision inserts work in the middle of an existing task series. In that case, renumber the downstream task series and update all in-plan references that point at those task IDs.
- **Task IDs are numeric only.** Do not use alphabetic suffixes such as `7.1a` or `2.4b`.
- **Insertion options are constrained to numeric forms.** When inserting between existing tasks, either:
  - reflow downstream numbering and update all affected references, or
  - add numeric hierarchical subtasks (for example `7.1.1`, `7.1.2`) when preserving surrounding numbering is preferable.
- **Never reflow existing AC-N identifiers.** An AC numbered `AC-3` stays `AC-3` for its entire lifetime — same principle as task numbers.
- **Never silently uncheck a `[x]`.** If a completed task's scope must change, leave it checked and add a new task for the additional work.
- **New tasks are appended to the end of their phase** with the next sequential number (e.g. if Phase 2 ends at 2.7, the next new task is 2.8). New tasks must use the full task format: `- [ ] **N.M [S|M|L] Title**` header, descriptive sub-bullets first, then `Files:` / `decision:` / `owner:` / `depends on` metadata. Do not add skeletal or title-only tasks.
- **When the target phase is fully complete (`[x]` on all its tasks), do not append to it.** Adding tasks to a complete phase misrepresents how the work progressed and resets progress markers. Instead, create one or more new phases numbered sequentially after the last existing phase (e.g. if the plan ends at Phase 4, new work goes in Phase 5, 6, etc.). This applies equally when the entire plan is complete — the canonical case is a plan that was finished and committed, then new downstream requirements surface that should have been part of the original scope.

  **Phase numbering is structural, and task numbering may reflow when needed.** If the user explicitly wants the new phase inserted before a later existing phase, treat that as a structural revision: renumber the downstream phase headings sequentially, update any in-plan references that mention those phase numbers, and renumber any affected downstream task series when the insertion lands in the middle of them.

  New phases must follow the same phase rules as any other phase: each must be committable, cover its own tests, and the final new phase must include cleanup and docs tasks for the new scope. If the original Cleanup phase is already complete, add a new Cleanup phase for the new scope rather than reopening the original.

  When the new scope introduces or changes important boundaries, add an early phase for defining or tightening contracts before broad implementation starts. This usually means interfaces, API/request/response shapes, message schemas, extension points, or persistence boundaries land before the phases that fully implement them.

  The first of the new phases must include an explicit task to **review the new scope and place forward guidance comments** (`TODO:(DEVENV[...])`) at anticipated touch points — the same role Phase 1 plays in a fresh plan. Example task: `- [ ] **5.1 [S] Review new scope and place forward guidance comments** — scan files affected by phases 5–6, add TODO:(DEVENV[...]) comments at integration points and stubs that later tasks will fill.`

  Surface this to the user before writing: *"Phase 3 is fully complete — I'll add the new work in a new Phase 5 rather than appending to Phase 3. The existing Cleanup (Phase 4) is also done, so I'll add a new Phase 6 for cleanup of the new scope. Does that structure work for you?"*
- **Prefer rewrite/addition over removal.** If the work still matters but the original task is misleading, keep the number and reword it, or add a follow-on task. Only strike through a task when the obsolete record is materially useful to preserve.
- **Cancelled tasks** that truly should remain visible are kept in place, wrapped in `~~strikethrough~~` on the task header line and annotated with the reason inline (e.g. `~~- [ ] **4.3 [S] Add foo**~~ — cancelled: superseded by 2.9`), and recorded in `## Revision History` with the task number, a one-line summary, and the reason.
- **Reworded tasks** keep their number; the prior wording is recorded in the Revision History.
- **Pending questions**: task- or phase-specific questions live inline under the relevant task/phase as `[QUESTION] ...`; general plan-level questions live in `## Pending Questions` immediately above `## Reference Information`. Resolved minor questions may be folded directly into the plan and removed. Significant question resolutions should be recorded in `## Revision History`.
- **Decision/pending-question placement:** unresolved decisions that matter to execution must be represented in both places:
  - the relevant phase under **Watch Outs / Decisions**
  - the earliest affected task as `decision:` metadata in `## Detailed Task List`
- **Decision-package parity for semantic updates is required.** When resolving or clarifying a semantic decision/question, update all three together:
  - decision source text,
  - matching question text/state, and
  - one revision-history reason naming the semantic delta.
- **Decision/question parity check is mandatory before completion.** Verify decision and question text mirror each other for:
  - lifecycle lane coverage,
  - ownership boundary,
  - failure mode expectations, and
  - scope exclusions/non-goals.
- **Asymmetric semantic updates are a hard blocker.** If only decision or question text was updated for a semantic change, keep refinement in progress and reconcile before reporting done.
- **Grooming-to-plan carry-forward is required when grooming exists.** For every still-relevant confirmed/deferred design point in the grooming artifact, either carry it into the plan (phase watch-outs, task `decision:` metadata, appendix, pending question, or scope/non-goal text) or explicitly decide it is out-of-scope and record that rationale in `## Revision History`.
- **Resolution expectation during refinement:** resolve as many open questions as possible before writing. Leave questions pending only for implementation-level details or explicit user-requested deferral.
- **Appendix maintenance for complex design-derived work:** if the refined plan is based on substantial upstream design context, ensure `## Appendix` exists and is current. It must summarize key design decisions, constraints/invariants, interface contracts, migration/rollout implications, and rejected alternatives that materially affect task ordering or scope.
- **Temporary coverage exclusion discipline:** if a newly added contract-first phase uses temporary coverage-exclusion attributes or mechanisms because implementations arrive later, add explicit cleanup/removal tasks and require `TODO:(DEVENV[plan-key]): ...` markers at the affected code locations so coverage restoration is not lost.

**Acceptance criteria changes:**

- **New ACs**: infer from the new scope, mark `*(inferred)*`, append to the `## Goals and Acceptance Criteria` section with the next `AC-N` number (e.g. if AC-4 is the last, the next is AC-5). Use the canonical format: `- [ ] **AC-N** criterion text *(inferred)*`.
- **Minor revision** (clarification or wording improvement — same intent, same observable outcome): rewrite the criterion text in place and append a revision note: `- [ ] **AC-N** Revised text *(inferred)* — *revised: brief note*`. Record in Revision History.
- **Significant change** (scope, acceptance conditions, or observable outcome changes meaningfully):
  1. Remove the `- [ ]` checkbox, wrap the criterion in `~~strikethrough~~`, and append `*(superseded by AC-M)*`
  2. Add a new criterion: `- [ ] **AC-M** replacement text *(inferred)*` (next available AC-N number)
  3. Record both in Revision History.
- **AC ticking is done by the execution skills** (pair-programming / delegation) during the AC Review phase — do not tick ACs here unless the user explicitly confirms a criterion is already met.

### 3a. Material-change completeness reconciliation (required)

When a refinement materially alters the plan, run a completeness reconciliation before recording revisions and writing.

Treat the change as material when any of these are true:

- scope or acceptance conditions changed,
- task structure changed in an affected phase (insertions/reflow/splits/merges),
- decision outcomes changed for work previously marked complete,
- phase ordering or phase boundaries changed.

Task completeness review (affected phases only):

1. Review every task currently marked `[x]` in affected areas against the updated scope/decisions.
2. Prefer adding follow-on tasks for new work; do not reopen completed tasks unless unavoidable.
3. If reopening is unavoidable, explicitly state why in `## Revision History` and keep the reopen scoped to the smallest affected task.
4. Review unchecked tasks that may now be satisfied by completed work; mark `[x]` only with explicit user confirmation.

Cleanup-task reconciliation (when affected tasks are cleanup/scaffold-removal tasks):

1. Confirm artifact-level cleanup occurred (temporary file/class/test removed or migrated), not just marker-text removal.
2. Require at least one artifact-level diff reference before marking cleanup tasks `[x]`.
3. If revision-history wording is narrower than task scope (for example marker removal logged while scaffold artifact remains), keep the task open and record remaining artifact work.

AC completeness review:

1. Recheck all affected acceptance criteria for status drift after the material change.
2. Classify each affected AC as `still met`, `no longer met`, `superseded`, or `pending verification`.
3. Do not tick AC checkboxes in refinement unless the user explicitly confirms the criterion is already met.
4. If an AC is superseded, keep identifier stability (no renumbering), apply the existing supersede pattern, and record the change in `## Revision History`.

Before final write, summarize this reconciliation in chat:

- tasks kept closed,
- tasks reopened (if any, with rationale),
- new follow-on tasks added instead of reopening,
- ACs confirmed unchanged vs ACs requiring future closure.

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

Attribution rule for this section: revision bullets describe the change, rationale, and resulting scope. Do not attribute entries to AI, Copilot, or specific models. If actor attribution is required, attribute to the current user/engineer or team context.

Intermediate local draft iterations during the same refinement effort do not each get their own revision-history entry; record the net result once for the whole effort.

Before writing, run a short carry-forward verification in chat: list the important grooming decisions/constraints, show where each now lives in the refined plan, and ask whether any important point is still missing.

Also run a decision-package parity check for every semantic decision/question touched in this refinement. If the file changed concurrently during iteration, reread the touched decision/question sections and rerun parity before final write.

### 5. Write the result

- For file input: overwrite the file in place. The user can `git diff` to review and revert if needed.
- For issue input: write and refine against the local working copy first, then offer to push that same local file back to the issue body: "Update issue #N body with the refined plan? (`issue-update N --body-file <path>` )" Wait for explicit yes before running.

Do not require a separate approval step for the write itself — the user invoked the skill to refine the plan; trust that intent. Git is the safety net.

### 6. Report back

Summarise inline:

- How many tasks were added / reworded / marked done / cancelled
- Which phases were affected
- The new total task count
- (For issue input) whether the issue body was updated

## Anti-patterns

- **Renumbering existing tasks without structural need** — avoid gratuitous renumbering. Reflow only when a structural insertion requires it, and update all affected references.
- **Using alphabetic task suffixes** — invalid (for example `7.1a`). Use numeric hierarchical subtasks (`7.1.1`) or reflow numbering.
- **Renumbering existing AC-N identifiers** — same principle. AC-3 stays AC-3; append new ACs at the next available number.
- **Silently unchecking `[x]`** — discards user progress. If completed work needs to be redone, add a new task.
- **Deleting cancelled tasks** — leaves a confusing gap in the numbering and erases history. Strike through and annotate instead.
- **Skipping the Revision History** — turns the file into a black box where readers can't tell what changed.
- **Writing prior-state narrative in plan body** — keep all historical notes in `## Revision History`. This includes dated scope-change announcements (e.g. *"Scope was expanded on DATE to include…"*), before/after narration, and inline revision summaries. The main plan must read as the current target state, as if no revisions had ever occurred.
- **Writing refinement-era wording in plan body** — phrases such as "in this refinement" or "during this update" are not allowed outside `## Revision History`.
- **AI/model attribution in artifact text** — do not write lines like "updated by AI", "generated by Copilot", or "revised by <model>" in plan sections or revision history.
- **Assuming what changed** — always interview before editing. The user knows things you don't.

## Sibling skills

- `/devenv-create-implementation-plan` — for brand-new plans from scratch.
- `/devenv-plan-status` — for reporting progress without modifying the plan.
- `/devenv-pair-programming` and `/devenv-delegation` — for actually executing the (refined) plan.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
