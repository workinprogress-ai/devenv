---
name: devenv-redesign-component
description: 'Redesign an existing component when its current approach is no longer the best — runs a full design session using the existing Architecture_and_implementation.md as context, producing a temporary Redesign--NNN.md (decision record + target architecture) that feeds into devenv-plan-from-spec. Architecture_and_implementation.md is NOT updated during the redesign — it is updated in the implementation plan Cleanup phase once the work is done. USE WHEN the user says "redesign this component", "the current approach isn''t working", "we need to rethink X", "the original design is no longer right", or "this component has evolved in the wrong direction". DO NOT USE FOR small design updates after implementation (use /devenv-refine-technical-design), a component with no design yet (use /devenv-create-technical-design), system-level architectural changes (use /devenv-refine-blueprint), or weighing options before committing to a direction (use /devenv-design-discussion).'
argument-hint: '[component repo path | Architecture_and_implementation.md path]'
user-invocable: true
---

# Redesign Component

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.

Redesign the internals of a component when the original design approach is no longer the best — whether due to accumulated complexity, misplaced responsibility, performance problems, new requirements that the design cannot absorb, or simply a better understanding of the domain. This skill runs a full design session (like `devenv-create-technical-design`) but using the existing design as context, explicitly distinguishing what stays from what changes.

It produces **one output**: a temporary `Redesign--NNN.md` containing the decision record and a `## Target architecture` section — the spec that feeds directly into [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md).

**`docs/Architecture_and_implementation.md` is not updated during this skill.** It describes the current system and must stay accurate to the current code. Updating it to reflect a future state would mislead every AI session and engineer that reads it before implementation is complete — and if the work is deferred, the doc would be wrong indefinitely. The architecture doc is updated in the implementation plan's **Cleanup phase**, once the work is done, using the `## Target architecture` section of `Redesign--NNN.md` as the source.

## When to Use

Trigger phrases:

- "redesign this component / service / library"
- "the current approach isn't working"
- "we need to rethink X"
- "the original design is no longer right"
- "this component has evolved in the wrong direction"
- A design discussion (`/devenv-design-discussion`) concluded that a fundamental approach change is needed
- An implementation plan is provided with architectural fault points identified via the plan architectural review protocol (escalation handoff or direct user request)

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
4. **One output, explicitly temporary.** `Redesign--NNN.md` contains the full decision record plus a `## Target architecture` section — what the architecture doc will say when the work is done. `Architecture_and_implementation.md` is not touched; it must remain accurate to the current code until implementation is complete. The architecture doc is updated in the Cleanup phase of the implementation plan, using the target architecture section as the source. Delete `Redesign--NNN.md` after that Cleanup task is done.
5. **Push back on weak diagnoses.** "The code is messy" is not a redesign trigger. Require the user to articulate what the current approach gets wrong and why no incremental fix will do.
6. **Classify workspace context first.** Determine whether this session is running in a planning repo, target component repo, or devenv multi-repo workspace before reading files or making path assumptions.
7. **The redesign doc is not a plan.** It describes the scope and intent at a high level — enough for `devenv-plan-from-spec` to decompose into tasks. It does not list tasks, estimate effort, or prescribe implementation order.

## Session Memory

Maintain a `session_memory-technical-design.md` file in the component repo root to preserve progress across sessions.

Track:
- Which phases are complete
- **Open questions log** — `Q-NNN` items (same format as [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md))
- What the diagnosis concluded (what changes, what stays)
- Key decisions already made

Track open questions as `Q-NNN` items. See [Q-NNN format](../_conventions.md#open-questions-log-q-nnn) for the format block and status transitions. Every Q-NNN must reach `resolved` or `deferred` before writing.

---

## Procedure

### Phase 0a (conditional): Plan intake — load only when a plan is provided

If the user provides an `Implementation_plan-*.md` file path or issue number alongside or instead of a component path:

1. Load and follow the [plan architectural review protocol](../common/references/plan-architectural-review.md).
2. Produce the scoped architectural brief.
3. Present the brief and confirm with the user.
4. Use the brief to pre-populate Phase 0 answers: the concern, constraints, and rejected alternatives are already in the plan. Skip re-asking what the plan answers.
5. Identify the relevant component from the plan context and proceed to confirm the `Architecture_and_implementation.md` path before continuing.

If no plan is provided, skip Phase 0a entirely.

### Phase 0 — Intake

Ask in one conversational exchange:

1. **What workspace context are we in?** Planning repo, target component repo, or devenv multi-repo workspace.
2. **What component is being redesigned?** Name, purpose, and which repo it lives in.
3. **Confirm target repo path and current design doc path.** Identify the canonical `docs/Architecture_and_implementation.md` location before proceeding.
4. **What is the concern in brief?** A single sentence is enough here — just enough to orient. The full problem exploration happens in Phase 1.
5. **Is there a GH issue for this work?** Used as NNN in the `Redesign--NNN.md` filename.
6. **What supporting inputs are available?** Accept either pasted text or markdown file paths (issue notes, incident notes, requirements, related blueprint section).
7. **Any hard constraints?** Capture at least: backward compatibility, dependencies/libraries, infrastructure/runtime, security/compliance, performance/SLO, and timeline/process constraints.

Before Phase 1, post a short intake summary (context classification, target repo/doc path, inputs, and constraints) and get explicit user confirmation.

Load `docs/Architecture_and_implementation.md` from the component repo. If it does not exist, redirect to [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) — a redesign requires an existing design as its starting point.

If running from a planning repo or devenv multi-repo workspace, load the design doc from the confirmed target component repo path, not from the current working directory.

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

After the user responds, reflect the problem back as a **Problem Statement** (see [redesign-doc-template.md](./references/redesign-doc-template.md)) and confirm before proceeding to Phase 2.
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

### Phase 5 — Draft the Redesign Doc

Draft the redesign document in chat before writing to disk. The document covers: why this redesign is needed, what changes (per area), what stays the same, proposed acceptance criteria, and a target architecture sketch.

See [redesign-doc-template.md](./references/redesign-doc-template.md) for the full section format, required headings, and the `Redesign--NNN.md` content spec.

### Phase 6 — Write

Write `Redesign--NNN.md` to the workspace root (default) or component repo root — ask the user which, default workspace root so it is easy to pass to `devenv-plan-from-spec`. Use the [redesign doc format](#redesign-doc-format) below.

**Do not modify `docs/Architecture_and_implementation.md`.** It stays as-is, accurate to the current code.

If `docs/Architecture_and_implementation.md` has a **Status** field, set it to `Under revision` — this signals to readers that a redesign is in progress without changing any design content. Reset to `Stable` in the Cleanup phase.

---

### Phase 7 — Wrap-up

Summarise: key decisions (what changes, what stays, why), any Q-NNN items resolved or deferred, path to `Redesign--NNN.md`, and the reminder that `Architecture_and_implementation.md` was marked `Under revision` — the Cleanup phase of the resulting plan must update it via `/devenv-refine-technical-design`.

**Suggested next step:** run [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) and pass `Redesign--NNN.md` as the input spec.

**GitHub tracking (optional):** Offer to post the redesign doc to a GitHub issue. See [github-issue-creation.md](../devenv-pair-programming/references/github-issue-creation.md) for the 5-step protocol. Issue title: `Redesign: <component name> — <YYYY-MM-DD>`.

---

## Redesign Doc Format

See [redesign-doc-template.md](./references/redesign-doc-template.md) for the required headings and full document structure.

---

## Anti-patterns

- **Redesigning everything because "the code is messy."** Messy code is a refactoring task, not a redesign. A redesign means the fundamental approach to at least one major area is wrong. Require a precise diagnosis.
- **Skipping the diagnosis.** Moving directly to "here's the new design" without articulating what the old design gets wrong means the same problems will resurface. The diagnosis is not optional.
- **Updating `Architecture_and_implementation.md` during the redesign session.** The doc describes the current system and must stay accurate to the current code until implementation is complete. If it describes a future state during a deferral period, it misleads every AI session and engineer that reads it. Leave it alone; set its Status to `Under revision` at most. Update it in the Cleanup phase.
- **Leaving the `Redesign--NNN.md` in the repo permanently.** It is a working copy; the canonical record is the GH issue comment. The implementation plan generated by `devenv-plan-from-spec` includes a Cleanup phase task to update `Architecture_and_implementation.md` from the `## Target architecture` section. Once that task is complete, delete the local `Redesign--NNN.md` file. If no GH issue was created, delete it after the implementation plan exists.
- **Writing the redesign doc at task-level.** It should describe intent and scope, not implementation steps. If it starts listing files to change or code to write, it has drifted into implementation plan territory — stop and use `devenv-plan-from-spec` instead.
- **Reopening decisions that the diagnosis marked "keep."** Once the diagnosis is agreed, don't re-examine the kept areas. Scope creep in a redesign is costly.
- **Conflating a redesign with a blueprint change.** If the redesign changes how the component fits into the system (its events, its contracts with other services, its position in the dependency graph), that may also require updating the system blueprint — flag it, but don't do it inline. Suggest [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) as a follow-on.

## Sibling skills

- [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) — when no design exists yet
- [`/devenv-refine-technical-design`](../devenv-refine-technical-design/SKILL.md) — for small, surgical updates to an existing design (not a fundamental rethink)
- [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) — when the right redesign direction isn't settled yet and options need to be weighed first
- [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) — the natural next step after this skill; pass `Redesign--NNN.md` as the input spec
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — if the redesign changes the component's place in the system, the blueprint may also need updating
