---
name: devenv-redesign-component
description: 'Redesign an existing component when its current approach is no longer the best — runs a full design session using the existing Architecture_and_implementation.md as context, producing an updated living design doc AND a temporary Redesign--NNN.md that feeds into devenv-plan-from-spec. USE WHEN the user says "redesign this component", "the current approach isn''t working", "we need to rethink X", "the original design is no longer right", or "this component has evolved in the wrong direction". DO NOT USE FOR small design updates after implementation (use /devenv-refine-technical-design), a component with no design yet (use /devenv-create-technical-design), system-level architectural changes (use /devenv-refine-blueprint), or weighing options before committing to a direction (use /devenv-design-discussion).'
argument-hint: '[component repo path | Architecture_and_implementation.md path]'
user-invocable: true
---

# Redesign Component

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.

Redesign the internals of a component when the original design approach is no longer the best — whether due to accumulated complexity, misplaced responsibility, performance problems, new requirements that the design cannot absorb, or simply a better understanding of the domain. This skill runs a full design session (like `devenv-create-technical-design`) but using the existing design as context, explicitly distinguishing what stays from what changes. It produces two outputs: an updated `docs/Architecture_and_implementation.md` (the permanent living doc) and a temporary `Redesign--NNN.md` that describes what needs to be built — the spec that feeds directly into [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md).

## When to Use

Trigger phrases:

- "redesign this component / service / library"
- "the current approach isn't working"
- "we need to rethink X"
- "the original design is no longer right"
- "this component has evolved in the wrong direction"
- A design discussion (`/devenv-design-discussion`) concluded that a fundamental approach change is needed

Do **not** use for:

- Small design updates after implementation (gaps, resolved unknowns, minor drift) → [`/devenv-refine-technical-design`](../devenv-refine-technical-design/SKILL.md)
- A component that has no design document yet → [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md)
- System-level architectural changes → [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)
- Weighing options before committing to a redesign direction → [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md)
- Task-level implementation planning → [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) or [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md)

## Core Principles

1. **Interface contract first, always.** Even in a redesign, settle the new boundary before redesigning internals. A redesigned internal structure that contradicts the existing contract is a breaking change — that needs to be an explicit decision, not an accident.
2. **Distinguish what changes from what stays.** Not everything is up for grabs. Identify the parts of the current design that are still correct and leave them alone. Only redesign what the diagnosis shows is broken or inadequate.
3. **Record why the old approach no longer holds.** This is as important as recording the new decision. Future engineers and AI sessions need to understand the reasoning so they don't repeat the old pattern.
4. **Two outputs, different lifetimes.** `Architecture_and_implementation.md` is the permanent living record — it should read as if the redesign is complete. `Redesign--NNN.md` is temporary — a spec document for the implementer. Delete it after the implementation plan is created.
5. **Push back on weak diagnoses.** "The code is messy" is not a redesign trigger. Require the user to articulate what the current approach gets wrong and why no incremental fix will do.
6. **The redesign doc is not a plan.** It describes the scope and intent at a high level — enough for `devenv-plan-from-spec` to decompose into tasks. It does not list tasks, estimate effort, or prescribe implementation order.

## Session Memory

Maintain a `session_memory-technical-design.md` file in the component repo root to preserve progress across sessions.

Track:
- Which phases are complete
- **Open questions log** — `Q-NNN` items (same format as [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md))
- What the diagnosis concluded (what changes, what stays)
- Key decisions already made

**Open questions log format:**

```
Q-001 | open   | Should the new approach maintain backward-compat with the old event schema? | Affects: [Interface Contract, Data Model]
Q-002 | resolved | Can the existing data model be migrated online? | Resolution: yes — additive columns only, no downtime required
Q-003 | deferred | Multi-tenancy strategy | User: out of scope for this redesign
```

Status: `open` → `brainstorming` → `resolved` / `deferred`. Every Q-NNN must reach `resolved` or `deferred` before writing.

---

## Procedure

### Phase 0 — Intake

Ask in one conversational exchange:

1. **What component is being redesigned?** Name, purpose, and which repo it lives in.
2. **What is the concern in brief?** A single sentence is enough here — just enough to orient. The full problem exploration happens in Phase 1.
3. **Is there a GH issue for this work?** Used as NNN in the `Redesign--NNN.md` filename.
4. **Any hard constraints?** Backward compatibility requirements, stack constraints, timeline pressure, team decisions already made.

Load `docs/Architecture_and_implementation.md` from the component repo. If it does not exist, redirect to [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) — a redesign requires an existing design as its starting point.

Summarise the current design back to the user in 5–8 bullets covering: what the component does, its current interface contract (key exposed and consumed surfaces), its main structural approach, and any known unknowns or deferred items from the existing doc.

---

### Phase 1 — Problem Clarification

With the current design now visible, probe the problem in depth. Do not jump to diagnosis or solutions here — the goal is to produce a precise, agreed problem statement that will serve as the guiding criteria for Phase 2.

Ask in one exchange (adjust based on what was already said in intake):

1. **What specific symptoms or failure modes are you seeing?** Concrete examples are more useful than abstractions — *"when we do X, Y breaks"* rather than *"the design doesn't scale"*.
2. **In what scenarios does the current design fall short?** Are there specific load patterns, usage patterns, or edge cases where it fails or struggles?
3. **What does success look like?** After the redesign, what should be possible or different that isn't today?
4. **Is there a root cause hypothesis?** Do you already have a sense of *why* the current design produces these problems, or is that still open?
5. **What has already been tried or considered?** Incremental fixes attempted, approaches ruled out, constraints that shaped the current design.

After the user responds, reflect the problem back in a structured summary:

```
## Problem Statement

**Symptoms:** [what the user observes going wrong]
**Root cause hypothesis:** [why the current design produces this, if known]
**Success criteria:** [what must be true after the redesign]
**Constraints:** [hard limits the new design must respect]
**Ruled out:** [incremental fixes that won't work and why]
```

Wait for the user to confirm or correct this summary before proceeding. This is the contract that Phase 2 will use as its evaluation criteria — it must be accurate.

---

### Phase 2 — Diagnosis

This phase uses the Problem Statement from Phase 1 as its evaluation criteria.

Work through the current design section by section. For each area, record one of three verdicts:

- **Keep as-is** — the current approach is correct and should not change
- **Update** — the approach is right but the implementation or specifics need adjustment (this is refinement territory — note it but don't redesign it)
- **Rethink** — the fundamental approach to this area is the problem

| Area | Verdict | Notes |
|---|---|---|
| Interface contract | | |
| Internal structure | | |
| Data model | | |
| Error handling | | |
| Test strategy | | |

Push back if the user marks everything as "rethink" without a connection back to the agreed problem statement. A diagnosis that produces "rethink everything" usually means the problem is narrower than it appears and hasn't been precisely located yet.

For each "rethink" verdict: require a brief explanation of what the current approach gets wrong and why an incremental fix won't do. Log open questions as Q-NNN.

---

### Phase 3 — Redesign Session

Run a focused design session covering only the areas marked "rethink" in the diagnosis. For areas marked "keep" or "update", carry forward the current design without reopening decisions.

For each section being redesigned, follow the same discipline as [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) (brainstorm, push back, record decisions with rationale), with one addition: **for every new decision, also record why the old approach no longer holds relative to the agreed Problem Statement**.

**Interface Contract** *(if marked rethink)*

Redesign the component's public boundary:
- What changes in the exposed surface? (endpoints, events, messages, exported API)
- What changes in the consumed surface? (dependencies, direction)
- Is this a breaking change? If so, what is the migration/compatibility strategy?
- Log Q-NNN for unresolved interface questions.

**Internal Structure** *(if marked rethink)*

Redesign the interior at the module/layer level:
- What is the new layering? What responsibilities move?
- What are the new key modules?
- What are the new key types or domain concepts?
- What is the new entry point for a reader?

**Data Model** *(if marked rethink)*

Redesign the owned state:
- What changes about the persistent data?
- What is the migration strategy? (Schema migration, data transform, cut-over plan)
- Does the ownership boundary change?
- Log Q-NNN for migration questions.

**Error Handling** *(if marked rethink)*

Redesign the error strategy:
- What error types change?
- Does the propagation strategy change?
- Do retry / idempotency guarantees change?

**Test Strategy** *(if marked rethink)*

Redesign the test approach:
- Does the unit boundary change?
- Do integration test boundaries change?
- Are new contract tests needed?

---

### Phase 4 — Open Questions

For any Q-NNN still open after Phase 2:

1. Restate the question clearly
2. Offer 2–4 options with trade-offs
3. Ask the user to decide
4. Update Q-NNN to `resolved` or `deferred`

Do not move to Phase 5 while critical design questions remain open.

---

### Phase 5 — Draft Both Outputs

Before writing anything, show the user drafts of both outputs for approval.

**Draft 1 — Changes to `Architecture_and_implementation.md`**

Show a diff-style summary:

```
## Proposed changes to Architecture_and_implementation.md

### Interface contract — Exposed surface
- CHANGE: [what changes and why]
- KEEP:   [what stays unchanged]

### Internal structure
- CHANGE: [what changes and why]
- KEEP:   [what stays unchanged]

### Data model
- CHANGE: [what changes and why]

### Key decisions — new rows
- Decision: [topic] | Old: [old choice] | New: [new choice] | Rationale: [why old no longer holds] | Trade-off: [what we accepted]
```

**Draft 2 — `Redesign--NNN.md` structure**

Show the proposed structure and ask the user to confirm scope and coverage before writing.

Wait for explicit approval on both before proceeding to Phase 6.

---

### Phase 6 — Write

**Output 1: `docs/Architecture_and_implementation.md`** (in-place update)

- Set **Status** to `Under revision` while writing; set to `Stable` when done
- Update **Last updated** date
- Update only the sections agreed in Phase 4 — do not reformat or reword sections that are not changing
- Add rows to **Key Decisions** for every structural change, including the old approach and why it no longer holds
- Resolve or update **Known Unknowns** entries for any Q-NNN items addressed in this session

**Output 2: `Redesign--NNN.md`** (new file)

Write to the workspace root or the component repo root (ask the user which, default workspace root so it is easy to pass to `devenv-plan-from-spec`). Use the [redesign doc format](#redesign-doc-format) below. Mark it explicitly as temporary.

---

### Phase 7 — Wrap-up

After writing both files, give the user a brief summary:

- What sections of `Architecture_and_implementation.md` changed and what the key new decisions were
- Any Q-NNN items resolved or deferred
- The path to `Redesign--NNN.md`
- **Suggested next step:** run [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) and pass `Redesign--NNN.md` as the input spec to generate a concrete implementation plan
- **Reminder:** delete `Redesign--NNN.md` after the implementation plan is created — it is not living documentation

---

## Redesign Doc Format

```markdown
# Redesign: [Component Name]

> **TEMPORARY DOCUMENT** — This is the input spec for `/devenv-plan-from-spec`. Delete after the implementation plan is created and verified.

**Component:** [component name]  
**Repo:** [workspace-relative path]  
**Architecture doc:** [link to Architecture_and_implementation.md]  
**Date:** [date]  
**Related issue:** [GH issue # if any, otherwise omit]

---

## Why this redesign

[What the current approach gets wrong. Crisp and specific — 2–5 bullets. This is the "problem statement" that guided the design session.]

---

## What changes

[One subsection per area being redesigned. Skip areas that are keeping their current approach.]

### [Area — e.g. Internal Structure]

**Current approach:** [brief description of what the component currently does in this area]  
**New approach:** [what it will do instead]  
**Why the current approach no longer holds:** [concise rationale]  
**Migration concern:** [any backward-compat, data migration, or cut-over consideration — omit if none]

---

## Affected areas (high level)

[A module/layer-level description of what needs to change in the codebase. Not a file list — more like "the job scheduling layer needs to be replaced with X", "the data access layer needs a new abstraction for Y". Enough for devenv-plan-from-spec to generate tasks from.]

---

## What stays the same

[Explicit list of what is NOT changing. This bounds the scope and prevents the implementation plan from drifting into territory that doesn't need to change.]

---

## Acceptance criteria

[How we know the redesign is complete. Observable behaviour that must still work. New behaviour that must work. Specific tests or checks that will verify completion.]
```

---

## Anti-patterns

- **Redesigning everything because "the code is messy."** Messy code is a refactoring task, not a redesign. A redesign means the fundamental approach to at least one major area is wrong. Require a precise diagnosis.
- **Skipping the diagnosis.** Moving directly to "here's the new design" without articulating what the old design gets wrong means the same problems will resurface. The diagnosis is not optional.
- **Leaving the `Redesign--NNN.md` in the repo permanently.** It is a temporary spec document, not living documentation. It becomes stale the moment implementation begins. Delete it after the implementation plan exists.
- **Writing the redesign doc at task-level.** It should describe intent and scope, not implementation steps. If it starts listing files to change or code to write, it has drifted into implementation plan territory — stop and use `devenv-plan-from-spec` instead.
- **Reopening decisions that the diagnosis marked "keep."** Once the diagnosis is agreed, don't re-examine the kept areas. Scope creep in a redesign is costly.
- **Conflating a redesign with a blueprint change.** If the redesign changes how the component fits into the system (its events, its contracts with other services, its position in the dependency graph), that may also require updating the system blueprint — flag it, but don't do it inline. Suggest [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) as a follow-on.

## Sibling skills

- [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) — when no design exists yet
- [`/devenv-refine-technical-design`](../devenv-refine-technical-design/SKILL.md) — for small, surgical updates to an existing design (not a fundamental rethink)
- [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) — when the right redesign direction isn't settled yet and options need to be weighed first
- [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) — the natural next step after this skill; pass `Redesign--NNN.md` as the input spec
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — if the redesign changes the component's place in the system, the blueprint may also need updating
