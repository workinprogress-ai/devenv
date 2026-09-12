---
name: devenv-refine-roadmap
description: 'Revise an existing roadmap artifact (doc_id-addressed comment on its parent epic) after the underlying blueprint changes, a step gets split or merged, a new component lands, or phases need re-sequencing. USE WHEN the user says "refine the roadmap", "revise the roadmap", "the roadmap structure needs updating", "split this step", "re-sequence the phases", or hands off a roadmap whose structure (not just status) needs changes. Pulls the artifact to a session scratch copy, preserves all existing STEP-NN IDs and issue links, appends new steps rather than reflowing, deletes superseded steps clean (the why lives in ADRs), and republishes via issue-artifact-upsert. Roadmaps are downstream of specs/blueprint and upstream of grooming — they receive changes, they are never the entry point for changes. DO NOT USE for syncing step status from issues/PRs (use /devenv-update-roadmap), for creating a new roadmap (use /devenv-create-roadmap), or for revising the underlying blueprint (use /devenv-refine-blueprint).'
argument-hint: '<epic-number[:doc_id]> — the roadmap artifact to refine, plus what changed'
user-invocable: true
---

# Refine Roadmap

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

Revise the **structure** of an existing roadmap artifact after new information — the blueprint changed, a step needs splitting, a new component landed, or phases need re-sequencing. Preserve every prior step ID and issue link; supersede structure deliberately.

Roadmaps are GitHub artifacts (doc_id-addressed comments on their parent epic), not files in source control. Refinement pulls the artifact to a session scratch copy, edits there, and republishes. For the shared pull/edit/publish mechanics see [issue-artifact-integration.md](../common/references/issue-artifact-integration.md) and the [issue-backed artifact edit protocol](../common/references/issue-backed-artifact-edit-protocol.md).

Write roadmap phases and steps as the current target delivery structure. Keep historical change narrative out of the document entirely — the document is target state, period. Rationale for significant changes lives in ADRs (`docs/Decisions/`, see the shared [ADR template](../common/references/adr-template.md)); git (of the planning repo) and the issue's edit history record when. Roadmaps are downstream of specifications/blueprint and upstream of grooming: they receive changes from both directions, but changes never *enter* the workflow through a roadmap — use the refine skills and the upstream-impact queue for that.

This is the structural counterpart to [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md), which only syncs status from issues/PRs.

## When to Use

- The user has a roadmap artifact (on its parent epic) whose **structure** needs changes — new steps, split steps, re-sequenced phases, dropped steps
- A previous [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) added or removed a component
- Implementation discovery showed a step was bigger than expected and needs to be split
- A phase needs reordering because dependencies were misjudged

If only step **status** is out of date (issues closed, PRs merged), use [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) instead. If no roadmap exists, redirect to [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md).

## Inputs

The user provides an epic number (optionally `:<doc_id>` when the epic holds more than one roadmap artifact) — e.g. `89` or `89:dv1:workinprogress-ai/planning.development.main:issue-89:roadmap:orders-001`.

Resolution: `issue-artifact-select --issue <N> --artifact-type roadmap [--doc-id <DOC_ID> | --latest]` → `mkdir -p <repo-root>/.local-artifacts && issue-artifact-get --issue <N> --doc-id <DOC_ID> --write-body <repo-root>/.local-artifacts/roadmap-refine.md` (session scratch copy under the [standard local markdown folder](../_conventions.md#standard-local-markdown-folder-local-artifacts)).

## Workflow

### 1. Load and parse

- Pull the artifact to a session scratch copy (see Inputs). Read it. Identify all phases (`### PHASE-NN: ...`) and steps (`### STEP-NN: ...`).
- Note every step's existing **Issue** link, **Component**, **Blueprint section** references, and **Depends on** edges.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — steps, phases, or components to add (often driven by blueprint changes, or by a new specifications doc landing in a multi-epic project)
- **What needs splitting** — steps that grew too large during implementation
- **What's wrong** — dependency edges that turned out to be inaccurate, phase boundaries that no longer make sense
- **What's obsolete** — steps that are no longer needed; delete clean (the why, if significant, goes in an ADR)
- **What needs re-sequencing** — steps moving between phases for dependency or priority reasons
- **New specifications docs** — "Has a new `Specifications-<epic>-NNN.md` been added to the project that this roadmap should now cover?"
- **Source material** — "Are there meeting transcripts, design discussions, or other communications records behind these changes? If so, where are they?"

If the user provides communications artifacts, summarise each one separately (prefer the `Explore` subagent, one invocation per artifact, in parallel where possible) with a prompt focused on architectural decisions, component changes, sequencing decisions, and trade-offs raised. Surface each summary back for confirmation, then drive the change list from the approved summaries. Cite the source in the ADR when one is written so the rationale can be re-traced.

### 2a. Incorporating a new specifications doc

When a multi-epic project grows a new `Specifications-<epic>-NNN.md` after the roadmap was first built:

1. Read the new doc; extract every specification item and its `Dependencies:` (including cross-doc edges back into the existing specifications).
2. Draft a new candidate step per new specification item, asking the user for the target component (same procedure as `/devenv-create-roadmap` specifications-only mode).
3. **Append** the new steps with the next sequential `STEP-NN` IDs across the whole roadmap — do **not** renumber existing steps. Place each in the appropriate `PHASE-NN`, creating new phases at the end if the new epic deserves its own phases.
4. Resolve cross-doc dependency edges into step-level `Depends on:` edges.
5. If the incorporation is significant (a future implementer would ask why these phases exist), write an ADR citing the new doc path.
6. Offer to create issues for the new steps and update the parent epic's task list.

### 3. Apply changes — preserve everything

**Hard rules:**

- **Never reflow IDs.** `STEP-07` stays `STEP-07` for its lifetime. New steps get the next sequential number across the whole roadmap (not per-phase — step IDs are globally unique). Same for `PHASE-NN`. Gaps from deleted steps are expected and harmless.
- **Superseded steps are deleted clean** — no strikethrough, no tombstone text in the body. If the supersession is significant (a future implementer would ask why), write an ADR naming the step and its replacement; otherwise delete silently. Update every `Depends on:` edge pointing at the removed step.
- **Never silently change an issue link.** If a step is split, surface the original issue; new steps get new issues (offer to create them — see step 5).
- **Splitting a step**: copy the original content into both new steps as a starting point, edit each, then delete the original clean.
- **Moving a step between phases**: keep the same `STEP-NN` ID; do **not** renumber.
- **Dependency edges must stay valid.** Walk every step's `Depends on:` line and update links to reflect supersession or moves.
- **Status markers** on existing steps are preserved as-is — do not change them. Use [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) to re-sync status after structural edits.

### 4. Record significant decisions as ADRs

For any change where a future implementer would ask *why* (a superseded step, a phase re-sequencing driven by misjudged dependencies, an incorporation of a new specifications doc), write an ADR using the shared [ADR template](../common/references/adr-template.md) into `docs/Decisions/`. Trivial edits need no ADR — git records them. The roadmap itself never carries change history.

### 5. Offer to create issues for new steps

For every new step added in this revision, ask:

> "Create GitHub issues for the new steps?
> - STEP-15 → workinprogress-ai/service.commerce.inventory
> - STEP-16 → workinprogress-ai/service.commerce.fulfillment-orchestrator
>
> Proceed? (Y / N / Choose subset)" — ask via the shared [direct query style](../_conventions.md#direct-query-style-questions-and-selections): present *yes, create all / choose a subset / no* as selectable options with freeform input.

If yes, follow the same `GITHUB_REPO=<org>/<repo> issue-create` procedure documented in [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) Step A. Update the parent epic in the planning repo to add the new issues to its task list.

For deleted steps with linked issues, do **not** auto-close them — surface a list and let the user decide:

> "These deleted steps still have open linked issues. Close them? Comment first?
> - STEP-07 → #412 (superseded by STEP-15, STEP-16)
> - STEP-12 → #418 (withdrawn)"

### 6. Write the result

Republish the scratch copy to the same artifact: `issue-artifact-upsert --issue <epic-number> --body-file <scratch-path>`. The user can review via the issue's comment edit history and re-edit if needed.

### 7. Surface downstream impacts

After writing, list what may need follow-up:

- **Status sync**: structural edits don't refresh issue/PR status → suggest [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md)
- **Plan impact**: plans tied to superseded or split steps may need updating → suggest [`/devenv-refine-plan`](../devenv-refine-plan/SKILL.md) for affected plans
- **Blueprint drift**: if the structural change reveals a deeper architectural issue, file an **upstream-impact issue** (`issue-create --type Task --label upstream-impact --no-template` in the planning repo — `GITHUB_REPO` is already set) describing what changed, why it matters, and the affected blueprint sections — then also suggest [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) directly if the user wants to cascade now

## Anti-patterns

- Keeping superseded steps as strikethrough or tombstone text — delete them clean; an ADR holds the why when it matters
- Reflowing `STEP-NN` or `PHASE-NN` IDs (breaks links from issues, plans, and the parent epic)
- Closing linked issues automatically when superseding a step — always ask
- Changing status markers as part of structural revision — use `/devenv-update-roadmap` for that
- Rewriting the roadmap from scratch — that's [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md), not refine
- Forgetting to update the parent epic's task list when issues are added or superseded
- Writing prior-state narrative in phase/step body content — the document is target state; ADRs and the issue's edit history hold the rest
- Committing the scratch copy to source control — roadmaps are GitHub artifacts only
- Treating the roadmap as an entry point for upstream changes — route those through the refine skills and the upstream-impact queue

## Sibling Skills

- [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) — to create a new roadmap from scratch
- [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) — to sync step status from issues/PRs after structural edits
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — when the underlying architecture needs changing too
- [`/devenv-refine-specifications`](../devenv-refine-specifications/SKILL.md) — when stakeholder priorities or specifications changed
- [`/devenv-refine-plan`](../devenv-refine-plan/SKILL.md) — for plans tied to affected steps

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
