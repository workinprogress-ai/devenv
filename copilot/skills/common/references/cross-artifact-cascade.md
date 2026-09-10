# Cross-Artifact Cascade Protocol

Loaded by `/devenv-refine-specifications` and `/devenv-refine-blueprint` in cascade mode, and by any skill that needs to understand how a single decision propagates across the two living planning documents. Specifications and blueprints are two views of one system truth — specifications say *what* the system does, blueprints say *how* it is shaped — and many real decisions land in both at once.

## Scope

- **In scope:** symmetric co-maintenance of `Specifications-*.md` and `Blueprint-*.md` (planning-repo living documents) in one session, with decision recording in ADRs.
- **Out of scope:** downstream propagation to grooming documents and plans (handled by freshness-based staleness checks at plan-start and grooming-start), and non-surgical re-architectures (route to `/devenv-design-discussion` or `/devenv-create-blueprint` per the refine skills' existing rules).

## The three-home rule

1. **Living documents** (specifications, blueprints, roadmaps) carry target state only — what the system *is*, with no embedded history, no change logs, no Revision History sections. Superseded content is **deleted clean**; IDs never reflow, so gaps in numbering are expected and harmless.
2. **ADRs** (`docs/Decisions/ADR-NNN-<slug>.md`) carry the *why* — context, decision, consequences, rejected alternatives — for every significant decision. See [adr-template.md](./adr-template.md).
3. **Git** carries the *when* — who changed what, when. That is what it is for.

## Span detection (at intake)

A change **spans** when it alters both what the system does and how it is shaped. Detection signals:

- The change touches a bounded-context or ownership boundary (concept moves between services)
- A contract, schema, or public surface changes
- A dependency direction changes
- A non-functional constraint shifts (performance, consistency, security) in a way that forces structural response
- The user says so ("this affects both", "and the blueprint needs…")

When span is detected, stay loaded: the session drives **both** documents. Whichever refine skill was entered from is the driver; the other document's edits happen in the same session. No handoff, no re-invocation.

## The unified change-set

One table, presented to the user **before any edit is applied**, covering every artifact the decision touches:

```markdown
🔶 Cascade change-set — "Ordering owns reservations"

| Artifact | Edit |
|---|---|
| Specifications-reqord-001.md | SPEC-012 rewritten: ownership constraint moves to Ordering; SPEC-019 (old ownership text) deleted |
| Blueprint-reqord-001.md | §4.2 Context Map: reservation aggregate moves to Ordering BC; Catalog shows reference-only edge |
| Blueprint-reqord-001.md | §4.4 Communication Patterns: add Catalog→Ordering reservation-query call |
| ADR-0007 (new) | Decision record: context, alternatives, consequences |
| Downstream flags | Grooming docs for Ordering/Catalog will need revisit; plans stale after this lands |
```

Wait for approval of the full set. Then apply per-artifact, each under **its own document's edit discipline**:

- Specifications: SPEC-NNN IDs stable, supersede = delete clean (no strikethrough), dependencies updated, episodes file checked for staleness
- Blueprint: structure-preserving edits, current-state prose, no dated annotations

The disciplines stay separate; the session doesn't.

## ADR writing (significant decisions only)

Write an ADR when the decision clears the significance bar: *would a future implementer, working downstream, need to know why this is shaped this way?* Triggers:

- Bounded-context or ownership moves
- Contract / schema / public-surface changes
- Dependency-direction changes
- Non-functional constraint shifts with structural consequences
- Any decision where a real alternative was rejected

Not ADR-worthy: rewording, task reordering, detail added within an existing decision's boundaries.

Cross-issue batching: when several queued discoveries (see intake, below) stem from one coherent design shift, fold them into a **single** change-set and a single ADR rather than N tiny passes — offer this when the pattern appears.

## Issue intake (the upstream-impact queue)

Skills that discover upstream-material changes from below — grooming, execution closeouts, spikes, plan refinement — file an `upstream-impact` labeled issue in the planning repo rather than editing the living documents themselves. Each issue is a work order: what changed, why, affected sections, and enough context/alternatives that the executor can later write the ADR faithfully.

Either refine skill can be invoked with:

- **Issue number(s)** → load those issues as the change-set input.
- **The `upstream-impact` label** → enumerate the queue (`issue-list --label upstream-impact`), offer all/some selection.
- Plus the normal document-path input (the change may need both).

The per-issue loop: present the work order → interview the architect (accept / modify / reject-as-immaterial / defer / merge-with-another) → execute accepted items via the change-set flow above → reply on the issue with the outcome (ADR link, documents touched) → close. Rejected items close `not planned` with a one-line rationale — that is the materiality triage.

The queue is an inbox, not an obligation. Same-person flow: file the issue, invoke the refine skill in the same sitting, consume it immediately. The issue exists to carry context across the skill boundary, not to wait for anyone.

**Entry symmetry:** a queue item may be blueprint-dominant, spec-dominant, or both — and since cascade mode is symmetric, the choice of entry skill is functionally irrelevant (it only picks the session's home document). Wrong pick costs nothing.

## Downstream flags

A cascade that changes specs or blueprints makes downstream artifacts stale. The change-set's "Downstream flags" row names them, and the affected sessions handle refresh via their existing staleness checks (plan-start drift check compares upstream `updated_at_utc` against the plan's recorded upstream state; grooming-start does the same). Do not edit grooming docs or plans from the cascade session — they live in other lifecycles, and their sync points are their own.
