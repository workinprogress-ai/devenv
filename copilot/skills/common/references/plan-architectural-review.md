# Plan Architectural Review Protocol

Load this protocol on-demand when a design skill (design-discussion, grooming) is given an implementation plan file or issue as input, or when refine-implementation-plan detects architectural issues in an escalation handoff.

**Purpose:** read the plan as a diagnostic artifact — locate the architectural fault points, classify the nature of the problem, and orient a design session from the evidence in the plan rather than re-interviewing from scratch.

---

## When to load this protocol

Load this file explicitly when:

- A plan file path or issue number is passed as input to a design skill.
- An `[ESCALATION-HANDOFF]` marker is detected in `## Revision History`.
- The user says something like "look at this plan", "the design is wrong", "there is an architectural problem in this plan", or "the plan needs rethinking" while referencing a plan artifact.

Do not load for general design questions with no plan artifact involved.

---

## Step 1 — Load and map the plan

Read these plan sections in order. Each has a specific diagnostic role:

| Section | What to extract |
|---|---|
| `## Goals and Acceptance Criteria` | Stated intent, observable end state. Mismatches between intent and phase structure are a signal. |
| `## Context and Orientation → Solution Context` | The architectural approach chosen. Note if it feels inconsistent with the forces described. |
| `## Context and Orientation → Forces` | Constraints that shaped the approach. Check whether later phases violate a stated force. |
| `## Phases → Watch Outs / Decisions` | Unresolved or risky architectural choices flagged per-phase. These are primary fault candidates. |
| `## Detailed Task List → decision:` metadata | Task-level architectural choices deferred at planning time. Cluster these by phase. |
| `## Detailed Task List → [QUESTION]` | Unresolved task-level design questions. Note which phase they block. |
| `## Pending Questions` | Plan-level unresolved questions. These often represent architectural unknowns the planner parked. |
| `## Appendix → Decision log` | Rejected alternatives and why. Useful for checking whether a "rejected" path is actually what's needed. |
| `## Revision History → [ESCALATION-HANDOFF]` | If present, parse the recorded blocker, options considered, and recommended next step. Treat this as the primary fault summary. |

---

## Step 2 — Identify fault candidates

After reading, produce a fault candidate list:

For each candidate, note:
- **Location** — phase number and task number (or plan section) where the fault manifests.
- **Signal** — what in the plan text indicates a problem (unresolved `decision:`, contradictory forces, escalation marker, Watch Out item, architectural assumption that downstream phases already invalidate).
- **Fault type** (see classification below).

---

## Step 3 — Classify the fault type

| Type | Indicators |
|---|---|
| **Wrong strategy** | Chosen approach in Solution Context is fundamentally unsuited to the stated forces or ACs. Downstream phases accumulate workarounds as a result. |
| **Missing constraint** | A force or constraint that clearly applies was not captured, causing phases to make incompatible decisions. |
| **Broken boundary** | Two phases or components cross a responsibility boundary that was implicit in the design; this creates coupling problems in the task list. |
| **Deferred critical decision** | A `decision:` item at a task that other tasks depend on was left unresolved; a wrong choice there would invalidate multiple later tasks. |
| **Conflicting ACs and approach** | The chosen approach cannot satisfy one or more ACs without significant restructuring. |
| **Accumulated drift** | No single fault, but later phases have diverged from the original design intent in the earlier phases; design coherence has eroded. |

Multiple types can coexist. Rank them by impact on execution risk.

---

## Step 4 — Produce a scoped architectural brief

Summarise findings in this format before starting a design session:

```
## Architectural Brief — <plan filename>

**Source:** <plan file path or issue URL>
**Escalation phase:** <N (or "none")>

### Fault candidates
- Phase <N>, task <N.N> — <fault type>: <one-sentence description>
- ...

### Primary blocker
<The highest-risk fault candidate and why it blocks execution>

### Design question
<The concrete question the design session needs to answer to unblock the plan>

### Context already established (do not re-ask)
- Problem framing: <from Solution Context and forces>
- Constraints in effect: <from Forces and Appendix>
- Already-rejected alternatives: <from Appendix decision log>
```

---

## Step 5 — Orient the design session

Once the brief is produced:

- **Use it to skip re-asking context the plan already answers.** The problem framing, constraints, and rejected alternatives are already known.
- **Anchor the session to the design question** identified in the brief.
- **Flag any context gaps** — sections of the plan that are thin or absent and would normally provide input (e.g. no Forces section, no Appendix decision log). Name them explicitly so the user knows what the session is working without.

The design skill's normal session flow then resumes from the first open question rather than from Phase 1 intake.

---

## Stage-based routing matrix

Use this matrix after producing the Architectural Brief to select the next skill deterministically:

| Stage / intent | Default route | Escalate to | Why |
|---|---|---|---|
| Pre-plan architecture ambiguity | `/devenv-design-discussion` | `/devenv-grooming` | Broad option-weighing and recommendation is primary. |
| In-flight implementation unblock (plan partially executed) | `/devenv-grooming` | `/devenv-design-discussion` only for one bounded blocker that needs deeper option-weighing than the execution skills can support | Preserve execution continuity; close decisions at the blocker boundary first. |
| Post-decision task sequencing/scope updates | `/devenv-refine-implementation-plan` | `/devenv-grooming` if new architecture drift appears | Architecture is settled; update tasks safely. |

Tie-breaker prompt when uncertain:

> "Do we need broad option comparison, or the fastest safe decision to unblock the current plan phase?"

## Plan-problem triage rules

When a partially executed plan develops problems, use this triage before routing:

1. **Small local problem or question** — execution skill handles it directly and updates the plan in place.
   - Examples: one task needs rewording, one follow-up task is needed, one local decision can be closed with brief user discussion.
   - Route: stay in `/devenv-pair-programming` or `/devenv-delegation`; if architecture is already settled, update the plan directly.

2. **Accumulated questions or broader architectural drift** — return to `/devenv-grooming`.
   - Signals: multiple open decisions, interdependent blockers across phases, signs the current design needs broader reshaping, or the plan may need sweeping revision/replacement.
   - Route: `/devenv-grooming` first, then `/devenv-refine-implementation-plan` once design decisions are re-settled.

3. **Single large blocker / question** — use `/devenv-design-discussion`.
   - Signals: one bounded design question needs deeper brainstorming or option-weighing, but the outcome is expected to change a limited slice of the plan rather than re-baseline the whole design.
   - Route: `/devenv-design-discussion`, then back to `/devenv-refine-implementation-plan` for task updates.
   - If the discussion reveals that the blocker is not actually bounded and instead exposes broader design drift, pivot immediately to `/devenv-grooming` before refreshing the plan.

4. **Upstream architecture artifact is wrong** — go upstream before returning downstream.
   - If grooming shows the problem is really in the blueprint or higher-level architecture assumptions, update/discuss the blueprint first, then cascade the resulting changes back down through grooming and plan refinement.
