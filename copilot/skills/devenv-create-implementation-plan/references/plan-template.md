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

## Detailed Task List

### Phase 1 — Discovery & test scaffolding

> Deliverable summary: <One- or two-sentence summary of what this phase
> delivers and why it is independently committable.>
>
> See [Phase 1](#phase-1--discovery--test-scaffolding) above for full context,
> orientation, and likely decision points.

- [ ] **1.1 [S] <Task title>** ([additional context](#task-11--short-slug))
  - Files: `<workspace-root-relative/path/File.cs>`
  - depends on <N.N> (omit if none)

- [ ] **1.2 [M] <Task title>**
  - Files: `<workspace-root-relative/path/File.cs>`, `<workspace-root-relative/path/FileTests.cs>`

---

### Phase 2 — <Phase name>

> Deliverable summary: <What gets delivered, what stays green, and why the
> phase can be reviewed or committed independently.>
>
> See [Phase 2](#phase-2---phase-name) above for the phase goal, end-state
> vision, suggested strategies, AC coverage, and watch-outs.

- [ ] **2.1 [M] <Task title>**
  - Files: `<workspace-root-relative/path/File.cs>`
  - decision: <the choice to make, and why it's non-obvious> (omit if none)
  - [QUESTION] <Task-level unresolved implementation detail, if any>
  - depends on 1.2

- [ ] **2.2 [L] <Task title>** ([additional context](#task-22--short-slug))
  - Files: `<workspace-root-relative/path/File.cs>`, `<workspace-root-relative/path/NewFile.cs>` (new)

---

### Phase N — Cleanup & docs

> Deliverable summary: Final cleanup and documentation. Removes throwaway
> scaffolding from earlier phases, updates user-facing docs, and verifies
> coverage hasn't regressed.
>
> See [Phase N](#phase-n--cleanup--docs) above for the cleanup goal, AC review
> scope, and final deliverables.

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

## Additional Task Context

<Per-task deep dives. Anchor each entry with a descriptive slug so tasks above
can link to it.>

#### <a id="task-11--short-slug"></a>1.1 — <Task topic>

<Detailed context: file paths, code references, edge cases, test ideas, links
to related code or docs. A future AI loading just this section should have
enough to execute the task.>

#### <a id="task-22--short-slug"></a>2.2 — <Task topic>

<Detailed context.>

## Revision History

### <date> — Initial plan created
```

## Notes on filling it in

- **Title** — name the outcome, not the activity. "Add bulk-sync retry policy" beats "Work on bulk-sync".
- **Opening paragraph** — assume the reader has zero prior context.
- **Goals and Acceptance Criteria** — this is the first section a human should be able to use to understand the intended end state and scope boundaries.
- **Acceptance criteria anchors** — define each AC with an explicit anchor (`<a id="ac-N"></a>`) and link to those anchors everywhere else (`[AC-N](#ac-N)`). Avoid plain-text references like "AC-2" without a link.
- **Context and Orientation** — write this so it still helps a human who never reads past it. Aim for concise depth (usually 2-4 sentences per subsection) and repo-specific details over generic phrasing.
- **Phases** — this is the human-oriented breakdown. Give enough goal, end-state, strategy, AC coverage, and watch-out information for someone to start a phase without living in the task list. Prefer at least two concrete strategy bullets and two concrete deliverables per phase when scope allows.
- **Decision placement** — unresolved execution decisions should appear in both places: phase-level under **Watch Outs / Decisions** and task-level as `decision:` metadata on the earliest affected task.
- **Pending questions** — resolve as many as possible during planning. Keep unresolved items only for implementation-level details or explicit user-requested deferral.
- **Question placement** — phase/task-specific unresolved questions stay inline as `[QUESTION] ...`; `## Pending Questions` is only for plan-level unresolved items.
- **Detailed Task List blockquotes** — keep these short. They are there to summarise deliverables and point back to the richer phase context, not to carry the full orientation burden.
- **Detailed Task List size** — prefer a condensed list (typically 3-6 tasks per phase). If a phase needs more, split the phase or push depth into `## Additional Task Context`.
- **Appendix** — optional for straightforward work. Required for medium/high-complexity plans derived from upstream design artifacts; summarize the important design context directly (decisions, constraints, contracts, migration notes, rejected alternatives), then link references.
- **Appendix complexity trigger** — treat appendix as required when design-derived work hits the threshold: any 1 high-complexity trigger or any 2 medium-complexity triggers.
- **Pending Questions** — optional. Place it immediately above `## Reference Information`. Use it only for unresolved plan-level questions; keep task- and phase-local questions inline as `[QUESTION]` bullets where they belong.
- **Phase boundaries** — each phase must end committable. If a phase can't, split it.
- **Task headers** — bold, with size label, optional inline `(additional context)` link.
- **Step-first tasks** — each task line should be a concrete step. Include `Files:` for execution-facing plans by default; include `decision:` and `depends on` only when needed. Move deep rationale to `## Additional Task Context`.
- **Anchor slugs** — use `#task-NN--short-slug` (descriptive), not `#task-N-N` (opaque). Match with `<a id="task-NN--short-slug"></a>` in *Additional task context*.
- **Reference table** — prefer a "key files" table with a relevance column over a flat link list. Add a separate **Related links** sub-list for issues/docs/PRs.
- **Upstream artifacts** — when a grooming/design/spike/blueprint/roadmap artifact exists, include explicit links in the `Upstream artifacts` block.
- **Coordination context** — when this plan is one slice of a larger groomed issue attack plan, fill the coordination fields (parent grooming artifact, slice type, independent target statement).
- **Revision History placement** — keep it near the bottom so the top of the plan stays oriented toward implementation and review.
- **Revision History content** — log only material changes. Batch related small edits from the same pass into one concise bullet instead of one bullet per tweak.
- **Section heading case** — Title Case for `## Detailed Task List`, `## Reference Information`, etc.
