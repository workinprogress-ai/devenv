# Roadmap Template

Copy this skeleton verbatim and fill it in. All top-level headings are required.

```markdown
<!-- DEVENV_ARTIFACT_V1
doc_id: dv1:<owner>/<repo>:issue-<epic-number>:roadmap:<system>-<NNN>
artifact_type: roadmap
artifact_scope: issue-comment
issue_number: <epic-number>
source_file: none (GitHub artifact; scratch copy is session-only)
updated_at_utc: <ISO-8601>
-->

# Roadmap: <System Name>

<One paragraph: what this roadmap delivers, and which blueprint it executes.>

**Status**: Draft | Active | Completed | Superseded
**Blueprint**: [Blueprint-<system>-NNN.md](<link>)
**Source specifications** (optional): [Specifications-<topic>-NNN.md](<link>)
**Epic**: this issue (`#<epic-number>`) — the roadmap is an artifact comment here; the epic body holds the child-issue task list
**Decision log**: <link to docs/Decisions/ — ADRs hold the why; this roadmap holds target state only>

## Status Legend

Step status derives from the **set of linked issues and their plan progress** (precedence order, first match wins):

| Symbol | Meaning | Condition |
|---|---|---|
| ✅ | Done — all linked issues closed via merge | precedence 1 |
| ⏸️ | Paused / blocked — any linked issue carries a `blocked` or `paused` label | precedence 2 |
| 🟡 | In progress — any linked issue is open with a linked PR **or** plan progress > 0 | precedence 3 |
| ⬜ | Not started — linked issues open, no PR, no plan progress | precedence 4 |
| ❌ | Cancelled — linked issue(s) closed without merge (all of them) | precedence 5 |

When plan data exists for a step, the status line carries a progress annotation
— e.g. `🟡 In progress — 12/20 tasks (60%)` — rewritten on every
`/devenv-update-roadmap` run so it cannot rot.

---

## Delivery Strategy

<One paragraph describing the chosen sequencing approach: dependency-first,
capability-slice, or hybrid. Include the rationale.>

---

## Phases

### PHASE-01: <Phase Name>

**Goal**: <one sentence — what this phase delivers, demonstrably>

**Steps in this phase**:

- [STEP-01](#step-01-extend-inventory-with-reservation-api)
- [STEP-02](#step-02-add-reservation-events)

---

### PHASE-02: <Phase Name>

**Goal**: <one sentence>

**Prerequisites**: [PHASE-01](#phase-01-phase-name)

**Steps in this phase**:

- [STEP-03](#step-03-build-fulfillment-orchestrator)

---

## Steps

### STEP-01: Extend inventory with reservation API

**Status**: ⬜ Not started
**Issues**: <populated after issue creation — one per line, canonical `org/repo#N` form; a step may link multiple issues>
**Component**: `service.commerce.inventory` (extended)
**Blueprint sections**: [§4.1](<link>), [§4.2](<link>)
**Depends on**: None

<One paragraph: what this step delivers at a component level. No task-level detail.>

---

### STEP-02: Add reservation events

**Status**: ⬜ Not started
**Issues**: <populated after issue creation>
**Component**: `service.commerce.inventory` (extended)
**Blueprint sections**: [§4.1](<link>)
**Depends on**: [STEP-01](#step-01-extend-inventory-with-reservation-api)

<One paragraph.>

---

### STEP-03: Build fulfillment orchestrator

**Status**: ⬜ Not started
**Issues**: <populated after issue creation>
**Component**: `service.commerce.fulfillment-orchestrator` (new)
**Blueprint sections**: [§4.2](<link>), [§4.1 CreateOrder](<link>)
**Depends on**: [STEP-01](#step-01-extend-inventory-with-reservation-api), [STEP-02](#step-02-add-reservation-events)

<One paragraph.>

---

## Open Questions

- <Decisions still pending that affect sequencing>

## Notes

- This roadmap is updated by the `/devenv-update-roadmap` skill — step status and progress annotations are derived from linked issues, PRs, and plan artifacts. **Issue links use canonical `org/repo#N` form**; each linked issue carries a `STEP-NN` backlink in its body.
- Structural changes (adding, splitting, re-sequencing, or removing steps) go through `/devenv-refine-roadmap` — STEP-NN IDs are preserved, new steps are appended with the next sequential ID, merged steps inherit the most advanced status, split children start ⬜ with a note, and superseded steps are deleted clean.
- The parent epic's task list is a **projection** of this roadmap's statuses — it is regenerated on every update; hand-edits there are not durable.
```
