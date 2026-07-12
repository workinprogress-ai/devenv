---
name: devenv-refresh-implementation-plan
description: 'Assess how stale an existing implementation plan is, then take the right remediation action — light patch, structured revision, or guided rewrite. USE WHEN the user says "refresh the plan", "is this plan still valid?", "how stale is this plan?", "bring this plan up to date", "freshen the plan", "the plan might be out of date", or when returning to a plan after a significant time gap. Runs a staleness assessment against the current codebase, classifies drift as slight / significant / intent-only, and routes to the appropriate fix. DO NOT USE when you already know exactly what needs updating (use `/devenv-refine-implementation-plan` instead), or for read-only progress reporting (use `/devenv-plan-status`).'
argument-hint: '<path-to-Implementation_plan-*.md | github-issue-number>'
user-invocable: true
---

# Refresh implementation plan

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

An implementation plan written during grooming can age in three different ways. This skill figures out which one applies and takes the right action — rather than requiring the user to diagnose it themselves.

## When to Use

- Returning to a plan after a significant gap (weeks, a sprint, multiple PRs landed in the meantime).
- About to start delegation or pair-programming and suspecting the plan may be out of date.
- Pair-programming or delegation kickoff surfaced drift signals and suggested running this skill.

If the plan is already known to be current and the user has specific changes in mind, skip this and use `/devenv-refine-implementation-plan` directly.

## Inputs

The user provides exactly one of:

- **A file path** — e.g. `Implementation_plan-issue-42-001.md`. Read and (if changes are made) written back.
- **A GitHub issue number** — e.g. `42`. Plan body fetched via `issue-get N --pretty`.

**Auto-detection rule:** if the argument matches `^[0-9]+$`, treat as issue number; otherwise treat as a file path.

---

## Step 1 — Load the plan

- Read the source (file or `issue-get` output).
- Identify: phase headings, all task lines (`- [ ]` / `- [x]`), `Files:` bullets, any mentions of specific class names / method names / file paths.
- Extract: last revision date from `## Revision History` (if present), or creation date from file metadata.
- Note: ratio of `[x]` vs `[ ]` tasks — a mostly-completed plan that still has unchecked tasks needs careful handling.

---

## Step 1a — Format conformance gate (required)

Before running staleness analysis, check whether the plan matches the current implementation-plan shape:

- `## Goals and Acceptance Criteria`
- `## Context and Orientation`
- `## Phase TOC`
- `## Phases` with tasks embedded under each phase (via `**Tasks:**` and task checkboxes)
- `## Reference Information`
- `## Revision History`

Legacy-format signals include:

- `## Detailed Task List` section exists.
- `## Additional Task Context` section exists.
- `## Phase TOC` is missing.
- Phase sections have no embedded tasks while tasks exist elsewhere.

If any legacy-format signal is present, do not silently continue. Offer a format normalization pass first:

> *"This plan looks like a legacy format. I can reorganize it to the current structure (phase TOC + tasks and task context co-located under each phase) before I run the staleness assessment. Do you want me to normalize format first? (recommended: yes)"*

If the user says **yes**:

1. Reorganize structure only (no semantic edits):
   - move each phase's tasks under that phase,
   - move per-task context under the corresponding task,
   - add `## Phase TOC` with phase anchors,
   - keep Appendix, Pending Questions, and Reference Information in place,
   - keep all checkbox states and task/AC numbering unchanged.
2. Record one Revision History entry noting format normalization only.
3. Continue with Step 2 staleness assessment on the normalized plan.

If the user says **no**:

- Continue with Step 2 against the existing structure, but include a `⚠️ format drift present` note in the staleness report and re-offer normalization at the end of the refresh.

---

## Step 2 — Staleness assessment

This step is the core of the skill. Work through each signal category below. For each signal found, note it — you'll use them in the classification.

### 2a. File anchor check

Collect every file path mentioned explicitly in the plan (from `Files:` bullets, task descriptions, or any `path/to/File.cs`-style references). For each:

- Check whether the file exists at that path in the workspace.
- If it doesn't exist, check whether it moved (look for similar names with `file_search`).
- Flag each: **exists** / **moved to X** / **gone**.

### 2b. Symbol anchor check

Collect class names, interface names, and key method names mentioned in the plan. For each, run a quick `grep_search` to verify they exist in the codebase.

- Flag each: **exists** / **renamed** / **gone** / **not found (may never have existed)**.

### 2c. Git log scan (if available)

Run `git log --oneline --since="<last-revision-date or 90 days ago>"` on the relevant repo(s). Look for commits that touch the same areas as the plan's in-scope tasks. Summarise: have there been significant changes to the files in scope?

If the plan has no revision date, use 90 days as the lookback window.

### 2d. Dependency / assumption scan

Read each unchecked task. Look for tasks that:
- Assume a state of the codebase that no longer matches (e.g. "extract X from Y" but Y was already refactored away).
- Depend on a `[x]` checked task whose implementation has since been reverted or significantly changed.
- Reference external services, APIs, or libraries whose versions appear to have changed.

### 2e. Already-done scan

Look for unchecked tasks that appear to already be implemented based on the codebase state. These are "phantom tasks" — the work was done outside the plan.

---

## Step 3 — Classify and present findings

Synthesise the signals from Step 2 into a staleness classification. Present it as a short report before asking the user to confirm:

```
## Staleness Assessment

**Classification: [Slightly stale | Significantly stale | Intent-only]**

**Signals found:**
- ✅ 12/15 file anchors exist at the expected paths
- ⚠️  `IDocumentSyncStep.cs` moved to `Abstractions/` subfolder (was at root)
- ❌  `DocumentSyncOrchestrator` class no longer exists (merged into `SyncEngine`)
- ⚠️  Git log: 8 commits to `SyncEngine.cs` since plan was written — significant rework
- ⚠️  Task 2.3 ("extract orchestration from DocumentSyncOrchestrator") appears already done
- ✅  Tasks 1.x all [x] — Phase 1 is complete and still looks accurate
- ⚠️  Format drift present (legacy plan structure)

**Summary:** The plan's Phase 1 is clean. Phase 2 has a broken class reference and one phantom task. Phase 3+ are speculative given the SyncEngine rework.
```

### Classification criteria

| Classification | What it means |
|---|---|
| **Slightly stale** | A few paths moved or renamed, 1–3 phantom tasks, core approach still valid. Patchable in-place. |
| **Significantly stale** | Multiple broken anchors, key assumptions invalidated, but the phase goals are still the right goals — tasks need substantial rework. |
| **Intent-only** | So much has changed that most task-level detail is wrong or misleading. The phases still describe what needs doing, but the how needs to be re-planned against the current codebase from scratch. |

**Ask the user to confirm the classification before acting:**

> *"I'm classifying this as **[classification]**. Does that match your read, or would you bump it up or down?"*

Wait for confirmation. If the user adjusts the classification, accept it — they have context the codebase scan can't see.

---

## Step 4 — Act based on classification

### If slightly stale

Apply patches directly and inline. No interview needed — the signals from Step 2 are sufficient.

**Permitted patch operations:**
- Update file paths that moved (update `Files:` bullets and task description text).
- Update symbol names that were renamed.
- Mark phantom tasks `[x]` only when the work is already implemented in the codebase. If a note is needed, prefer factual wording such as `*(already implemented in codebase at refresh)*`.
- Add a brief note to any task whose description is now misleading.
- Repair section headings or section placement only when needed to preserve the current human-first structure: `## Goals and Acceptance Criteria`, `## Context and Orientation`, `## Phase TOC`, `## Phases`, `## Reference Information`, `## Revision History`.

Do **not**:
- Rewrite task descriptions wholesale.
- Change phase structure or add new phases.
- Renumber existing tasks.

After applying patches, record a revision history entry and write the plan back. Brief summary to the user:

> *"3 patches applied: updated 2 file paths, marked 2.3 [x] because the work is already implemented, noted the SyncEngine rename in task 3.1. Plan is now current."*

Offer to proceed directly to delegation or pair-programming if that's what the user was about to do.

### If significantly stale

Run a structured revision. This follows the same rules as `/devenv-refine-implementation-plan` but the AI drives the changes based on the Step 2 findings — no interview needed for the known gaps; only ask for judgment calls.

**Process:**

1. Present a proposed change list derived from the assessment:
   ```
   Proposed changes:
   - Phase 2: rewrite tasks 2.3–2.6 around the new SyncEngine shape
   - Phase 2: add task 2.9 — update integration tests for renamed interface
   - Phase 3: task 3.1 description is now misleading; propose reword
   - Mark 2.3 [x] (phantom task — already done)
   ```
2. Ask: *"Anything to add, adjust, or remove from this list before I apply it?"*
3. Wait for reply, then apply the confirmed change set following all rules from `/devenv-refine-implementation-plan` (no renumbering, no unchecking `[x]`, append-only for new tasks, revision history entry).
4. Write back and summarise.

### If intent-only

The plan's tasks are too stale to patch. Extract the intent, then re-plan.

**Process:**

1. **Extract intent** — for each phase, write a one-paragraph summary of *what it was trying to achieve* (the goal, not the tasks). Reconstruct or preserve the human-facing `## Phases` section if it is missing or clearly stale. Show these to the user:
   ```
   Phase 1 intent: Set up the project structure and install dependencies.
   Phase 2 intent: Refactor the orchestration layer to support pluggable sync steps.
   Phase 3 intent: Add integration tests covering the sync pipeline end-to-end.
   ```
2. Ask: *"Does this capture the intent correctly, or has any of it changed?"* Adjust based on answer.
3. Ask: *"Do you want me to run a full re-plan now using these as goals, or just save the intent summary so you can run `/devenv-create-implementation-plan` when you're ready?"*
4. **If re-planning now**: proceed as `/devenv-create-implementation-plan` would, but skip the free-form goals interview (you already have them from the intent extraction). Interview the user only for the repo/tech context questions. Write a new `Implementation_plan-*.md` with a fresh suffix, preserving the old plan file as-is (archive reference).
5. **If saving for later**: write the intent summary as a `## Preserved intent` section appended to the bottom of the existing plan, with a note at the top: *"⚠️ This plan is marked intent-only as of [date] — tasks are stale; see Preserved intent section for goals."*

---

## Anti-patterns

- **Silently ignoring legacy format drift** — if the plan is in old structure, explicitly offer normalization before staleness classification.
- **Bundling format normalization with semantic rewrites without saying so** — format-only reorganization must be explicit and preserve task/AC numbering and checkbox state.
- **Assuming the classification without showing signals** — always show the evidence; the user may have context that overrides it.
- **Patching an intent-only plan** — don't apply light patches to a plan that needs a rewrite; you'd be fixing symptoms while the structure is wrong.
- **Renumbering existing tasks** — even during a significant revision, preserve all existing task numbers. Append; never reflow.
- **Silently unchecking `[x]`** — if a completed task turns out to need redoing, add a new task rather than resetting the old one.
- **Treating every small drift as intent-only** — the classification must match the actual evidence. Be conservative: only classify as intent-only when the task-level detail is genuinely unrecoverable.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
