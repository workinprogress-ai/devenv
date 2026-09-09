---
name: devenv-refine-blueprint
description: 'Revise an existing Blueprint-*.md after architecture decisions change, new specifications arrive, or implementation discovery exposes gaps. USE WHEN the user says "refine the blueprint", "update the blueprint", "revise the architecture", "the blueprint needs updating", hands off a stale blueprint, hands off issue number(s) describing a needed blueprint change (upstream-impact work orders or issues from any source) or asks to work the upstream-impact queue, or a change spans specifications and blueprint (cascade mode — one session edits both). Preserves section numbering and cross-references, appends rather than reflows, deletes superseded structure clean (the why lives in ADRs; the document carries target state only). If intake reveals a non-surgical change (broad re-architecture, unresolved option-weighing, major uncertain ripple effects), stop and route to /devenv-design-discussion or /devenv-create-blueprint. DO NOT USE for creating a new blueprint (use /devenv-create-blueprint), broad brainstorming without a settled direction (use /devenv-design-discussion), ad-hoc edits to a single line (just edit the file), or updating a roadmap (use /devenv-update-roadmap).'
argument-hint: 'Path to a Blueprint-*.md file'
user-invocable: true
---

# Refine Blueprint

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

Revise an existing blueprint based on new information — architectural decisions that changed, specifications that arrived after the original blueprint, or implementation discovery that exposed gaps. Preserve section numbering and cross-references; supersede structure deliberately.

Write the blueprint body as the current target architecture. Keep historical change narrative out of the document entirely — the document is target state, period. Rationale for significant changes lives in ADRs (`docs/Decisions/`, see the shared [ADR template](../common/references/adr-template.md)); git records when. If a legacy `## Revision History` section exists from an older workflow version, migrate its still-relevant entries into ADRs and delete the section.

## When to Use

- The user has a `Blueprint-*.md` that needs new components, revised deltas, new operations/events, or scope adjustments
- A previous `/devenv-create-blueprint` run is now out of date
- Implementation work surfaced architectural facts the blueprint didn't anticipate

Use this skill when the user already knows the intended architecture change direction and wants that change applied safely.

If the user is still deciding between architecture options, route to [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md). If the foundational architecture itself is being re-derived, route to [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) and treat the existing blueprint as input context.

If no blueprint exists, stop and redirect to [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md).

## Inputs

The user provides one of:

- **A file path** — e.g. `docs/Architecture/Blueprint-orders-001.md`.
- **Issue number(s)** — any issue whose body describes a needed blueprint change, whatever its origin. Queue work orders (`upstream-impact` label, filed by grooming, execution closeouts, spikes, plan refinement) carry the predictable body format ("what changed, why, affected sections") and load straight in via `issue-get <N> --pretty`. Issues from any other source (users, stakeholders, ad-hoc) are equally valid input — read the body, extract the intended change, and confirm the direction with the reporter if it's ambiguous. Either way, follow the [cross-artifact cascade protocol](../common/references/cross-artifact-cascade.md)'s issue-intake loop.
- **The upstream-impact queue** — "work the queue" / no specific issue: `issue-list --label upstream-impact`, present, let the architect pick all/some, then loop per issue.

Plus optionally the file path when an issue references a specific blueprint. At intake, run **span detection** (cascade protocol): if the change alters both what the system does and how it is shaped, enter **cascade mode** — this session drives both the specifications and the blueprint edits under the shared protocol, with ADRs recording significant decisions. Either refine skill can drive; entry choice only picks the home document.

Also offer queue consumption on any entry: "N open upstream-impact issues in this repo — fold them into this session?"

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
- Note services already listed (with their `(existing | new | extended)` status) and per-component delta entries.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — components, operations, events, patterns to add
- **What's wrong** — sections whose descriptions are now misleading
- **What changed status** — services moving from `new` → `existing`, deltas now obsolete because the change shipped
- **What's no longer relevant** — sections to delete clean (the why, if significant, goes in an ADR)
- **New specifications docs** — "In a multi-epic project, has a new `Specifications-<epic>-NNN.md` been added that this blueprint should now cover? Or has an existing one been split or refined?"
- **Source material** — "Are there meeting transcripts, email threads, design discussions, or other communications records behind these changes? If so, where are they?"

If the user provides communications artifacts, summarise each one separately (prefer the `Explore` subagent, one invocation per artifact, in parallel where possible) with a prompt focused on architectural decisions, components/services mentioned, trade-offs raised, and open questions. Surface each summary back for confirmation, then use the approved summaries to drive the change list. Cite the source in the ADR when one is written so the rationale can be re-traced.

If the user points at a new (or refined) specifications doc, read it and summarise back the actors/scenarios/constraints/new specification items that this blueprint should now reflect. Cross-doc dependency edges from the specifications (`Depends on: AUTH-003 (Specifications-auth-001.md)`) may translate into new cross-service dependencies — surface these explicitly. If a separate sibling blueprint covers the upstream epic, reference it (`<see Blueprint-auth-001.md §3.2>`) rather than duplicating its content here.

Do not assume. If the change has roadmap impact (component added/removed, ordering implication), surface it explicitly:

> "This change adds a new component. The roadmap artifact on the epic likely needs an update too. Want me to flag this for `/devenv-refine-roadmap` (structural) or `/devenv-update-roadmap` (status only)?"

## Splitting an oversized blueprint

If the single-file blueprint has grown past comfortable reading length (~1,500 lines, or §4 has more components than anyone can hold in their head), the user may ask to split it. Treat splitting as a special refinement:

1. **Interview**: confirm the split boundary. Common patterns (offer these; let the user pick or override):
   - **By section group** (default): `01-context.md`, `02-architecture.md`, `03-components.md`, `04-risks.md`
   - **By domain within §3-§4** when there are several
   - A hybrid when only one section is oversized
2. **Create the subfolder** `docs/Architecture/Blueprint-<system>-NNN/` and move the part files into it. The original `Blueprint-<system>-NNN.md` is replaced by this folder — leave a stub file at the old path containing only a redirect (`> **Moved to [Blueprint-<system>-NNN/Index.md](Blueprint-<system>-NNN/Index.md)**`) so existing links don't 404.
3. **Preserve section numbering across files.** §3.2.5 stays §3.2.5 wherever it lives. Cross-file references use the form `<see 02-architecture.md §3.2.5>`.
4. **The decision log line in each part file's header** points at `docs/Decisions/`; ADRs are system-wide, not per-part-file.
5. **Create `Index.md`** in the new subfolder with the structure documented in [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md) §*Index.md for multi-file artifacts*.
6. **Walk cross-blueprint references** and roadmap step `Blueprint sections:` lines to update them to the new file paths.
7. Surface roadmap impact — the roadmap's `Blueprint sections:` references on each STEP-NN are now stale; suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) to refresh them.

## Updating Index.md on plain refinements

If the blueprint is already split (subfolder + `Index.md` exists) and a refinement adds, removes, or moves sections between files, **update `Index.md` in the same pass** so its section map and file table stay accurate.

### 3. Confirm the change plan

**STOP.** Before touching the file, present a concise change plan and ask for confirmation:

> "Here's what I plan to change:
>
> - **Add** §X.Y: `service.foo` (new component)
> - **Reword** §3.2.1: updating the inventory delta to reflect TTL behaviour
> - **Supersede** §5.2 risk #3 (resolved by the reservation-cleaner)
> - **Append** `ReservationExpired` event row to §4.1 component entry
>
> Anything I've misread, over-scoped, or missed?"

Do not write anything until the user confirms. If the user adjusts scope, revise the plan and confirm again.

---

### 4. Apply changes — preserve everything

**Hard rules:**

- **Never reflow numbering.** Section `3.2.5` stays `3.2.5` for its lifetime. Append new entries with the next sequential number. Gaps from deleted sections are expected and harmless.
- **Superseded sections are deleted clean** — no tombstone text, no "replaced by" blockquotes in the body. If the supersession is significant (a future implementer would ask why), write an ADR naming the section and its replacement; otherwise delete silently.
- **New components are appended** to the end of `## 4. Per-Component Changes` with the next sub-number.
- **Reworded sections** keep their number and are rewritten in place as current truth. Prior wording lives in git history and, when significant, an ADR.

### 5. Write the result

Overwrite the file in place. The user can `git diff` to review and revert.

### 6. Record significant decisions as ADRs

For any change where a future implementer would ask *why* (a superseded component or section, a structural pattern swap, a split, a cascade decision), write an ADR using the shared [ADR template](../common/references/adr-template.md) into `docs/Decisions/`. Trivial edits need no ADR — git records them. The blueprint itself never carries change history.

### 7. Surface downstream impacts

After writing, list what may need follow-up:

- **Roadmap impact**: new components or removed deltas → structural roadmap changes → suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md). For step-status drift only (issues closed, PRs merged), suggest [`/devenv-update-roadmap`](../devenv-update-roadmap/SKILL.md) instead.
- **Specifications impact**: if architectural changes were driven by a specifications gap, suggest [`/devenv-refine-specifications`](../devenv-refine-specifications/SKILL.md)
- **Implementation plan impact**: existing plans may now reference superseded sections → suggest [`/devenv-refine-implementation-plan`](../devenv-refine-implementation-plan/SKILL.md) for affected plans
- **Unsettled approach** that triggered this refine: if a specific design question is still open, suggest [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) to weigh options before further refinement

## Anti-patterns

- Silently overwriting decisions
- Reflowing numbers (breaks links from roadmaps and plans)
- Deleting per-component delta entries when the change shipped — mark them `(shipped)` instead
- Rewriting the blueprint from scratch — that's [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md), not refine
- Forcing non-surgical architecture discovery through this skill instead of escalating to [`/devenv-design-discussion`](../devenv-design-discussion/SKILL.md) or [`/devenv-create-blueprint`](../devenv-create-blueprint/SKILL.md)
- Forgetting to surface roadmap and plan impact after the edit
- Keeping superseded sections as tombstone text — delete them clean; an ADR holds the why when it matters

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
