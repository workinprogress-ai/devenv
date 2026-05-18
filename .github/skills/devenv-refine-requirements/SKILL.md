---
name: devenv-refine-requirements
description: 'Revise an existing Requirements-*.md after stakeholder priorities shift, new actors or scenarios surface, a spike invalidates an assumption, or implementation discovery exposes gaps. USE WHEN the user says "refine the requirements", "update the requirements", "revise the requirements doc", "the requirements need updating", or hands off a stale requirements doc that needs adjustments. Preserves all existing REQ-NNN IDs and dependency links, appends new requirements rather than reflowing, supersedes obsolete ones in place, and records every change in a Revision History section. DO NOT USE for creating a new requirements doc (use /devenv-gather-requirements), for ad-hoc one-line edits (just edit the file), or for revising the architectural blueprint (use /devenv-refine-blueprint).'
argument-hint: 'Path to a Requirements-*.md file'
user-invocable: true
---

# Refine Requirements

Revise an existing requirements document based on new information — stakeholder priorities that shifted, new actors or scenarios that surfaced, a spike that invalidated an assumption, or implementation discovery that exposed gaps. Preserve every prior decision and ID; never silently rewrite history.

## When to Use

- The user has a `Requirements-*.md` that needs new requirements, revised acceptance criteria, new actors/scenarios, scope adjustments, or re-grouped priorities
- A previous `/devenv-gather-requirements` run is now out of date
- A spike, blueprint, or implementation discovery surfaced requirements facts the doc didn't anticipate
- New human communications (transcripts, emails, meeting notes) arrived after the original interview

If no requirements doc exists, stop and redirect to [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md).

## Inputs

The user provides a file path — e.g. `docs/Requirements/Requirements-orders-001.md`.

For multi-document projects (one doc per epic), refine **one doc per invocation**. If a change spans multiple epics, the user should run this skill once per affected doc, in any order — cross-doc dependency edges are updated by the doc that declared them.

## Splitting an oversized requirements doc

If the doc has grown past ~30 requirements or now covers what feels like multiple epics, the user may ask to split it. Treat splitting as a special refinement:

1. **Interview**: confirm the split boundary (which requirements move to which new doc), the new `<topic>` names, and the new prefix per resulting doc.
2. **Create the new doc(s)** by copying the full source doc to each new path, then in each new doc:
   - Mark the requirements that don't belong to that doc as `> **Moved to Requirements-<other-topic>-001.md in revision YYYY-MM-DD**` (preserving the original content beneath, same as supersession).
   - **Re-prefix the requirements that stay** to the new prefix — e.g. `REQ-007` becomes `ORD-007`. Record the rename mapping in the revision history of the new doc.
3. **Update the source doc** in place: every moved requirement becomes a `> **Moved to ...**` block, with the *new* ID in the move note so cross-references remain traceable.
4. **Walk every cross-doc dependency edge** (in all related docs in the workspace) and update `Depends on:` lines to use the new IDs and new doc paths.
5. Record the split in **every affected doc's** revision history. Note the split in `session_memory-requirements-<topic>.md` for each new doc.
6. **Create or update `Index.md`** in the requirements folder — the multi-doc project now needs a navigation index. See [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md) §*Index.md for multi-file artifacts* for the structure. Record the split as a revision-history entry on the Index.
7. Surface roadmap impact — if a roadmap already exists, suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) to incorporate the new doc structure (its STEP-NN → REQ-NNN backreferences will be stale).

## Updating Index.md on plain refinements

If the project already has an `Index.md` (multi-doc project) and a refinement adds, removes, or supersedes a cross-doc dependency edge, **update `Index.md` in the same revision** so its cross-doc dependency section stays accurate. Add a one-line entry to the Index's revision history pointing back to the doc that changed.

## Workflow

### 1. Load and parse

- Read the file. Identify all top-level numbered sections (`## 1. Vision`, `## 2. Requirements`, `## 3. Priority Groups`, etc.).
- Note the existing Revision History entries.
- Note all `REQ-NNN` IDs (with their category prefix scheme), the dependency edges between them, and the existing `GROUP-NN` priority assignments.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — actors, scenarios, requirements, constraints, scope items to add
- **What's wrong** — sections whose descriptions or acceptance criteria are now misleading
- **What's no longer relevant** — sections to mark as superseded (do NOT delete)
- **What changed priority** — requirements moving between `GROUP-NN`s, or the MVP definition shifting
- **Open questions** — "Are there open questions from the original gathering session that were deferred and can now be resolved? Are there new ambiguities or tensions this refinement introduces?"
- **Source material** — "Are there meeting transcripts, email threads, recordings, voice memos, or other communications records behind these changes? If so, where are they?"

If the user provides communications artifacts, summarise each one separately (prefer the `Explore` subagent, one invocation per artifact, in parallel where possible) with a prompt focused on stated goals, decisions reached, named actors, constraints mentioned, and concrete behaviours described. Surface each summary back for confirmation, then use the approved summaries to drive the change list. Note the source in the revision-history entry (step 4) so the rationale can be re-traced.

### 3. Apply changes — preserve everything

**Hard rules:**

- **Never reflow IDs.** `REQ-007` stays `REQ-007` for its lifetime. New requirements get the next sequential number per category prefix (e.g. `AUTH-008`, `ORD-014`).
- **Never silently delete a requirement.** Superseded content is wrapped in a blockquote with a note pointing to the new content:

  ```markdown
  > **Superseded by REQ-014 in revision 2026-05-13**
  >
  > <original content>
  ```

  Or, if the requirement is dropped without replacement:

  ```markdown
  > **Withdrawn in revision 2026-05-13** — <one-line reason>
  >
  > <original content>
  ```
- **Never silently rewrite acceptance criteria.** Updated criteria keep the requirement's ID; the prior wording goes into a quoted "Previously" block beneath the new wording.
- **Dependency links must stay valid.** If a requirement is superseded, walk every other requirement's `Dependencies:` line and update the link to point at the replacement (or remove the link with a note).
- **Priority groupings can be re-ordered freely** — they are stakeholder priority, not delivery sequencing. New requirements need to be placed into a group. Moving a requirement between groups is allowed; record the move in revision history.
### 4. Internal consistency review

After applying all changes, scan the full updated requirement set for internal consistency. This step is especially important because refinements often introduce new tensions between new and existing requirements that weren't present in the original document.

Check for:

- **New contradictions introduced** — does any new or reworded requirement conflict with an existing one?
- **Acceptance criteria conflicts** — two requirements' Given/When/Then clauses producing incompatible outcomes for the same actor/scenario.
- **Dependency integrity gaps** — a new requirement depends on an existing one, but the existing requirement's acceptance criteria don't satisfy what the new one needs.
- **Scope boundary violations** — new requirements that cross the in-scope/out-of-scope boundary.
- **Supersession gaps** — a requirement was superseded but another requirement still depends on it without acknowledging the change.
- **Ambiguous shared terms** — a new term introduced that is already used elsewhere with a different meaning.

For each finding, produce a labelled block:

```
CONFLICT: REQ-004 vs REQ-019 (new)
REQ-004: users may delete their account at any time.
REQ-019 (new): audit log must record the actor for every state change indefinitely.
Tension: hard-delete removes the actor reference needed by REQ-019.
```

For each finding offer: resolve inline (user clarifies, AI updates requirements), add to the revision's open questions, or accept as a documented trade-off. **Do not write the file while known contradictions remain unresolved.**
### 4. Record the revision

Add a new entry to the top of `## Revision History` (create the section if missing, immediately after the document title):

```markdown
### 2026-05-13 — Added refund flow

- Added §2.3 REQ-014: Customer-initiated refund
- Reworded REQ-007 acceptance criteria to cover partial refunds; previous wording preserved beneath
- Superseded REQ-009 (subsumed by REQ-014)
- Moved REQ-011 from GROUP-02 to GROUP-01 (now MVP per 2026-05-12 stakeholder review)
- Source: 2026-05-12 stakeholder review transcript
```

Most recent revision goes on top.

### 6. Write the result

Overwrite the file in place. The user can `git diff` to review and revert.

### 7. Surface downstream impacts

After writing, list what may need follow-up:

- **Blueprint impact**: a new requirement may require new components or revised deltas \u2192 suggest [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)
- **Roadmap impact**: a new requirement, or a moved priority group, may require new or re-sequenced roadmap steps \u2192 suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md)
- **Implementation plan impact**: existing plans may now reference superseded requirements \u2192 suggest [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) for affected plans

## Anti-patterns

- Silently overwriting acceptance criteria
- Reflowing IDs (breaks links from blueprints, roadmaps, plans, and issues)
- Deleting requirements outright instead of marking them superseded or withdrawn
- Rewriting the requirements doc from scratch — that's [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md), not refine
- **Skipping the internal consistency review.** Refinements routinely introduce new tensions between new and old requirements — always check.
- **Writing the file while known contradictions remain unresolved.** Every conflict finding must be resolved, accepted as a documented trade-off, or explicitly logged before writing.
- Treating Phase 3 priority groups as a delivery roadmap (delivery sequencing belongs in [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md))
- Forgetting to surface blueprint, roadmap, and plan impact after the edit

## Sibling Skills

- [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md) — to create a new requirements doc from scratch
- [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) — to create a roadmap (and GitHub issues) from the refined requirements; supports a requirements-only mode when no blueprint exists
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — when changes have architectural implications
- [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) — when changes affect delivery sequencing of an existing roadmap
- [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) — when changes affect an in-flight implementation plan

See the [Skills catalog](../../docs/Skills.md) for the full list and decision tree.
