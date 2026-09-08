# ADR Template

One file per significant decision: `docs/Decisions/ADR-NNN-<slug>.md` in the planning repo. `NNN` is a zero-padded sequence continuing from the highest existing ADR number. ADRs are the **only** home for decision rationale — living documents (specifications, blueprints, roadmaps) carry target state only, and git carries the when.

```markdown
# ADR-<NNN>: <short decision title>

**Status**: Accepted | Superseded by ADR-<M>
**Date**: <YYYY-MM-DD>

## Context

[What forced this decision: the forces, constraints, and problem situation.
Enough background that a reader with no session history understands why
this needed deciding at all.]

## Decision

[The choice, stated in the present tense as current truth: "Reservation
state lives in the Ordering bounded context. Catalog references
reservations by ID and cannot mutate them."]

## Alternatives considered

- **<Alternative A>** — [why rejected]
- **<Alternative B>** — [why rejected]

## Consequences

+ [positive consequence]
+ [positive consequence]
− [cost / new constraint / migration need]
− [cost]

## Cross-artifact impact

- Specifications-<topic>-NNN.md: <sections / SPEC items touched>
- Blueprint-<topic>-NNN.md: <sections touched>
- Downstream: <grooming docs / plans that will go stale; roadmap impact if any>
```

## Rules

- **Significance bar:** write an ADR only when a future downstream implementer would need to know *why*. Rewording, task reordering, and detail-within-an-existing-decision do not qualify.
- **Append-mostly:** accepted ADRs are immutable. A reversal writes a new ADR whose Status says `Superseded by ADR-<new>` (and the new one references back). Never edit a decided ADR in place.
- **Seeding at creation:** `/devenv-create-blueprint` writes ADR-0001..N for the major decisions made during its interview (context decomposition choices, rejected alternatives surfaced by the interview). From birth, the ADR set is the decision log.
- **Naming:** `ADR-007-ordering-owns-reservations.md` style — number, then kebab-case slug.
