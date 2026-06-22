# Pressure-Test Pass Protocol

Load this protocol when a design or planning workflow needs a bounded challenge pass before committing to a recommendation, architecture delta, or implementation plan edits.

**Purpose:** find high-impact failure modes early by stress-testing assumptions, interfaces, sequencing, and execution boundaries while changes are still cheap.

---

## Use constraints

- **User-gated only.** Never run automatically. Always ask first.
- **Conversation-first.** A pressure-test pass is analysis, not implementation.
- **Bounded iterations.** Run at most two passes per artifact state.
  - Pass 1: baseline challenge
  - Pass 2: optional re-check after substantive updates
- **Stop conditions are explicit.** End as soon as no blocker-class risks remain for the current decision horizon.

If uncertainty remains after two passes, stop escalating depth and route to the appropriate upstream workflow (for example grooming or blueprint revision).

---

## When to offer a pressure-test pass

Offer (do not force) when any apply:

- A recommendation or design decision will materially constrain later phases.
- There are unresolved `decision:` items with broad blast radius.
- Constraints appear internally inconsistent (ACs, architecture, sequencing, operations).
- A previously "bounded" blocker appears likely to widen scope.
- The user explicitly asks for stress-checking, devil's-advocate review, or risk probing.

Do not offer for tiny/local edits where the overhead would exceed the risk.

---

## Offer prompt (required)

Use this exact style:

> "Optional pressure-test pass before we lock this in? It is a bounded challenge pass (assumptions, boundaries, failure modes, rollout risks) and may produce targeted plan/design edits."

Proceed only on explicit yes.

---

## Pass structure

For each pass, produce a concise report:

1. **Assumptions at risk**
   - Which assumptions could invalidate the current approach.
2. **Boundary and contract stress**
   - Execution locus, ownership boundaries, interface/schema stability, coupling risks.
3. **Failure and rollout modes**
   - What breaks first, observability gaps, rollback/migration concerns.
4. **Sequencing and dependency stress**
   - Ordering hazards, hidden prerequisites, critical-path fragility.
5. **Disposition per finding**
   - `accept now`, `mitigate now`, `defer with trigger`, or `route upstream`.

Keep the output scoped to the current artifact and current delivery horizon.

---

## Required output format

```markdown
## Pressure-Test Pass <N>

### Findings
- [severity: blocker|high|medium] <finding>
  - Why it matters: <impact>
  - Suggested action: <accept|mitigate|defer|route>

### Net result
- Blocker findings: <count>
- High findings: <count>
- Recommended route: <continue current workflow | route to grooming | route to design-discussion | route to blueprint/refine>
```

If there are zero blocker/high findings, say so explicitly.

---

## Outcome handling

- **No blocker/high findings:** continue current workflow.
- **Single bounded blocker:** route to design-discussion if broader option-weighing is needed.
- **Multiple entangled or widening issues:** route to grooming.
- **Upstream architecture mismatch:** update/refine blueprint first, then cascade down.

When pressure-test findings change tasking or decisions, update the active artifact immediately (plan, grooming doc, or proposal) and record the change in its normal revision/history section.
