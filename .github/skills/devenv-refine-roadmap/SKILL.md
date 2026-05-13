---
name: devenv-refine-roadmap
description: 'Revise an existing Roadmap-*.md after the underlying blueprint changes, a step gets split or merged, a new component lands, or phases need re-sequencing. USE WHEN the user says "refine the roadmap", "revise the roadmap", "the roadmap structure needs updating", "split this step", "re-sequence the phases", or hands off a roadmap whose structure (not just status) needs changes. Preserves all existing STEP-NN IDs and issue links, appends new steps rather than reflowing, supersedes obsolete steps in place, and records every change in a Revision History section. DO NOT USE for syncing step status from issues/PRs (use /devenv-update-roadmap), for creating a new roadmap (use /devenv-create-roadmap), or for revising the underlying blueprint (use /devenv-refine-blueprint).'
argument-hint: 'Path to a Roadmap-*.md file'
user-invocable: true
---

# Refine Roadmap

Revise the **structure** of an existing roadmap based on new information — the blueprint changed, a step needs splitting, a new component landed, or phases need re-sequencing. Preserve every prior step ID and issue link; never silently rewrite history.

This is the structural counterpart to [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md), which only syncs status from issues/PRs.

## When to Use

- The user has a `Roadmap-*.md` whose **structure** needs changes — new steps, split steps, re-sequenced phases, dropped steps
- A previous [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) added or removed a component
- Implementation discovery showed a step was bigger than expected and needs to be split
- A phase needs reordering because dependencies were misjudged

If only step **status** is out of date (issues closed, PRs merged), use [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) instead. If no roadmap exists, redirect to [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md).

## Inputs

The user provides a file path — e.g. `docs/Roadmap/Roadmap-orders-001.md`.

## Workflow

### 1. Load and parse

- Read the file. Identify all phases (`### PHASE-NN: ...`) and steps (`### STEP-NN: ...`).
- Note the existing Revision History entries.
- Note every step's existing **Issue** link, **Component**, **Blueprint section** references, and **Depends on** edges.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — steps, phases, or components to add (often driven by blueprint changes, or by a new requirements doc landing in a multi-epic project)
- **What needs splitting** — steps that grew too large during implementation
- **What's wrong** — dependency edges that turned out to be inaccurate, phase boundaries that no longer make sense
- **What's obsolete** — steps that are no longer needed (mark superseded, do NOT delete)
- **What needs re-sequencing** — steps moving between phases for dependency or priority reasons
- **New requirements docs** — "Has a new `Requirements-<epic>-NNN.md` been added to the project that this roadmap should now cover?"
- **Source material** — "Are there meeting transcripts, design discussions, or other communications records behind these changes? If so, where are they?"

If the user provides communications artifacts, summarise each one separately (prefer the `Explore` subagent, one invocation per artifact, in parallel where possible) with a prompt focused on architectural decisions, component changes, sequencing decisions, and trade-offs raised. Surface each summary back for confirmation, then drive the change list from the approved summaries. Note the source in the revision-history entry (step 4).

### 2a. Incorporating a new requirements doc

When a multi-epic project grows a new `Requirements-<epic>-NNN.md` after the roadmap was first built:

1. Read the new doc; extract every requirement and its `Dependencies:` (including cross-doc edges back into the existing requirements).
2. Draft a new candidate step per new requirement, asking the user for the target component (same procedure as `/devenv-create-roadmap` requirements-only mode).
3. **Append** the new steps with the next sequential `STEP-NN` IDs across the whole roadmap — do **not** renumber existing steps. Place each in the appropriate `PHASE-NN`, creating new phases at the end if the new epic deserves its own phases.
4. Resolve cross-doc dependency edges into step-level `Depends on:` edges.
5. Record the incorporation as a single revision-history entry citing the new doc path.
6. In step 5, offer to create issues for the new steps and update the parent epic's task list.

### 3. Apply changes — preserve everything

**Hard rules:**

- **Never reflow IDs.** `STEP-07` stays `STEP-07` for its lifetime. New steps get the next sequential number across the whole roadmap (not per-phase — step IDs are globally unique). Same for `PHASE-NN`.
- **Never silently delete a step.** Superseded steps are wrapped in a blockquote with a note pointing to the replacement(s):

  ```markdown
  > **Superseded by STEP-15 and STEP-16 in revision 2026-05-13** — split because reservation API and TTL cleanup are now separate components.
  >
  > <original step content>
  ```

  Or, if the step is dropped without replacement:

  ```markdown
  > **Withdrawn in revision 2026-05-13** — <one-line reason>. Linked issue: <still-open issue link>, will be closed manually.
  >
  > <original step content>
  ```
- **Never silently change an issue link.** If a step is split, the original issue remains linked from the superseded block; new steps get new issues (offer to create them — see step 5).
- **Splitting a step**: copy the original content into both new steps as a starting point, edit each, then preserve the original under a "Superseded by" block as above.
- **Moving a step between phases**: keep the same `STEP-NN` ID; record the move in revision history. Do **not** renumber.
- **Dependency edges must stay valid.** Walk every step's `Depends on:` line and update links to reflect supersession or moves.
- **Status markers** (\u2705 / \U0001f7e1 / \u2b1c / \u23f8 / \u274c) on existing steps are preserved as-is — do not change them. Use [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) to re-sync status after structural edits.

### 4. Record the revision

Add a new entry to the top of `## Revision History` (create the section if missing, immediately after the document title):

```markdown
### 2026-05-13 — Split inventory work; added orchestrator step

- Added STEP-15: Build reservation TTL cleanup
- Added STEP-16: Wire orchestrator to reservation events
- Superseded STEP-07 (split into STEP-15 + STEP-16)
- Moved STEP-09 from PHASE-02 to PHASE-03 (depends on orchestrator now)
- Withdrew STEP-12 (no longer needed after blueprint refinement)
- Source: Blueprint-orders-001.md revision 2026-05-12
```

Most recent revision goes on top.

### 5. Offer to create issues for new steps

For every new step added in this revision, ask:

> "Create GitHub issues for the new steps?
> - STEP-15 \u2192 workinprogress-ai/service.commerce.inventory
> - STEP-16 \u2192 workinprogress-ai/service.commerce.fulfillment-orchestrator
>
> Proceed? (Y / N / Choose subset)"

If yes, follow the same `GITHUB_REPO=<org>/<repo> issue-create` procedure documented in [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) Step A. Update the parent epic in the planning repo to add the new issues to its task list.

For superseded or withdrawn steps with linked issues, do **not** auto-close them — surface a list and let the user decide:

> "These superseded/withdrawn steps still have open linked issues. Close them? Comment first?
> - STEP-07 \u2192 #412 (superseded by STEP-15, STEP-16)
> - STEP-12 \u2192 #418 (withdrawn)"

### 6. Write the result

Overwrite the file in place. The user can `git diff` to review and revert.

### 7. Surface downstream impacts

After writing, list what may need follow-up:

- **Status sync**: structural edits don't refresh issue/PR status \u2192 suggest [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md)
- **Implementation plan impact**: plans tied to superseded or split steps may need updating \u2192 suggest [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) for affected plans
- **Blueprint drift**: if the structural change reveals a deeper architectural issue, suggest [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)

## Anti-patterns

- Silently deleting steps instead of marking them superseded or withdrawn
- Reflowing `STEP-NN` or `PHASE-NN` IDs (breaks links from issues, plans, and the parent epic)
- Closing linked issues automatically when superseding a step — always ask
- Changing status markers as part of structural revision — use `/devenv-update-roadmap` for that
- Rewriting the roadmap from scratch — that's [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md), not refine
- Forgetting to update the parent epic's task list when issues are added or superseded

## Sibling Skills

- [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) — to create a new roadmap from scratch
- [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) — to sync step status from issues/PRs after structural edits
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — when the underlying architecture needs changing too
- [`/devenv-refine-requirements`](../devenv-refine-requirements/SKILL.md) — when stakeholder priorities or requirements changed
- [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) — for plans tied to affected steps

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
