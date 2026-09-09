# Staleness Assessment Protocol

Used by `/devenv-refine-implementation-plan` in **assessment mode**, when the user does not already know what changed — typically after returning to a plan following a significant gap (weeks, a sprint, multiple landed PRs), or when delegation/pair-programming kickoff surfaced drift signals.

The assessment answers one question: *how far has the codebase drifted from what the plan assumes?* — and routes to the right in-skill remediation.

## Step 1 — Format conformance gate (required first)

Before staleness analysis, check whether the plan matches the current implementation-plan shape:

- `## Goals and Acceptance Criteria`
- `## Context and Orientation`
- `## Phase TOC`
- `## Phases` with tasks embedded under each phase (via `**Tasks:**` and task checkboxes)
- `## Reference Information`

Legacy-format signals:

- `## Detailed Task List` section exists.
- `## Additional Task Context` section exists.
- `## Phase TOC` is missing.
- Phase sections have no embedded tasks while tasks exist elsewhere.

If any legacy-format signal is present, offer a format normalization pass first:

> *"This plan looks like a legacy format. I can reorganize it to the current structure (phase TOC + tasks and task context co-located under each phase) before I run the staleness assessment. Do you want me to normalize format first? (recommended: yes)"*

If **yes**: reorganize structure only (no semantic edits) — move each phase's tasks under that phase, move per-task context under the corresponding task, add `## Phase TOC` with phase anchors, keep Appendix / Pending Questions / Reference Information in place, keep all checkbox states and task/AC numbering unchanged. No changelog edits; structural only. Continue the assessment on the normalized plan.

If **no**: continue against the existing structure, include a `⚠️ format drift present` note in the report, and re-offer normalization at the end.

## Step 2 — Signal scan

Work through each category; note every signal for classification.

### 2a. File anchor check

Collect every file path via `plan-parse <plan> --anchors` — it lists each path with an `exists` flag. For any `"exists": false` entry, look for moves (similar names via `file_search`). Flag: **exists** / **moved to X** / **gone**.

### 2b. Symbol anchor check

Collect class, interface, and key method names mentioned in the plan. For each, `grep_search` to verify presence in the codebase. Flag: **exists** / **renamed** / **gone** / **not found (may never have existed)**.

### 2c. Git log scan (if available)

`git log --oneline --since="<last-update-date or 90 days ago>"` on the relevant repo(s). Look for commits touching the same areas as in-scope tasks; summarize whether significant changes landed in scope. With no reliable metadata date, use a 90-day lookback.

### 2d. Dependency / assumption scan

Read each unchecked task. Flag tasks that: assume a codebase state that no longer matches ("extract X from Y" but Y was refactored away); depend on a `[x]` task whose implementation was since reverted or significantly changed; reference external services/APIs/libraries whose versions appear to have changed.

### 2e. Already-done scan

Look for unchecked tasks that appear already implemented in the codebase — "phantom tasks" done outside the plan.

## Step 3 — Classify and present

Synthesize signals into one classification and present the evidence report:

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

| Classification | Meaning | Remediation |
|---|---|---|
| **Slightly stale** | A few paths moved or renamed, 1–3 phantom tasks, core approach valid | surgical patching (below) |
| **Significantly stale** | Multiple broken anchors, key assumptions invalidated, but phase goals remain right | full revision interview driven by findings |
| **Intent-only** | Task-level detail mostly wrong; phases still describe the right *what*, the *how* needs re-planning | intent extraction → re-plan |

Ask the user to confirm before acting:

> *"I'm classifying this as **[classification]**. Does that match your read, or would you bump it up or down?"*

If the user adjusts the classification, accept it — they have context the codebase scan can't see.

## Step 4 — Remediation paths

### Slightly stale → surgical patching

Apply patches directly, inline. No interview — the signals are sufficient.

**Permitted patch operations:**

- Update file paths that moved (`Files:` bullets and task description text).
- Update symbol names that were renamed.
- Mark phantom tasks `[x]` only when the work is already implemented — state the evidence in chat, not in the plan. No process-era annotations in task text.
- Add a brief note to any task whose description is now misleading.
- Repair section headings or placement only when needed to preserve the current human-first structure.

Do **not**: rewrite task descriptions wholesale, change phase structure, add phases, or renumber tasks.

After patching, write back and summarize briefly ("3 patches applied: updated 2 file paths, marked 2.3 [x] because the work is already implemented, noted the SyncEngine rename in 3.1. Plan is now current."). Offer to proceed to delegation or pair-programming if that was the user's next step.

### Significantly stale → findings-driven revision

Run the full refinement flow (revision interview, hard rules, completeness reconciliation) but **drive it from the assessment findings** — no open-ended interview for the known gaps; ask only for judgment calls:

1. Present a proposed change list derived from the assessment.
2. Ask: *"Anything to add, adjust, or remove from this list before I apply it?"*
3. Apply the confirmed set following all refinement hard rules (no renumbering, no unchecking `[x]`, append-only for new tasks).

### Intent-only → extract intent, then re-plan

1. **Extract intent** — one paragraph per phase describing *what it was trying to achieve* (the goal, not the tasks). Reconstruct or preserve the human-facing `## Phases` section if missing or clearly stale. Show the user; ask *"Does this capture the intent correctly, or has any of it changed?"*
2. Ask: *"Do you want me to run a full re-plan now using these as goals, or just save the intent summary so you can run `/devenv-create-implementation-plan` when you're ready?"*
3. **Re-planning now**: hand off to `/devenv-create-implementation-plan` with the extracted intents as goals (skip its free-form goals interview; interview only for repo/tech context). Write a new `Implementation_plan-*.md` with a fresh suffix, preserving the old plan file as-is.
4. **Saving for later**: write the intent summary as a `## Preserved intent` section appended to the bottom of the existing plan, and update the status line to `Status: intent-only — tasks are stale; see Preserved intent for goals.` (current-state status; no date marker).

## Rules

- **Never patch an intent-only plan** — that fixes symptoms while the structure is wrong.
- **Classification must match evidence** — be conservative; classify as intent-only only when task-level detail is genuinely unrecoverable.
- **Show signals before classification** — the user may have context that overrides them.
