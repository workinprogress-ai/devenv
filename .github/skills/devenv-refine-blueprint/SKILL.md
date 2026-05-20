---
name: devenv-refine-blueprint
description: 'Revise an existing Blueprint-*.md after architecture decisions change, new requirements arrive, or implementation discovery exposes gaps. USE WHEN the user says "refine the blueprint", "update the blueprint", "revise the architecture", "the blueprint needs updating", or hands off a stale blueprint that needs adjustments. Preserves all existing structure and decisions, appends new content rather than reflowing, records every change in a Revision History section, and writes the result back in place. DO NOT USE for creating a new blueprint (use /devenv-create-blueprint), for ad-hoc edits to a single line (just edit the file), or for updating a roadmap (use /devenv-update-roadmap).'
argument-hint: 'Path to a Blueprint-*.md file'
user-invocable: true
---

# Refine Blueprint

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

Revise an existing blueprint based on new information — architectural decisions that changed, requirements that arrived after the original blueprint, or implementation discovery that exposed gaps. Preserve every prior decision; never silently rewrite history.

## When to Use

- The user has a `Blueprint-*.md` that needs new components, revised deltas, new operations/events, or scope adjustments
- A previous `/devenv-create-blueprint` run is now out of date
- Implementation work surfaced architectural facts the blueprint didn't anticipate

If no blueprint exists, stop and redirect to [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md).

## Inputs

The user provides a file path — e.g. `docs/Architecture/Blueprint-orders-001.md`.

## Workflow

### 1. Load and parse

- Read the file. Identify all top-level numbered sections (`## 1. Context`, `## 3. Architecture`, etc.).
- Note the existing Revision History entries.
- Note services already listed (with their `(existing | new | extended)` status) and per-component delta entries.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — components, operations, events, patterns to add
- **What's wrong** — sections whose descriptions are now misleading
- **What changed status** — services moving from `new` → `existing`, deltas now obsolete because the change shipped
- **What's no longer relevant** — sections to mark as superseded (do NOT delete)
- **New requirements docs** — "In a multi-epic project, has a new `Requirements-<epic>-NNN.md` been added that this blueprint should now cover? Or has an existing one been split or refined?"
- **Source material** — "Are there meeting transcripts, email threads, design discussions, or other communications records behind these changes? If so, where are they?"

If the user provides communications artifacts, summarise each one separately (prefer the `Explore` subagent, one invocation per artifact, in parallel where possible) with a prompt focused on architectural decisions, components/services mentioned, trade-offs raised, and open questions. Surface each summary back for confirmation, then use the approved summaries to drive the change list. Note the source in the revision-history entry (step 4) so the rationale can be re-traced.

If the user points at a new (or refined) requirements doc, read it and summarise back the actors/scenarios/constraints/new requirements that this blueprint should now reflect. Cross-doc dependency edges from the requirements (`Depends on: AUTH-003 (Requirements-auth-001.md)`) may translate into new cross-service dependencies — surface these explicitly. If a separate sibling blueprint covers the upstream epic, reference it (`<see Blueprint-auth-001.md §3.2>`) rather than duplicating its content here.

Do not assume. If the change has roadmap impact (component added/removed, ordering implication), surface it explicitly:

> "This change adds a new component. The roadmap (`Roadmap-<system>-NNN.md`) likely needs an update too. Want me to flag this for `/devenv-update-roadmap`?"

## Splitting an oversized blueprint

If the single-file blueprint has grown past comfortable reading length (~1,500 lines, or §4 has more components than anyone can hold in their head), the user may ask to split it. Treat splitting as a special refinement:

1. **Interview**: confirm the split boundary. Common patterns (offer these; let the user pick or override):
   - **By section group** (default): `01-context.md`, `02-architecture.md`, `03-components.md`, `04-risks.md`
   - **By domain within §3-§4** when there are several
   - A hybrid when only one section is oversized
2. **Create the subfolder** `docs/Architecture/Blueprint-<system>-NNN/` and move the part files into it. The original `Blueprint-<system>-NNN.md` is replaced by this folder — leave a stub file at the old path containing only a redirect (`> **Moved to [Blueprint-<system>-NNN/Index.md](Blueprint-<system>-NNN/Index.md) in revision YYYY-MM-DD**`) so existing links don't 404.
3. **Preserve section numbering across files.** §3.2.5 stays §3.2.5 wherever it lives. Cross-file references use the form `<see 02-architecture.md §3.2.5>`.
4. **Each part file gets its own `## Revision History`** scoped to that file's content. The shared root revision history moves to `Index.md`.
5. **Create `Index.md`** in the new subfolder with the structure documented in [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) §*Index.md for multi-file artifacts*. Record the split as the first entry in its revision history.
6. **Walk cross-blueprint references** and roadmap step `Blueprint sections:` lines to update them to the new file paths.
7. Surface roadmap impact — the roadmap's `Blueprint sections:` references on each STEP-NN are now stale; suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) to refresh them.

## Updating Index.md on plain refinements

If the blueprint is already split (subfolder + `Index.md` exists) and a refinement adds, removes, or moves sections between files, **update `Index.md` in the same revision** so its section map and file table stay accurate. Add a one-line entry to the Index's revision history pointing back to the part file that changed.

### 3. Confirm the change plan

**STOP.** Before touching the file, present a concise change plan and ask for confirmation:

> "Here's what I plan to change:
>
> - **Add** §X.Y: `service.foo` (new component)
> - **Reword** §3.2.1: updating the inventory delta to reflect TTL behaviour; prior wording will be preserved beneath
> - **Supersede** §5.2 risk #3 (resolved by the reservation-cleaner)
> - **Append** `ReservationExpired` event row to §3.4 table
>
> Anything I've misread, over-scoped, or missed?"

Do not write anything until the user confirms. If the user adjusts scope, revise the plan and confirm again.

---

### 4. Apply changes — preserve everything

**Hard rules:**

- **Never reflow numbering.** Section `3.2.5` stays `3.2.5` for its lifetime. Append new entries with the next sequential number.
- **Never silently delete a decision.** Superseded content is wrapped in a blockquote with a note pointing to the new section:

  ```markdown
  > **Superseded by §3.2.7 in revision 2026-05-13**
  >
  > <original content>
  ```
- **New components are appended** to the end of `## 4. Per-Component Changes` with the next sub-number.
- **Reworded sections** keep their number; the prior wording goes into a quoted "Previously" block beneath the new wording.

### 5. Record the revision

Add a new entry to the top of `## Revision History`:

```markdown
### 2026-05-13 — Added inventory reservation TTL

- Added §3.2.7: `service.commerce.reservation-cleaner` (new)
- Added §3.4 row: `ReservationExpired` event
- Reworded §4.1 to reflect TTL behaviour; previous wording preserved beneath
- Superseded §5.2 risk #3 (mitigated by reservation-cleaner)
```

Most recent revision goes on top.

### 6. Write the result

Overwrite the file in place. The user can `git diff` to review and revert.

### 7. Surface downstream impacts

After writing, list what may need follow-up:

- **Roadmap impact**: new components or removed deltas → structural roadmap changes → suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md). For step-status drift only (issues closed, PRs merged), suggest [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) instead.
- **Requirements impact**: if architectural changes were driven by a requirements gap, suggest [`/devenv-refine-requirements`](../devenv-refine-requirements/SKILL.md)
- **Implementation plan impact**: existing plans may now reference superseded sections → suggest [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) for affected plans
- **Unsettled approach** that triggered this refine: if a specific design question is still open, suggest [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) to weigh options before further refinement

## Anti-patterns

- Silently overwriting decisions
- Reflowing numbers (breaks links from roadmaps and plans)
- Deleting per-component delta entries when the change shipped — mark them `(shipped)` instead
- Rewriting the blueprint from scratch — that's [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md), not refine
- Forgetting to surface roadmap and plan impact after the edit
