# Roadmap Template

Copy this skeleton verbatim and fill it in. All top-level headings are required.

```markdown
# Roadmap: <System Name>

<One paragraph: what this roadmap delivers, and which blueprint it executes.>

**Status**: Draft | Active | Completed | Superseded
**Blueprint**: [Blueprint-<system>-NNN.md](<link>)
**Source requirements** (optional): [Requirements-<topic>-NNN.md](<link>)
**Parent epic**: <populated after issue creation: e.g. `planning.development.main#89`>

## Revision History

### YYYY-MM-DD — Initial roadmap

---

## Status Legend

| Symbol | Meaning |
|---|---|
| ⬜ | Not started — issue open, no linked PR |
| 🟡 | In progress — issue open with at least one linked PR |
| ✅ | Done — issue closed |
| ⏸️ | Paused / blocked — issue open, blocking label or comment |
| ❌ | Cancelled — issue closed without merge, or marked superseded |

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
**Blueprint sections**: [§4.1](<link>), [§3.2.3](<link>)
**Depends on**: None

<One paragraph: what this step delivers at a component level. No task-level detail.>

---

### STEP-02: Add reservation events

**Status**: ⬜ Not started
**Issue**: <populated after issue creation>
**Component**: `service.commerce.inventory` (extended)
**Blueprint sections**: [§3.4](<link>)
**Depends on**: [STEP-01](#step-01-extend-inventory-with-reservation-api)

<One paragraph.>

---

### STEP-03: Build fulfillment orchestrator

**Status**: ⬜ Not started
**Issue**: <populated after issue creation>
**Component**: `service.commerce.fulfillment-orchestrator` (new)
**Blueprint sections**: [§4.2](<link>), [§3.3 CreateOrder](<link>)
**Depends on**: [STEP-01](#step-01-extend-inventory-with-reservation-api), [STEP-02](#step-02-add-reservation-events)

<One paragraph.>

---

## Open Questions

- <Decisions still pending that affect sequencing>

## Notes

- This roadmap is updated by the `/devenv-update-roadmap` skill — step status is synced from linked issues and PRs.
- Adding a new step requires running `/devenv-create-roadmap` again with the updated blueprint, or editing the file directly with full understanding of the dependency graph.
```
