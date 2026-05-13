---
name: devenv-refine-blueprint
description: 'Revise an existing Blueprint-*.md after architecture decisions change, new requirements arrive, or implementation discovery exposes gaps. USE WHEN the user says "refine the blueprint", "update the blueprint", "revise the architecture", "the blueprint needs updating", or hands off a stale blueprint that needs adjustments. Preserves all existing structure and decisions, appends new content rather than reflowing, records every change in a Revision History section, and writes the result back in place. DO NOT USE for creating a new blueprint (use /devenv-create-blueprint), for ad-hoc edits to a single line (just edit the file), or for updating a roadmap (use /devenv-update-roadmap).'
argument-hint: 'Path to a Blueprint-*.md file'
user-invocable: true
---

# Refine Blueprint

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

Do not assume. If the change has roadmap impact (component added/removed, ordering implication), surface it explicitly:

> "This change adds a new component. The roadmap (`Roadmap-<system>-NNN.md`) likely needs an update too. Want me to flag this for `/devenv-update-roadmap`?"

### 3. Apply changes — preserve everything

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

### 4. Record the revision

Add a new entry to the top of `## Revision History`:

```markdown
### 2026-05-13 — Added inventory reservation TTL

- Added §3.2.7: `service.commerce.reservation-cleaner` (new)
- Added §3.4 row: `ReservationExpired` event
- Reworded §4.1 to reflect TTL behaviour; previous wording preserved beneath
- Superseded §5.2 risk #3 (mitigated by reservation-cleaner)
```

Most recent revision goes on top.

### 5. Write the result

Overwrite the file in place. The user can `git diff` to review and revert.

### 6. Surface downstream impacts

After writing, list what may need follow-up:

- **Roadmap impact**: new components → new roadmap steps → suggest [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md)
- **Implementation plan impact**: existing plans may now reference superseded sections → suggest [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) for affected plans

## Anti-patterns

- Silently overwriting decisions
- Reflowing numbers (breaks links from roadmaps and plans)
- Deleting per-component delta entries when the change shipped — mark them `(shipped)` instead
- Rewriting the blueprint from scratch — that's [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md), not refine
- Forgetting to surface roadmap and plan impact after the edit
