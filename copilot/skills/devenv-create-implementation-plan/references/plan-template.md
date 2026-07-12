# Implementation Plan Template

Copy this skeleton verbatim and fill it in. All top-level headings are required, except `## Pending Questions`; `## Appendix` is optional for straightforward work and required for medium/high-complexity plans derived from upstream design artifacts.

```markdown
<!-- DEVENV_ARTIFACT_V1
doc_id: dv1:<owner-repo>:local:implementation-plan:<artifact-slug>
artifact_type: implementation-plan
artifact_scope: local-file
issue_number: <N | none>
source_file: <workspace-relative file path>
updated_at_utc: <ISO-8601>
-->

# <Plan Title — short and specific>

<One paragraph: what this plan accomplishes and why. Enough context for a fresh
human or AI to understand the goal without opening other documents.>

## Goals and Acceptance Criteria

<A short end-state paragraph describing what the completed work should look
like, why it matters, and the boundaries of the work. Include explicit scope
boundaries or non-goals when they matter to understanding the shape of the
solution.>

- [ ] <a id="ac-1"></a>**AC-1** <criterion text — observable behaviour the system must exhibit when the work is done> *(explicit)*
- [ ] <a id="ac-2"></a>**AC-2** <criterion text> *(inferred)*

## Context and Orientation

### Problem Context

<What problem are we solving? Who is affected? What does success look like in
business / user terms?>

<Target depth: usually 2-4 sentences grounded in this repo's actual current
behaviour and pain point. Avoid generic one-liners.>

### Solution Context

<Chosen approach at a high level. Key design decisions and the reasoning. Any
explicitly rejected alternatives and why.>

<Target depth: usually 2-4 sentences naming concrete components, seams, or
integration points to change.>

### Forces

<Bulleted list of constraints and pressures shaping the plan: existing
architecture, deadlines, performance requirements, compatibility, team
capacity, etc.>

- **<Force 1>**: <description>
- **<Force 2>**: <description>

### Additional Considerations and Notes

<Anything else worth knowing: known unknowns, follow-up work explicitly out of
scope, related issues, risks and mitigations. This section should be useful even
if the reader never looks at the task list.>

<Target depth: enough detail that a new contributor can start discovery from
this section alone.>

## Phase TOC

<Keep this short and navigable so readers can jump directly to active work.>

- [Phase 1 - Discovery & test scaffolding](#phase-1---discovery--test-scaffolding)
- [Phase 2 - <Phase name>](#phase-2---phase-name)
- [Phase N - Cleanup & docs](#phase-n---cleanup--docs)

## Phases

### Phase 1 — Discovery & test scaffolding

**Goal:** <What this phase is meant to establish.>

**End State:** <What should be true when this phase is complete.>

**Suggested Strategies:**

- <How to approach the work without over-constraining the implementation order>
- <Existing pattern to follow or first area to inspect>

<Prefer at least two concrete strategy bullets per phase.>

**Acceptance Criteria In Scope:**

- [AC-1](#ac-1)

**Watch Outs / Decisions:**

- <Non-obvious risk, tradeoff, or likely decision>
- [QUESTION] <Phase-level unresolved question that must be answered before related implementation can proceed>

**Deliverables:**

- <Concrete thing that exists by the end of the phase>
- <Another deliverable>

<Prefer at least two concrete deliverables per phase when scope allows.>

**Tasks:**

- [ ] **1.1 [S] <Task title>**
  - Files: `<workspace-root-relative/path/File.cs>`
  - owner: AI
  - depends on <N.N> (omit if none)
  - Additional context: <Task-specific nuance, edge case, or execution note. Keep this directly under the task.>

- [ ] **1.2 [M] <Task title>**
  - Files: `<workspace-root-relative/path/File.cs>`, `<workspace-root-relative/path/FileTests.cs>`
  - Additional context:
    - <Test strategy or validation detail; if existing coverage already locks the behavior, say so and do not add more tests>
    - <Known caveat or implementation note>

- [ ] **1.3 [S] Add pressure-test checkpoint if discovery surfaces high-risk assumptions**
  - owner: AI
  - Additional context: <Only include when discovery finds boundary, sequencing, failure-mode, or rollout risks that should be challenged before later phases commit to them.>

---

### Phase 2 — <Phase name>

**Goal:** <What this phase is meant to establish.>

**End State:** <What should be true when this phase is complete.>

**Suggested Strategies:**

- <Approach guidance>
- <Where to start>

**Acceptance Criteria In Scope:**

- [AC-2](#ac-2)

**Watch Outs / Decisions:**

- <Risk or decision>

**Deliverables:**

- <Deliverable>

**Tasks:**

- [ ] **2.1 [M] <Task title>**
  - Files: `<workspace-root-relative/path/File.cs>`
  - decision: <the choice to make, and why it's non-obvious> (omit if none)
  - [QUESTION] <Task-level unresolved implementation detail, if any>
  - depends on 1.2
  - Additional context: <Task-specific detail that should live with the task, not in a separate section.>

- [ ] **2.2 [L] <Task title>**
  - Files: `<workspace-root-relative/path/File.cs>`, `<workspace-root-relative/path/NewFile.cs>` (new)
  - Additional context:
    - <Edge case>
    - <Integration detail>

---

### Phase N — Cleanup & docs

**Goal:** Final cleanup and documentation for the implemented scope.

**End State:** Throwaway scaffolding is removed, docs are updated, and coverage remains stable.

**Suggested Strategies:**

- Complete AC verification before removing DEVENV markers.
- Keep cleanup scoped to artifacts introduced by this plan.

**Acceptance Criteria In Scope:**

- [AC-1](#ac-1)
- [AC-2](#ac-2)

**Watch Outs / Decisions:**

- Ensure AC verification happens before removing evidence comments or temporary markers.

**Deliverables:**

- Final AC verification outcomes are recorded.
- DEVENV markers introduced by this plan are removed.
- User-facing docs and inline docs are updated.

**Tasks:**

- [ ] **N.1 [S] Remove scaffolding tests no longer needed**
- [ ] **N.2 [S] AC Review** — scan for `[AC-N]` DEVENV comments in code (`grep -rn "\[AC-" .`); for each acceptance criterion, verify against current code and tests; run `markdown-plan-complete-ac AC-N... [<plan_file>]` for each criterion that is objectively verifiable (test passes, behaviour observable); present any requiring human judgment for the user to confirm. **Must complete before the DEVENV cleanup task.**
- [ ] **N.3 [S] Remove all DEVENV markers** *(if any were added during this plan — `grep -rn "DEVENV\[" .` must return zero results; run after AC Review so AC-reference comments are removed together)*
- [ ] **N.4 [S] Update README / changelog / inline docs**
- [ ] **N.5 [S] Verify coverage has not regressed**

---

## Appendix *(optional unless required by source complexity)*

### Deep Context for Pairing *(optional)*

Optional supplemental context for complex or high-risk plans. Keep this
section concise (roughly 10-25 lines) so it remains an appendix, not a second
plan.

Appendix is required when the plan is derived from an upstream design artifact
(design doc, RFC, Blueprint, Redesign doc, or equivalent issue comment) and the
implementation is medium/high complexity or risk. In that case, summarize the
important design context directly in the appendix, do not rely on links alone.
If the same context already appears elsewhere in the plan, do not repeat it here — link back instead.

Complexity triggers (appendix required when source is design-derived and either condition holds):

- Any **1** high-complexity trigger is true, or
- Any **2** medium-complexity triggers are true.

High-complexity triggers:

- Cross-component or cross-repo coordination with ordering constraints.
- Data model or contract changes that require migration/compatibility handling.
- Security/compliance constraints materially shaping implementation.
- Rollout/operational risk requiring staged deployment, fallback, or backfill strategy.

Medium-complexity triggers:

- Three or more phases with non-trivial dependencies.
- Multiple external integrations or interface boundaries affected.
- Significant legacy/new-code coexistence requiring transition strategy.
- Performance/SLO constraints that influence architecture or sequencing.
- More than one major design alternative rejected for explicit reasons.

Recommended contents:

- **System mental model:** 3-6 bullets describing key moving parts and control/data flow.
- **Invariants and contracts:** non-negotiable behaviour boundaries.
- **Decision log (short):** key choices and rejected alternatives with one-line reasons.
- **Known unknowns:** assumptions to validate during implementation.
- **Canonical references:** links to source files/issues/docs that answer likely pairing questions.
- **Upstream design summary (required when applicable):** key design decisions,
  constraints/invariants, interface contracts, migration/rollout implications,
  and explicitly rejected alternatives that shape implementation choices.

---

## Pending Questions *(optional)*

Use only for unresolved plan-level questions that materially affect execution.
Task- or phase-specific questions should live inline under the relevant task or
phase as `[QUESTION] ...` bullets.

- [QUESTION] <General plan or approach question that is still unresolved>

---

## Reference Information

**Key files to understand before implementing:**

| File | Relevance |
|---|---|
| `<workspace-root-relative/path/File.cs>` | <Why this file matters; what to study; what pattern to follow.> |
| `<workspace-root-relative/path/Other.cs>` | <Relevance.> |

**Related links:**

- <GH issue, design doc, related PR, external spec, etc.>
- <Link>

**Upstream artifacts (if any):**

- <Grooming artifact link>
- <Design discussion / spike / blueprint / roadmap artifact link>

**Coordination context (optional when this plan is one slice of a larger groomed attack plan):**

- Parent grooming issue/artifact: <link>
- Slice issue type: <Feature|Fix|Task>
- Slice independent production target: <one-line statement>

## Revision History

### <date> — Initial plan created
```

## Notes on filling it in

- **Title** — name the outcome, not the activity. "Add bulk-sync retry policy" beats "Work on bulk-sync".
- **Opening paragraph** — assume the reader has zero prior context.
- **Goals and Acceptance Criteria** — this is the first section a human should be able to use to understand the intended end state and scope boundaries.
- **Acceptance criteria anchors** — define each AC with an explicit anchor (`<a id="ac-N"></a>`) and link to those anchors everywhere else (`[AC-N](#ac-N)`). Avoid plain-text references like "AC-2" without a link.
- **Context and Orientation** — write this so it still helps a human who never reads past it. Aim for concise depth (usually 2-4 sentences per subsection) and repo-specific details over generic phrasing.
- **Phase TOC** — keep it concise and place it directly before `## Phases` so users can jump between phases quickly.
- **Phases** — this is the human-oriented breakdown and execution surface. Include tasks directly under each phase so readers do not need to jump to a separate task-list section. Prefer at least two concrete strategy bullets and two concrete deliverables per phase when scope allows.
- **Decision placement** — unresolved execution decisions should appear in both places: phase-level under **Watch Outs / Decisions** and task-level as `decision:` metadata on the earliest affected task.
- **Pending questions** — resolve as many as possible during planning. Keep unresolved items only for implementation-level details or explicit user-requested deferral.
- **Question placement** — phase/task-specific unresolved questions stay inline as `[QUESTION] ...`; `## Pending Questions` is only for plan-level unresolved items.
- **Tasks per phase** — prefer a condensed list (typically 3-6 tasks per phase). If a phase needs more, split the phase or keep task context concise.
- **Appendix** — optional for straightforward work. Required for medium/high-complexity plans derived from upstream design artifacts; summarize the important design context directly (decisions, constraints, contracts, migration notes, rejected alternatives), then link references.
- **Appendix complexity trigger** — treat appendix as required when design-derived work hits the threshold: any 1 high-complexity trigger or any 2 medium-complexity triggers.
- **Pending Questions** — optional. Place it immediately above `## Reference Information`. Use it only for unresolved plan-level questions; keep task- and phase-local questions inline as `[QUESTION]` bullets where they belong.
- **Phase boundaries** — each phase must end committable. If a phase can't, split it.
- **Task headers** — bold, with size label, optional inline `(additional context)` link.
- **Step-first tasks** — each task line should be a concrete step. Include `Files:` for execution-facing plans by default; include `decision:` and `depends on` only when needed. Keep additional context directly under each task.
- **Reference table** — prefer a "key files" table with a relevance column over a flat link list. Add a separate **Related links** sub-list for issues/docs/PRs.
- **Upstream artifacts** — when a grooming/design/spike/blueprint/roadmap artifact exists, include explicit links in the `Upstream artifacts` block.
- **Coordination context** — when this plan is one slice of a larger groomed issue attack plan, fill the coordination fields (parent grooming artifact, slice type, independent target statement).
- **Revision History placement** — keep it near the bottom so the top of the plan stays oriented toward implementation and review.
- **Revision History content** — log only material changes. Batch related small edits from the same pass into one concise bullet instead of one bullet per tweak.
- **Section heading case** — Title Case for `## Phase TOC`, `## Phases`, `## Reference Information`, etc.
