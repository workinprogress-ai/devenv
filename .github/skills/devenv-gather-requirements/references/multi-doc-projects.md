### Multi-document projects (one doc per epic)

A single requirements doc is the right default. For large initiatives — multiple distinct epics, multiple stakeholder groups, or a system whose scope outgrows one document — split into one `Requirements-<epic>-NNN.md` per epic.

**When to split:**
- The vision section starts describing two largely independent capabilities
- Different stakeholder groups own different parts and would prioritise them independently
- The doc is heading past ~30 requirements or ~3 distinct functional areas
- The user explicitly frames the work as "Epic 1", "Epic 2", etc.

**Conventions when splitting:**
- One `<topic>` per epic, e.g. `Requirements-orders-001.md`, `Requirements-fulfillment-001.md`, `Requirements-returns-001.md`
- **Use category-prefix IDs unique per epic** (`ORD-NNN`, `FUL-NNN`, `RET-NNN`) so requirement IDs are globally unique across the project. Agree the prefix list with the user before writing any doc.
- Each doc has its own `session_memory-requirements-<topic>.md` during gathering, allowing parallel work on different epics without state collision.
- **Cross-document dependencies are explicit.** A requirement in one doc can declare a dependency on a requirement in another doc using the form:

  ```
  Depends on: AUTH-003 (Requirements-auth-001.md)
  ```

  In-doc dependencies stay bare (`Depends on: ORD-002`).
- Each doc has its own `GROUP-NN` priority groups, scoped to that epic. There is no project-wide priority grouping at the requirements layer — cross-epic sequencing is the roadmap's job, see [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md).

**Process for a multi-doc project:**
1. In Phase 1, agree the epic split and the prefix-per-epic scheme up front, in chat. Record the split in each `session_memory-requirements-<topic>.md`.
2. Run the full three-phase process per epic doc. The same skill invocation completes one doc at a time — do not interleave.
3. When all epic docs are complete, hand them all to [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) in a single invocation — it accepts multiple requirements paths and produces one roadmap (one parent epic) spanning them.
4. **Produce an `Index.md`** alongside the epic docs (see *Index.md for multi-file artifacts* below). The Index is the canonical entry point — link to it from blueprints, roadmaps, and parent epics, not to individual epic docs.

### Index.md for multi-file artifacts

Whenever a multi-doc project produces more than one `Requirements-<epic>-NNN.md`, produce an `Index.md` alongside them at `docs/Requirements/Index.md` (or wherever the docs live).

Structure:

```markdown
# Requirements: <project name> — Index

> Multi-document project. Each epic has its own requirements doc with its own ID prefix.
> Use this index as the canonical entry point.

## Epics

| Doc | Prefix | Scope |
|---|---|---|
| [Requirements-orders-001.md](Requirements-orders-001.md) | `ORD-NNN` | Order placement, modification, cancellation |
| [Requirements-fulfillment-001.md](Requirements-fulfillment-001.md) | `FUL-NNN` | Pick, pack, ship, track |
| [Requirements-returns-001.md](Requirements-returns-001.md) | `RET-NNN` | Customer-initiated returns and refunds |

## Cross-doc dependencies

- `FUL-003` depends on `ORD-007` (Requirements-orders-001.md)
- `RET-002` depends on `ORD-005` (Requirements-orders-001.md)
- `RET-004` depends on `FUL-009` (Requirements-fulfillment-001.md)

## Stakeholder priority across epics

Each doc has its own `GROUP-NN` priority groups, scoped to that epic. Cross-epic sequencing is the roadmap's job (see [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md)). If stakeholders have an explicit cross-epic ordering preference, capture it here as plain prose:

> Stakeholder priority: orders MVP → fulfillment MVP → returns MVP, then post-launch hardening across all three.

## Revision history

Each doc maintains its own `## Revision History`. Recent project-wide events:

- 2026-05-13 — Added `Requirements-returns-001.md`
- 2026-05-10 — Initial multi-doc structure (split from `Requirements-orders-001.md`)
```

Key rules:
- The Index is **navigation, not content** — do not duplicate requirements text from the epic docs
- Update the cross-doc dependencies section whenever a cross-doc `Depends on:` edge is added or removed
- If the project started as a single doc and was later split, record the split as the first revision-history entry on the Index

