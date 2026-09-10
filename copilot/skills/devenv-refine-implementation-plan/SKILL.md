---
name: devenv-refine-implementation-plan
description: Align an existing Implementation_plan-*.md (or GitHub issue containing an implementation-plan artifact comment) with reality — one skill entered from three starting points. Surgical mode for small known edits ("mark 3.4 done", "tick off task 2.1", "add a note to task X", "answer that open question", "add one more task to phase 3" — max 3 edits, per-edit confirm). Revision mode for known broader changes ("refine the plan", "update the plan", "rework the plan based on what we learned", tasks reworded, scope adjusted). Assessment mode when staleness is unknown ("refresh the plan", "is this plan still valid?", "the plan might be out of date", returning after a gap) — runs a staleness assessment against the current codebase and routes internally. Auto-detects file path vs GitHub issue number, preserves all existing `[x]` checkbox state, appends new tasks by default, supports task reflow for structural insertion, and creates new phases when the target phase is fully complete. DO NOT USE for creating a brand-new plan from scratch (use `/devenv-create-implementation-plan`) or for executing the plan (use `/devenv-pair-programming` or `/devenv-delegation`).
argument-hint: Path to an Implementation_plan-*.md OR github-issue-number[:doc_id], plus what changed (or nothing for assessment)
---

# Refine implementation plan

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

Take an existing implementation plan and align it with reality. The user's starting point differs — sometimes they know the exact small edit, sometimes they know the area that changed, sometimes they only suspect drift. This is one verb with three intake modes, not three skills. Preserve all existing progress; never silently undo work.

## Intake: classify the mode

After loading the plan (see Inputs), classify the invocation into one of three modes:

| Mode | User's state | Typical phrases |
|---|---|---|
| **Surgical** | Knows the exact small change(s) | "mark 3.4 done", "tick off task 2.1", "add a note to task X", "answer that open question" |
| **Revision** | Knows what area changed; needs structured rework | "refine the plan", "rework the plan after what we learned", "scope changed, update the plan" |
| **Assessment** | Does not know whether the plan is still valid | "refresh the plan", "is this plan still valid?", "the plan might be out of date", returning after a gap |

Classification rules:

- **≤3 discrete edits, each matching the surgical operation set (below) → surgical mode.** More than 3, or any operation outside the set → revision mode.
- **Explicit staleness/validity language, or a drift-signal handoff from delegation/pair-programming → assessment mode.**
- **Ambiguous between revision and assessment → ask one question:** "Do you already know what changed, or should I assess the plan against the codebase first?"
- A session may move between modes (assessment finds drift → revision applies it; revision reveals a quick tick → surgical). Mode sets the *entry* flow, not a permanent lane.

## When to Use

- The user has an `Implementation_plan-*.md` (or a GitHub issue with an implementation-plan artifact comment) that needs small surgical edits, broader revision, or staleness assessment — in any combination.
- A previous `/devenv-create-implementation-plan` run needs alignment with what actually happened.
- Execution (pair-programming / delegation) surfaced drift signals and suggested an assessment.

If there is no existing plan, stop and redirect to `/devenv-create-implementation-plan`.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `Implementation_plan-issue-42-001.md`, `repos/foo/Implementation_plan-003.md`. Treated as a literal markdown file to read and write back.
- **A GitHub issue number** — e.g. `42` or `42:<doc_id>`. Resolve one implementation-plan artifact (`issue-artifact-select`) and read it via `issue-artifact-get`. After refinement, offer to push updates back to the same artifact via `issue-artifact-upsert`.

Issue artifact selection rules:

- If `<doc_id>` is provided, use that exact artifact.
- If no `<doc_id>` is provided and exactly one `implementation-plan` artifact exists, use it.
- If multiple artifacts exist, list candidates via `issue-artifact-list --issue <N> --artifact-type implementation-plan --pretty` and ask the user which `doc_id` to refine.

**Auto-detection rule:** if the argument matches `^[0-9]+$`, treat as issue number; otherwise treat as a file path. If both could plausibly apply, ask the user which they meant.

**Upstream design source rule:** if the plan links a grooming artifact (or the user provides one), load it and treat it as the directing source for design decisions, constraints, deferred items, and non-goals. The implementation plan remains the execution artifact, but grooming is authoritative for design intent when present.

For issue-backed plan refinement, follow the shared [issue-backed artifact edit protocol](../common/references/issue-backed-artifact-edit-protocol.md).

## Workflow

### 0. Mode dispatch

Apply the intake classification above. Then:

- **Surgical mode** → run the [surgical edit protocol](#surgical-edit-protocol), then jump to Step 5 (write) and Step 6 (report).
- **Assessment mode** → run the [staleness assessment protocol](./references/staleness-assessment.md); its outcome routes internally: slightly stale → surgical patching; significantly stale → findings-driven revision (Steps 1–4 with the findings replacing the open-ended interview); intent-only → intent extraction → `/devenv-create-implementation-plan`. Assessment also glances at the upstream-impact queue (`issue-list --label upstream-impact` in the planning repo): open issues naming this plan's scope are drift signals that feed the assessment.
- **Revision mode** → continue with Steps 1–6 below.

### Surgical edit protocol

Small, surgical edits without a revision interview.

**Hard limit: 3 operations per invocation.** If more are requested, or any operation falls outside the supported set, switch to revision mode (continue with Steps 1–6).

| Operation | Supported in surgical mode? |
|---|---|
| Mark task `[x]` | yes — apply via `markdown-plan-complete-task <id> <plan_file>` (deterministic; never retype the line) |
| Mark task `[ ]` (undo) | via `markdown-plan-complete-task <id> <plan_file> --uncomplete`; only if it was ticked in the current session (e.g. by mistake); prior-session checkboxes refuse — suggest adding a new task instead |
| Answer/resolve an open question | yes |
| Append a short note to a task line | yes |
| Add one new task at the end of a phase | yes |
| Reword an existing task | no — revision mode |
| Restructure or reorder phases | no — revision mode |
| Cancel a task (delete clean) | no — revision mode |
| Modify acceptance criteria (AC-N) | no — revision mode |

For each edit, show a one-line preview and ask for explicit confirmation (one y/n per edit — never batch):

> "Mark task **3.4 Create X** as done? (y/n)"
> "Append note to **2.7**: 'fix landed in commit abc123'? (y/n)"

If the user declines any edit, skip it and continue. Notes append to the task line as `— note: <text>` or an indented sub-bullet. Resolved questions: inline-edit the `[QUESTION]` line with `— answered: <text>`, or fold the answer into surrounding text and remove the question (prefer inline for short answers).

Then apply the shared hard rules (Step 3), write (Step 5), and report (Step 6) with per-change one-liners plus new task counts.

### 1. Load and parse the existing plan

- Read the source (file or `issue-artifact-get --write-body` output).
- Run `plan-parse <plan_file> --structure` for the authoritative phase/task inventory; `--census` for per-phase completion; `--anchors` for the file-path existence scan.
- If the source is an issue artifact, materialize it to a local working copy before editing (repo-local file or temp file, depending on user choice when not already implied). Use that local working copy for all iterations in this refinement effort, and keep its `doc_id` in context for republish.
- Run `plan-parse <plan_file> --structure` for the authoritative view: phase headings, task lines, IDs, and completion state in one JSON — do not hand-scan headings or checkboxes. Use `--census` when you only need per-phase completion counts.
- The highest task number per phase and highest phase number come from the `plan-parse` output (max `id` / max `number`) — no manual arithmetic.
- **Assess completion state**: `plan-parse --census` gives per-phase done/open counts directly.
- If a marker-style escalation record exists in plan decisions or pending questions, treat it as high-priority refinement context and resolve it first.
- Preserve the high-level section order introduced by the current template: goals/AC first, context/orientation second, phases third, detailed task tracking later.
- If `## Pending Questions` exists, preserve it and keep it immediately above `## Reference Information`.
- If `## Reference Information` links a grooming artifact, load it before interviewing. For issue-backed plans, also check issue comments/source context for a linked grooming artifact when the body references one indirectly.
- Treat an in-flight partially executed plan as a normal refinement case, not an exception: preserve completed work, update only the necessary downstream design/sequence/task surfaces, and avoid rewriting already-validated earlier phases unless the user explicitly asks.

### 2. Interview the user about what changed (revision mode)

In revision mode, use `vscode_askQuestions` to gather:

- **What's new** — new tasks to add, or themes for new tasks.
- **What's wrong** — tasks whose descriptions are now misleading or whose scope changed.
- **What's done outside the plan** — work completed that should be marked `[x]` retroactively.
- **What's no longer relevant** — tasks to delete clean or replace (the plan carries current target state only)
- **Acceptance criteria changes** — whether any ACs need to be added, revised, or deprecated as a result of the scope change. Infer candidate changes from the new specifications and present them for the user to confirm rather than asking the user to define them from scratch. See AC rules in Step 3.
- **Upstream design changes** — whether a design doc/RFC/Blueprint/Redesign decision changed and should be reflected in `## Appendix`.
- **Grooming carry-forward** — if a grooming artifact is present, confirm which `Confirmed` / `Deferred` / still-relevant `Pending` items must now be represented in the plan's phase watch-outs, task `decision:` metadata, `## Pending Questions`, appendix, or explicit scope boundaries.
- **Pending questions** — whether any unresolved questions should be added, answered, moved inline under a task/phase, or spun out into a follow-up issue.
- **Decision points** — identify unresolved implementation decisions that could block phase execution; resolve them during refinement when possible.
- **Escalation handoff closure** — if unresolved blockers/questions are captured in plan decisions or pending questions, confirm each one and decide: resolve now, defer with explicit trigger, or re-scope tasks/phases.
- **Architectural fault classification** — if blockers/questions are architectural rather than task-scope adjustments, load and follow the [plan architectural review protocol](../common/references/plan-architectural-review.md) to locate fault points and classify type. If architectural issues are confirmed, produce a scoped brief and recommend the appropriate design skill with the plan path as argument:
  - Option-weighing / approach not settled → `/devenv-design-discussion <plan-path>`
  - Current approach needs reclassification → `/devenv-grooming <plan-path>`

  **File an upstream-impact issue** for confirmed architectural findings that originate above the plan (specification or blueprint level): `issue-create --type Task --label upstream-impact --no-template` in the planning repo (`GITHUB_REPO` is already set), body covering what changed/was discovered, why it matters, and the affected upstream sections. This puts the finding on the queue that `/devenv-refine-specifications` and `/devenv-refine-blueprint` consume in cascade mode.

  Do not continue plan refinement for architectural items until the design question is resolved.
- **Legacy code exposure** — if new tasks will introduce implementations that coexist with existing legacy code in the same files across multiple phases, flag the issue: the plan likely needs an early cleanup phase. See [phase-rules.md](../devenv-create-implementation-plan/references/phase-rules.md) for available patterns (demolition, hollow-out, rename suffix, branch by abstraction). Surface the viable options and a recommendation before writing new tasks; don't silently pick one.

Do not assume. If the new specifications imply renumbering or reordering, flag it and ask before proceeding.

### 2a. Optional pressure-test pass (user-gated)

Before applying edits, offer an optional pressure-test pass using [pressure-test-protocol.md](../common/references/pressure-test-protocol.md) when scope changes have architectural or sequencing risk.

- Never run automatically; proceed only after explicit user consent.
- Keep it bounded to at most two passes per current plan state.
- Use findings to decide whether to continue local refinement, route a bounded blocker to [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md), or route broader drift to [`/devenv-grooming`](../devenv-grooming/SKILL.md).

### 3. Apply changes — preserve everything

**Hard rules:**

- **Main plan content must describe the current target state only.** Every section must read as a clean, current description of what the plan is trying to achieve and how. This means:
  - No dated announcements such as *"Scope was expanded on 2026-06-23 to include…"* in plan body sections.
  - No before/after narration, phrases like "previously", "originally", "as of this revision", or inline change summaries.
  - No refinement-process narration in plan body sections, including phrases like "in this refinement", "during refinement", "as part of this update", or "we changed this from".
  - Rewrite affected content directly to present-state truth; do not annotate material sections with update-era wording.
  - `## Context and Orientation` describes the current scope and motivation only — it is not a changelog and must not grow stale sentences about prior revisions.
  - When scope expands, update the orientation text in place to reflect the new scope.
  - Do not attribute edits to AI or model names in plan body text (for example: "AI updated", "Copilot added", "GPT revised").
  - If discovery merely validates wording the plan already had, do not edit the plan just to add "confirmed", "completed", or similar narration.
- **Never reflow existing task numbers** unless a structural revision inserts work in the middle of an existing task series. In that case, renumber the downstream task series and update all in-plan references that point at those task IDs.
- **Task IDs are numeric only.** Do not use alphabetic suffixes such as `7.1a` or `2.4b`.
- **Insertion options are constrained to numeric forms.** When inserting between existing tasks, either:
  - reflow downstream numbering and update all affected references, or
  - add numeric hierarchical subtasks (for example `7.1.1`, `7.1.2`) when preserving surrounding numbering is preferable.
- **Never reflow existing AC-N identifiers.** An AC numbered `AC-3` stays `AC-3` for its entire lifetime — same principle as task numbers.
- **Never silently uncheck a `[x]`.** If a completed task's scope must change, leave it checked and add a new task for the additional work.
- **New tasks are appended to the end of their phase** with the next sequential number (e.g. if Phase 2 ends at 2.7, the next new task is 2.8). New tasks must use the full task format: `- [ ] **N.M [S|M|L] Title**` header, descriptive sub-bullets first, then `Files:` / `decision:` / `owner:` / `depends on` metadata. Do not add skeletal or title-only tasks.
- **When the target phase is fully complete (`[x]` on all its tasks), do not append to it.** Adding tasks to a complete phase misrepresents how the work progressed and resets progress markers. Instead, create one or more new phases numbered sequentially after the last existing phase (e.g. if the plan ends at Phase 4, new work goes in Phase 5, 6, etc.). This applies equally when the entire plan is complete — the canonical case is a plan that was finished and committed, then new downstream specifications surface that should have been part of the original scope.

  **Phase numbering is structural, and task numbering may reflow when needed.** If the user explicitly wants the new phase inserted before a later existing phase, treat that as a structural revision: renumber the downstream phase headings sequentially, update any in-plan references that mention those phase numbers, and renumber any affected downstream task series when the insertion lands in the middle of them.

  New phases must follow the same phase rules as any other phase under the plan's **verification declaration** (code default: each phase committable with its own tests; final new phase includes cleanup and docs for the new scope). If the refinement changes the objective's nature (e.g. a code plan gains a docs phase), the verification declaration itself is a revision-mode edit requiring explicit user approval — surgical mode cannot change it.

  When the new scope introduces or changes important boundaries, add an early phase for defining or tightening contracts before broad implementation starts. This usually means interfaces, API/request/response shapes, message schemas, extension points, or persistence boundaries land before the phases that fully implement them.

  The first of the new phases must include an explicit task to **review the new scope and place forward guidance comments** (`TODO:(DEVENV[...])`) at anticipated touch points — the same role Phase 1 plays in a fresh plan. Example task: `- [ ] **5.1 [S] Review new scope and place forward guidance comments** — scan files affected by phases 5–6, add TODO:(DEVENV[...]) comments at integration points and stubs that later tasks will fill.`

  Surface this to the user before writing: *"Phase 3 is fully complete — I'll add the new work in a new Phase 5 rather than appending to Phase 3. The existing Cleanup (Phase 4) is also done, so I'll add a new Phase 6 for cleanup of the new scope. Does that structure work for you?"*
- **Prefer rewrite/addition over removal.** If the work still matters but the original task is misleading, keep the number and reword it, or add a follow-on task.
- **Cancelled tasks are deleted clean** — remove the task line entirely, no strikethrough, no tombstone annotation. Gaps in task numbering are expected and harmless; git history and (for significant supersessions) an ADR hold the why. Update any `depends on` references pointing at the removed task.
- **Reworded tasks** keep their number and reflect the latest agreed intent.
- **Pending questions**: task- or phase-specific questions live inline under the relevant task/phase as `[QUESTION] ...`; general plan-level questions live in `## Pending Questions` immediately above `## Reference Information`. Resolved minor questions may be folded directly into the plan and removed.
- **Decision/pending-question placement:** unresolved decisions that matter to execution must be represented in both places:
  - the relevant phase under **Watch Outs / Decisions**
  - the earliest affected task as `decision:` metadata under the same phase's `**Tasks:**` list
- **Decision-package parity for semantic updates is required.** When resolving or clarifying a semantic decision/question, update both together:
  - decision source text,
  - matching question text/state.
- **Decision/question parity check is mandatory before completion.** Verify decision and question text mirror each other for:
  - lifecycle lane coverage,
  - ownership boundary,
  - failure mode expectations, and
  - scope exclusions/non-goals.
- **Asymmetric semantic updates are a hard blocker.** If only decision or question text was updated for a semantic change, keep refinement in progress and reconcile before reporting done.
- **Grooming-to-plan carry-forward is required when grooming exists.** For every still-relevant confirmed/deferred design point in the grooming artifact, either carry it into the plan (phase watch-outs, task `decision:` metadata, appendix, pending question, or scope/non-goal text) or explicitly decide it is out-of-scope and keep that rationale in current decision/question text.
- **Resolution expectation during refinement:** resolve as many open questions as possible before writing. Leave questions pending only for implementation-level details or explicit user-requested deferral.
- **Appendix maintenance for complex design-derived work:** if the refined plan is based on substantial upstream design context, ensure `## Appendix` exists and is current. It must summarize key design decisions, constraints/invariants, interface contracts, migration/rollout implications, and rejected alternatives that materially affect task ordering or scope.
- **Temporary coverage exclusion discipline:** if a newly added contract-first phase uses temporary coverage-exclusion attributes or mechanisms because implementations arrive later, add explicit cleanup/removal tasks and require `TODO:(DEVENV[plan-key]): ...` markers at the affected code locations so coverage restoration is not lost.

**Acceptance criteria changes:**

- **New ACs**: infer from the new scope, mark `*(inferred)*`, append to the `## Goals and Acceptance Criteria` section with the next `AC-N` number (e.g. if AC-4 is the last, the next is AC-5). Use the canonical format: `- [ ] **AC-N** criterion text *(inferred)*`.
- **Minor revision** (clarification or wording improvement — same intent, same observable outcome): rewrite the criterion text in place and keep only the latest wording.
- **Significant change** (scope, acceptance conditions, or observable outcome changes meaningfully):
  1. Delete the old criterion entirely — no strikethrough, no tombstone
  2. Add a new criterion: `- [ ] **AC-M** replacement text *(inferred)*` (next available AC-N number)
  3. If the supersession is significant (a future implementer would ask why), write an ADR; the plan never carries prior-state narrative
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
3. If reopening is unavoidable, explicitly state why in the refinement summary and keep the reopen scoped to the smallest affected task.
4. Review unchecked tasks that may now be satisfied by completed work; mark `[x]` only with explicit user confirmation.

Cleanup-task reconciliation (when affected tasks are cleanup/scaffold-removal tasks):

1. Confirm artifact-level cleanup occurred (temporary file/class/test removed or migrated), not just marker-text removal.
2. Require at least one artifact-level diff reference before marking cleanup tasks `[x]`.
3. If a completion note is narrower than task scope (for example marker removal noted while scaffold artifact remains), keep the task open and record remaining artifact work in the task context.

AC completeness review:

1. Recheck all affected acceptance criteria for status drift after the material change.
2. Classify each affected AC as `still met`, `no longer met`, `superseded`, or `pending verification`.
3. Do not tick AC checkboxes in refinement unless the user explicitly confirms the criterion is already met.
4. If an AC is superseded, keep identifier stability (no renumbering) and delete the superseded criterion clean per the AC rules in Step 3.

Before final write, summarize this reconciliation in chat:

- tasks kept closed,
- tasks reopened (if any, with rationale),
- new follow-on tasks added instead of reopening,
- ACs confirmed unchanged vs ACs requiring future closure.

### 4. Reconcile and write current-state plan

Implementation plans are current-state artifacts in this workspace. Do not add or update changelog sections while refining.

Before writing, run a short carry-forward verification in chat: list the important grooming decisions/constraints, show where each now lives in the refined plan, and ask whether any important point is still missing.

Also run a decision-package parity check for every semantic decision/question touched in this refinement. If the file changed concurrently during iteration, reread the touched decision/question sections and rerun parity before final write.

### 5. Write the result

- For file input: overwrite the file in place. The user can `git diff` to review and revert if needed.
- For issue input: write and refine against the local working copy first, then offer to push that same local file back to the same issue artifact comment: "Update issue #N implementation-plan artifact with the refined plan? (`issue-artifact-upsert --issue N --body-file <path>` )" Wait for explicit yes before running.

For this publish step, once issue number and local working copy are established, run the known `issue-artifact-upsert` path directly. Do not add ad-hoc `--help`, `command -v`, or routine dry-run checks unless a real ambiguity or command failure appears.

Do not require a separate approval step for the write itself — the user invoked the skill to refine the plan; trust that intent. Git is the safety net.

### 6. Report back

Summarise inline:

- How many tasks were added / reworded / marked done / cancelled
- Which phases were affected
- The new total task count
- (For issue input) whether the issue artifact comment was updated

## Anti-patterns

- **Renumbering existing tasks without structural need** — avoid gratuitous renumbering. Reflow only when a structural insertion requires it, and update all affected references.
- **Using alphabetic task suffixes** — invalid (for example `7.1a`). Use numeric hierarchical subtasks (`7.1.1`) or reflow numbering.
- **Renumbering existing AC-N identifiers** — same principle. AC-3 stays AC-3; append new ACs at the next available number.
- **Silently unchecking `[x]`** — discards user progress. If completed work needs to be redone, add a new task.
- **Keeping cancelled tasks as strikethrough or tombstone text** — the plan is current-state only; delete cancelled tasks clean. Git history holds what was there; an ADR holds the why when it matters.
- **Writing plan changelog entries** — implementation plans are current-state artifacts; do not append revision-history logs during refinement.
- **Writing prior-state narrative in plan body** — keep the plan focused on current target state only.
- **Writing refinement-era wording in plan body** — phrases such as "in this refinement" or "during this update" are not allowed in plan content.
- **Adding discovery-only confirmation edits** — if exploration merely confirmed the plan was already right, leave the plan unchanged.
- **AI/model attribution in artifact text** — do not write lines like "updated by AI", "generated by Copilot", or "revised by <model>" in plan sections or revision history.
- **Assuming what changed** — always interview before editing in revision mode. The user knows things you don't.
- **Batching surgical confirmations** — each surgical edit gets its own y/n; the user must be able to decline one without rejecting all.
- **Growing the surgical limit** — more than 3 edits means revision mode; don't stretch surgical mode to avoid the interview.
- **Patching an intent-only plan** — if the assessment classified the plan intent-only, do not apply light patches; extract intent and re-plan.
- **Over-checking the artifact publish step** — once issue, `doc_id`, and file are known, do not run ad-hoc `--help` / `command -v` preflights instead of executing the known upsert command.

## Sibling skills

- `/devenv-create-implementation-plan` — for brand-new plans from scratch (also the re-plan target when assessment classifies a plan intent-only).
- `/devenv-pair-programming` and `/devenv-delegation` — for actually executing the (refined) plan. Both surface drift signals that route back here (assessment mode).

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
