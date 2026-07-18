---
name: devenv-refine-blueprint
description: 'Revise an existing Blueprint-*.md after architecture decisions change, new requirements arrive, or implementation discovery exposes gaps. USE WHEN the user says "refine the blueprint", "update the blueprint", "revise the architecture", "the blueprint needs updating", or hands off a stale blueprint that needs adjustments. Preserves all existing structure and decisions, appends new content rather than reflowing, records every change in a Revision History section, and writes the result back in place. If refinement intake reveals a non-surgical change (broad re-architecture, unresolved option-weighing, or major uncertain ripple effects), stop and route to /devenv-design-discussion (bounded choice) or /devenv-create-blueprint (foundational redesign). DO NOT USE for creating a new blueprint (use /devenv-create-blueprint), for broad architecture brainstorming without a settled direction (use /devenv-design-discussion), for ad-hoc edits to a single line (just edit the file), or for updating a roadmap (use /devenv-update-roadmap).'
argument-hint: 'Path to a Blueprint-*.md file'
user-invocable: true
---

# Refine Blueprint

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

Revise an existing blueprint based on new information — architectural decisions that changed, requirements that arrived after the original blueprint, or implementation discovery that exposed gaps. Preserve every prior decision; never silently rewrite history.

Write the blueprint body as the current target architecture. Keep historical change narrative out of main sections and record it in `## Revision History` only.

## When to Use

- The user has a `Blueprint-*.md` that needs new components, revised deltas, new operations/events, or scope adjustments
- A previous `/devenv-create-blueprint` run is now out of date
- Implementation work surfaced architectural facts the blueprint didn't anticipate

Use this skill when the user already knows the intended architecture change direction and wants that change applied safely.

If the user is still deciding between architecture options, route to [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md). If the foundational architecture itself is being re-derived, route to [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) and treat the existing blueprint as input context.

If no blueprint exists, stop and redirect to [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md).

## Inputs

The user provides a file path — e.g. `docs/Architecture/Blueprint-orders-001.md`.

## Workflow

### 0. Surgical-vs-non-surgical triage

Before interviewing for edits, classify the requested change.

Treat as **non-surgical** when any of these is true:

- The user signals broad rethink language: "re-architect", "start over", "redesign this whole area", "let's rethink the architecture"
- The requested change spans many sections with unclear final direction
- Multiple architecture options are still unresolved and require trade-off discussion before edits are known
- Ripple effects across domains/components/integration events are likely large and uncertain

If non-surgical:

1. Stop direct edit flow.
2. Explain why: this is discovery/decision work, not direct refinement.
3. Route based on scope:
  - **Bounded option-weighing** for a specific design choice → [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md)
  - **Foundational redesign** across the blueprint → [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
4. Offer one explicit confirmation gate: continue anyway with direct edits, or switch now.

If surgical, continue with the workflow below.

### 1. Load and parse

- Read the file. Identify all top-level numbered sections (`## 1. Context`, `## 3. Architecture`, etc.).
- Note the existing Revision History entries.
- Note services already listed (with their `(existing | new | extended)` status) and per-component delta entries.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — components, operations, events, patterns to add
- **What's wrong** — sections whose descriptions are now misleading
- **What changed status** — services moving from `new` → `existing`, deltas now obsolete because the change shipped
- **What's no longer relevant** — sections to remove; deletion will be logged in Revision History with a note pointing to the replacement (or reason for withdrawal)
- **Revision history** — record only material blueprint changes; batch small related edits from the same pass into one concise entry.
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
> - **Reword** §3.2.1: updating the inventory delta to reflect TTL behaviour
> - **Supersede** §5.2 risk #3 (resolved by the reservation-cleaner)
> - **Append** `ReservationExpired` event row to §3.4 table
>
> Anything I've misread, over-scoped, or missed?"

Do not write anything until the user confirms. If the user adjusts scope, revise the plan and confirm again.

---

### 4. Apply changes — preserve everything

**Hard rules:**

- **Never reflow numbering.** Section `3.2.5` stays `3.2.5` for its lifetime. Append new entries with the next sequential number.
- **Never silently delete a decision.** When a section is superseded or withdrawn, delete it from the document and record the removal in `## Revision History`:

  ```
  - Removed §5.2 risk #3 (TTL race condition) — superseded by §3.2.7 (reservation-cleaner mitigates this)
  - Removed §4.3 component `service.old-notifier` — withdrawn, replaced by event-driven approach in §4.7
  ```
- **New components are appended** to the end of `## 4. Per-Component Changes` with the next sub-number.
- **Reworded sections** keep their number; record the prior wording summary in `## Revision History` rather than embedding prior-state narrative in the section body.

### 5. Record the revision

Add a new entry to the top of `## Revision History`. Keep it concise and material-only:

```markdown
### 2026-05-13 — Added inventory reservation TTL

- Added §3.2.7: `service.commerce.reservation-cleaner` (new)
- Added §3.4 row: `ReservationExpired` event
- Reworded §4.1 to reflect TTL behaviour; previous wording preserved beneath
- Superseded §5.2 risk #3 (mitigated by reservation-cleaner)
- Reworded §3.2.1 for TTL behaviour (prior wording summary recorded here)
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
- Forcing non-surgical architecture discovery through this skill instead of escalating to [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) or [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
- Forgetting to surface roadmap and plan impact after the edit
- Writing prior-state narrative in main blueprint sections instead of `## Revision History`

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
