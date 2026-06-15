---
name: devenv-refine-requirements
description: 'Revise an existing Requirements-*.md after stakeholder priorities shift, new actors or scenarios surface, a spike invalidates an assumption, or implementation discovery exposes gaps. USE WHEN the user says "refine the requirements", "update the requirements", "revise the requirements doc", "the requirements need updating", or hands off a stale requirements doc that needs adjustments. Preserves all existing REQ-NNN IDs and dependency links, appends new requirements rather than reflowing, removes superseded requirements and logs each deletion in Revision History, and records every change in a Revision History section. DO NOT USE for creating a new requirements doc (use /devenv-gather-requirements), for ad-hoc one-line edits (just edit the file), or for revising the architectural blueprint (use /devenv-refine-blueprint).'
argument-hint: 'Path to a Requirements-*.md file'
user-invocable: true
---

# Refine Requirements

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

Revise an existing requirements document based on new information — stakeholder priorities that shifted, new actors or scenarios that surfaced, a spike that invalidated an assumption, or implementation discovery that exposed gaps. Preserve every prior decision and ID; never silently rewrite history.

Write requirements body sections as the current target behaviour and constraints. Keep historical change narrative out of requirement bodies and record it in `## Revision History`.

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

1. Interview: confirm split boundary, new `<topic>` names, new prefix per doc.
2. Create new docs by copying source, then mark non-belonging requirements as `> **Moved to Requirements-<other-topic>-001.md in revision YYYY-MM-DD**` and re-prefix requirements that stay (e.g. `REQ-007` → `ORD-007`).
3. Update source doc: every moved requirement becomes a `> **Moved to ...**` block with the new ID.
4. Walk all cross-doc `Depends on:` lines and update to new IDs and doc paths.
5. Record the split in every affected doc's revision history. Update session memory for each new doc.
6. Create or update `Index.md`. See [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md) §*Index.md for multi-file artifacts*.
7. If a roadmap exists, suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) for stale STEP-NN → REQ-NNN backreferences.

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
- **What's no longer relevant** — sections to remove; deletion will be logged in Revision History with the ID, a one-line summary, and the reason
- **What changed priority** — requirements moving between `GROUP-NN`s, or the MVP definition shifting
- **Open questions** — "Are there open questions from the original gathering session that were deferred and can now be resolved? Are there new ambiguities or tensions this refinement introduces?"
- **Source material** — "Are there meeting transcripts, email threads, recordings, voice memos, or other communications records behind these changes? If so, where are they?"

If the user provides communications artifacts, summarise each one separately (prefer the `Explore` subagent, one invocation per artifact, in parallel where possible) with a prompt focused on stated goals, decisions reached, named actors, constraints mentioned, and concrete behaviours described. Surface each summary back for confirmation, then use the approved summaries to drive the change list. Note the source in the revision-history entry (step 4) so the rationale can be re-traced.

### 3. Apply changes — preserve everything

**Hard rules:**

- **Never reflow IDs.** `REQ-007` stays `REQ-007` for its lifetime. New requirements get the next sequential number per category prefix (e.g. `AUTH-008`, `ORD-014`).
- **Never silently delete a requirement.** Record removals in `## Revision History` with ID, summary, and reason. Update every `Dependencies:` reference pointing at the removed ID.
- **Never silently rewrite acceptance criteria.** Updated criteria keep the requirement's ID; record the prior wording summary in `## Revision History` instead of embedding prior-state narrative in the requirement body.
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

For each finding, surface a labelled `CONFLICT: REQ-X vs REQ-Y` block naming the tension. For each, offer: resolve inline, add to open questions, or accept as documented trade-off. **Do not write the file while known contradictions remain unresolved.**

### 4b. Episode staleness check

If an `Episodes-<topic>-NNN.md` companion file exists, check whether any changed requirements are illustrated in it:

1. Read the episodes file.
2. For each requirement that was added, reworded, or superseded in this refinement, check whether it appears in any episode's "Requirements illustrated" footer or inline links.
3. Mark stale episodes with a notice at the top of that episode:

   ```markdown
   > ⚠️ **Stale** — requirements illustrated by this episode have changed since it was written. Review before relying on it. Affected: [REQ-014](#req-014), [REQ-019](#req-019)
   ```

4. Surface the stale episodes to the user:

   > *"Episodes 2 and 4 illustrate requirements that changed in this refinement ([REQ-014](#req-014), [REQ-019](#req-019)). I've marked them stale. Would you like me to update them now, or batch that for a later session?"*

**Rewriting episodes is deliberate, not automatic.** Batch updates until requirements are stable. When rewriting: keep character names, places, and tone — only change what is now factually wrong.

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
### 8. Offer a stability audit

If the user signals the requirements are approaching final form (incremental refinements, statements like "I think we're almost done", or a series of sessions producing diminishing structural changes), offer a stability audit:

> *"This refinement looks incremental — we might be approaching a stable doc. Would you like to run a stability audit? It's a top-to-bottom scan, typically 1–4 rounds, that ends with an explicit stability declaration. Worth doing before this feeds into planning or implementation."*

See the stability audit protocol in [`/devenv-gather-requirements` § Stability Audit](../devenv-gather-requirements/SKILL.md#stability-audit-final-convergence-review).
## Anti-patterns

- Silently overwriting acceptance criteria
- Reflowing IDs (breaks links from blueprints, roadmaps, plans, and issues)
- Removing a requirement without logging its ID, prior-wording summary, and reason in Revision History
- Rewriting the requirements doc from scratch — that's [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md), not refine
- Writing prior-state narrative in requirement bodies instead of `## Revision History`
- **Skipping the internal consistency review.** Refinements routinely introduce new tensions between new and old requirements — always check.
- **Writing the file while known contradictions remain unresolved.** Every conflict finding must be resolved, accepted as a documented trade-off, or explicitly logged before writing.
- Treating Phase 3 priority groups as a delivery roadmap (delivery sequencing belongs in [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md))
- Forgetting to surface blueprint, roadmap, and plan impact after the edit
- **Silently ignoring stale episodes** when requirements change — always check for a companion episodes file and mark stale episodes.
- **Rewriting episodes mid-stream** before the requirements are stable — batch episode updates to the end of a refinement cycle.

## Sibling Skills

- [`/devenv-gather-requirements`](../devenv-gather-requirements/SKILL.md) — to create a new requirements doc from scratch
- [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) — to create a roadmap (and GitHub issues) from the refined requirements; supports a requirements-only mode when no blueprint exists
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — when changes have architectural implications
- [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) — when changes affect delivery sequencing of an existing roadmap
- [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) — when changes affect an in-flight implementation plan

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
