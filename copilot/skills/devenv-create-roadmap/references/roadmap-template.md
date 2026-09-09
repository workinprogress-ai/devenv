# Roadmap Template

Copy this skeleton verbatim and fill it in. All top-level headings are required.

```markdown
<!-- DEVENV_ARTIFACT_V1
doc_id: dv1:<owner-repo>:issue-<epic-number>:roadmap:<system>-<NNN>
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

| Symbol | Meaning |
|---|---|
| ⬜ | Not started — issue open, no linked PR |
| 🟡 | In progress — issue open with at least one linked PR |
| ✅ | Done — issue closed via merge |
| ⏸️ | Paused / blocked — issue open with a `blocked` or `paused` label |
| ❌ | Cancelled — issue closed without merge |

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
**Issue**: <populated after issue creation>
**Component**: `service.commerce.inventory` (extended)
**Blueprint sections**: [§4.1](<link>), [§4.2](<link>)
**Depends on**: None

<One paragraph: what this step delivers at a component level. No task-level detail.>

---

### STEP-02: Add reservation events

**Status**: ⬜ Not started
**Issue**: <populated after issue creation>
**Component**: `service.commerce.inventory` (extended)
**Blueprint sections**: [§4.1](<link>)
**Depends on**: [STEP-01](#step-01-extend-inventory-with-reservation-api)

<One paragraph.>

---

### STEP-03: Build fulfillment orchestrator

**Status**: ⬜ Not started
**Issue**: <populated after issue creation>
**Component**: `service.commerce.fulfillment-orchestrator` (new)
**Blueprint sections**: [§4.2](<link>), [§4.1 CreateOrder](<link>)
**Depends on**: [STEP-01](#step-01-extend-inventory-with-reservation-api), [STEP-02](#step-02-add-reservation-events)

<One paragraph.>

---

## Open Questions

- <Decisions still pending that affect sequencing>

## Notes

- This roadmap is updated by the `/devenv-update-roadmap` skill — step status is synced from linked issues and PRs.
- Structural changes (adding, splitting, re-sequencing, or removing steps) go through `/devenv-refine-roadmap` — STEP-NN IDs are preserved, new steps are appended with the next sequential ID, and superseded steps are deleted clean.
```
