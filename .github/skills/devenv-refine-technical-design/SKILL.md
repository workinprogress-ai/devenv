---
name: devenv-refine-technical-design
description: 'Revise an existing docs/Architecture_and_implementation.md after the component evolves, design decisions change, or implementation work reveals gaps in the original design. USE WHEN the user says "update the architecture doc", "refine the technical design", "the Architecture.md is out of date", "update the component design", "the design changed", or implementation work has altered how the component is structured. Updates the file in place and records what changed and why. DO NOT USE FOR creating a brand-new technical design (use /devenv-create-technical-design), system-level architectural changes (use /devenv-refine-blueprint), or task-level planning (use /devenv-refine-implementation-plan).'
argument-hint: '[component repo path | Architecture_and_implementation.md path]'
user-invocable: true
---

# Refine Technical Design

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.

Update a component's `docs/Architecture_and_implementation.md` when the design evolves. Unlike its create counterpart, this skill is lightweight and surgical: it loads the existing document, asks what changed, verifies against the current state (code or user input), makes targeted updates, and records the changes in the Key Decisions table. Because `Architecture_and_implementation.md` is a living document tracked by git, in-place updates are correct — no NNN suffix, no separate revision file.

## When to Use

Trigger phrases:

- "update the architecture doc" / "the Architecture.md is out of date"
- "refine the technical design" / "the design changed"
- "update the component design after [some work]"
- Implementation of a phase revealed that the original design was wrong or incomplete
- A new pattern was introduced to the component that the document doesn't reflect
- A deferred Q-NNN from the original session is now ready to be resolved

Do **not** use for:

- Creating a technical design from scratch → [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md)
- System-level architectural changes → [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)
- Task-level plan revisions → [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md)

## Core Principles

1. **Minimal footprint.** Change only what has actually changed. Do not reformat, reword, or restructure sections that are still accurate.
2. **Always record why.** Any update to the Interface Contract, Internal Structure, Data Model, or Error Handling sections must add or update a row in the Key Decisions table explaining the change.
3. **Verify before writing.** When the component has existing code, confirm the current state by reading relevant files rather than relying solely on what the user says changed.
4. **Resolve deferred items explicitly.** If a Q-NNN deferred item is now answerable, resolve it and update the Known Unknowns section.
5. **Never silently remove.** If a section is being removed (e.g. a feature was cut), note what was removed and why in Key Decisions. Do not just delete.

---

## Procedure

### Step 1 — Load the document

Read `docs/Architecture_and_implementation.md` from the component repo. Summarise its current state back to the user in 3–5 bullets:
- What the document currently describes
- How recent it appears (Status field, Last updated date)
- Any sections that already look stale or incomplete

If no document exists, redirect to [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md).

---

### Step 2 — Interview: what changed?

Ask the user (combine into one exchange):

1. **What triggered this refinement?** (Completed implementation phase? New requirements? Design decision reversed? Deferred Q-NNN now answerable?)
2. **Which sections are affected?** (Interface contract / internal structure / data model / error handling / test strategy / decisions)
3. **Are there deferred Q-NNN items in the Known Unknowns that are now ready to resolve?**

---

### Step 3 — Verify (brownfield)

If the component has existing code and the change touches internal structure, interface, or data model:

1. Read the relevant implementation files to confirm the current actual state
2. Note any discrepancies between what the user described and what the code shows
3. Surface discrepancies to the user before writing — never silently pick one version over the other

---

### Step 4 — Draft changes

Before writing, show the user a diff-style summary of what will change:

```
## Proposed changes to Architecture_and_implementation.md

### Interface contract — Exposed surface
- CHANGE: Added POST /v1/jobs endpoint (batch submission)
- CHANGE: JobCreated event schema extended with `priority` field

### Data model
- CHANGE: Job entity gains `priority` (int, 1–10) column

### Key decisions — new row
- Decision: Job priority field | Choice: integer 1–10 | Rationale: aligns with downstream scheduler contract | Trade-off: ordinal scale, not weighted

### Known unknowns
- RESOLVE Q-003: priority scheduling algorithm — resolved as FIFO within priority tier
```

Wait for the user to confirm before writing.

---

### Step 5 — Write

Update `docs/Architecture_and_implementation.md` in place:

- Update the **Status** field to `Under revision` while writing; set to `Stable` when done (or leave as `In design` if significant unknowns remain)
- Update the **Last updated** date
- Make only the changes agreed in Step 4
- Add or update rows in **Key Decisions** for every structural change
- Update or remove entries in **Known Unknowns** for any resolved Q-NNN items
- Do not reformat or reword sections that are unchanged

---

### Step 6 — Wrap-up

After writing, give the user a brief summary:

- What sections changed and what the key new decisions were
- Any Q-NNN items resolved
- Any new Q-NNN items surfaced during verification (log these explicitly)
- Suggested next steps:
  - If the design change affects an in-progress implementation plan → [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md)
  - If the change reveals the blueprint needs updating → [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)
  - If new implementation work should begin → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md)

---

## Anti-patterns

- **Rewriting sections that haven't changed.** This creates noise in the git diff and makes the history unreadable.
- **Updating without recording the decision.** Every structural change to the document needs a Key Decisions entry. "The interface changed" is not a decision record.
- **Trusting the user's description over the code.** When code exists, read it. Designs drift from implementation; the document should match reality.
- **Silently removing deferred items.** If a Known Unknown is no longer relevant (e.g. the feature was cut), note the removal and why rather than deleting quietly.
- **Scope creep into a full redesign.** If the changes are so extensive that most sections need rewriting, consider archiving the old document and running [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) to produce a clean replacement.

## Sibling skills

- [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) — create the document in the first place
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — if the system-level architecture changed, not just this component
- [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) — update the task list when the design changed mid-implementation
- [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) — when the design change is not yet settled and options need to be weighed first
