# Pivot protocol (shared)

A **pivot** is a mid-plan discovery that supersedes the approach assumption behind the *remaining* phases while the goal survives — a new library foundation, a research finding, a user design decision, a scope discovery. This protocol is the deliberate response; without it a pivot is absorbed by improvisation: stale phases ground through one by one while execution follows a path the plan no longer describes. Consumers: `devenv-delegate` and `devenv-pair` (executor half — classify, stabilize, escalate), `devenv-refine-plan` (refine half — the plan rewrite).

## The gradient (classify by which artifact's assumption broke)

| Grade | Broken assumption | Response | Decision owner |
|---|---|---|---|
| G0 task-local | implementation detail; correct path evident | handle inline; note in phase handback | executor |
| G1 deviation | a task's approach; plan shape holds | stop-confirm; record inline, current-state | executor + user |
| G2 revision | task set/sequencing under standing goal and approach | `/devenv-refine-plan` revision mode (reword, append, renumber, small phase insert) | plan session + user |
| **G3 pivot** | **approach/design assumption for remaining phases; goal survives** | **this protocol** | **grooming/design decides; plan executes by decision key** |
| G4 upstream | the goal/specification/blueprint itself | upstream-impact issue → `/devenv-refine-specifications` / `/devenv-refine-blueprint` cascade; the plan moves last | spec/blueprint owners |

Classification tests:

- **Goal-recognition test (G3 vs G4):** would a reader of the goal statement alone recognize the project after the change? Yes → G3 or below; no → G4. Rewriting the goals *text* to re-anchor from the pivot forward is G3 mechanics; changing what the project *is* is G4.
- **Remaining-approach test (G2 vs G3):** are the remaining phases' approaches valid, merely re-sequenced or re-grained? → G2. Superseded by a new design target? → G3.
- **Verify before classifying:** pivot on verified reality — published bits, landed and republished code, reproduced findings — never on announcements or expectations. The verify step routinely surfaces pivot-specific hazards (a stale same-version package on a local feed is invisible at restore time and wrong at compile time).
- **Torn between grades → classify up.** A false pivot costs one refinement exchange; an unclassified pivot compounds silently across every remaining phase.

## Executor half (delegate / pair)

1. **Classify** the discovery on the gradient above. G0/G1 stay in the executor's existing flow; G4 routes to the upstream-impact filing recipe; G3 continues here.
2. **Stabilize at a clean boundary.** Let the current task finish *only if its output survives the pivot*; if the discovery invalidates it, abort it cleanly. Either way the truncated or completed phase gets a real phase-close — the pivot boundary is a commit boundary, never a dirty tree. Do not continue into further phases of a superseded approach.
3. **Decide before refining.** A pivot with decision mass — design choices that do not follow from recorded decisions, roughly more than two or three — routes through `/devenv-groom` (or `/devenv-design` for a single bounded question) first; the plan session never makes design decisions, it executes them by decision key. A thin pivot (no new design decisions, an already-settled replacement) may refine directly.
4. **Escalate and hand off.** Record the finding in the plan's `## Pending Questions` as a marker-style escalation record; the phase handback names the pivot and recommends `/devenv-refine-plan` (revision mode). Wait — never grind stale phases while refinement is pending.
5. **Re-commission on resume.** After refinement the commissioned execution agenda is stale (the phase map changed): re-check the agenda line in the session coordination file at resumption before continuing.

## Refine half (refine-plan revision mode)

Ordered moves; the first two precede any phase edit:

1. **Invariant boundary first.** Enumerate what the pivot must NOT touch — API surfaces, contracts, binding models, conflict semantics, delivered-and-green history — before touching anything. The list doubles as the test oracle: contract-bound tests must not change character; engine-bound tests legitimately do, and the plan says which are which.
2. **Cutover-mode decision.** In-place cutover vs parallel-build vs restart, with rationale recorded (data model, migration cost, reviewability). The choice is design, not plan mechanics — it belongs in grooming when grooming is in the loop.
3. **Insert the pivot phase at the seam** between delivered work and the new direction. Title it by what it builds ("Pivot: adopt DirectedGraph 2.0.0 + DocumentVcs 5.0.0"), not merely by the fact of the turn. The pivot phase changes no product behavior: pins/migrations/adoption mechanics only, suite green throughout.
4. **Forward-only rewrite.** Completed phases are never retro-edited. From the pivot forward: re-anchor goals and acceptance criteria as current state (retire superseded ACs, add new ones; AC identifiers never reflow); insert the new-direction phases after the pivot phase; renumber downstream phases and update in-plan references; keep the Phase TOC table current in the same edit; re-structure milestone gates around the pivot and its successor; reconcile the red-test register for phases carrying declared red work.
5. **Marker lifecycle.** Which prior `TODO:DEVENV[...]` markers the pivot discharges (and in which phase); which new forward-guidance `FIXME:DEVENV[...]` markers it plants at the successor phases' touch points. Both are explicit tasks in the pivot phase or its successor, never asides.
6. **Hazard register.** A blast-radius audit as a checklist, each item enumerated rather than discovered mid-execution: package pins and supply hazards (purge-before-pin as a task, not a footnote), entity reshapes and dual-mode contracts, breaking-API call-site sweeps, seams resolved by design, surfaces untouched by the pivot.

## Sharp edges (rules from a live pivot)

- **Same-version supply hazard:** stale bits under an identical version number on a higher-priority local feed — purge the feed before pinning; verification of *published* bits is what catches it.
- **Dual-mode entities:** one class serving two storage shapes risks phantom diffs in change classification — content-only persistence must be an explicit contract, not an emergent behavior.
- **Preserved surface ≠ preserved tests:** the API surface staying fixed does not mean its tests stay fixed — classify tests engine-bound vs contract-bound and say so in the plan.
- **Don't pivot alone:** regroom (decisions by key) and upstream amendments land *before* the plan moves; the plan pivot is the last artifact to move, not the first.
- **ADR near-default:** a pivot is the canonical material supersession — record an ADR naming the replaced assumption and the new direction unless the user opts out; a future reader of the pivot phase will ask why.
