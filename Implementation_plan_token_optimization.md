# Token Optimization — Skill Files

Reduce token load for the pair-programming, create-implementation-plan, and delegation skills without losing behavioral precision. The primary goal is compressing redundant prose and duplicate blocks; behavioral rules must remain intact and correctly placed.

## Acceptance criteria

- [X] **AC-1** `devenv-pair-programming/SKILL.md` word count reduced to ≤ 7,500 words *(inferred)*
- [X] **AC-2** `devenv-delegation/SKILL.md` word count reduced to ≤ 3,800 words *(inferred)*
- [X] **AC-3** No behavioral rule present before this plan is deleted from any file after the plan *(explicit)*
- [X] **AC-4** Duplicate policy blocks (Always Work From Current Files, AC Review Gate, Phase Completion Gate) replaced with summary + link to a single canonical reference in both skills *(explicit)*
- [X] **AC-5** All existing cross-file links still resolve *(inferred)*
- [X] **AC-6** `devenv-gather-requirements/SKILL.md` word count reduced to ≤ 4,200 words *(inferred)*
- [X] **AC-7** `devenv-create-blueprint/SKILL.md` word count reduced to ≤ 2,900 words *(inferred)*
- [X] **AC-8** `devenv-redesign-component/SKILL.md` word count reduced to ≤ 2,200 words *(inferred)*
- [X] **AC-9** `devenv-create-technical-design/SKILL.md` word count reduced to ≤ 2,100 words *(inferred)*
- [X] **AC-10** `devenv-design-discussion/SKILL.md` word count reduced to ≤ 2,000 words *(inferred)*
- [X] **AC-11** Cross-cutting patterns (Q-NNN format, Explore subagent, GitHub issue creation) canonicalized to single source each *(explicit)*

## Revision history

### 2026-06-02 — Initial plan created

## Task List

### Phase 1 — Shared references and canonicalization

> **Deliverable:** Three new shared reference files that both pair-programming and delegation can link to instead of repeating full policy blocks. No behavior changes yet — this phase is purely additive. Existing skill files are not modified.
>
> **Orientation:** `_conventions.md` already has shared sections (hotspot format, no-assumptions rule). The pattern of pushing shared policy blocks into `references/` and linking from both skills is already established — we're extending it to three more blocks.

- [X] **1.1 [S] Create `references/file-freshness.md`**
  - Extract the "Always Work From Current Files" policy from `devenv-pair-programming/SKILL.md` (line ~429) — it is identical in delegation
  - Include the full rule: cache invalidation trigger, when to re-read, explicit `"I'd want to re-read..."` phrasing for when file can't be read
  - Place at `.github/skills/devenv-pair-programming/references/file-freshness.md`
  - Files: `.github/skills/devenv-pair-programming/references/file-freshness.md` (new)

- [X] **1.2 [S] Create `references/phase-gates.md`**
  - Extract the AC Review Gate and Phase Completion Gate sections from `devenv-pair-programming/SKILL.md` (lines ~732–778) — delegation has near-identical copies
  - Merge delegation's slight wording differences into a single authoritative version (delegation's gate adds "add a hotspot entry" — keep that)
  - Include the coverage escape hatch (Form A / Form B) inside the Phase Completion Gate section
  - Place at `.github/skills/devenv-pair-programming/references/phase-gates.md`
  - Files: `.github/skills/devenv-pair-programming/references/phase-gates.md` (new)

---

### Phase 2 — Compress pair-programming: Session Kickoff

> **Deliverable:** Session Kickoff trimmed from ~2,600 words to ~1,000. All procedural steps and hard rules preserved; prose explanation and in-line rationale compressed to imperative bullets. The resuming-from-compacted-context block and the DEVENV forward-comment section are the main reduction targets.
>
> **Orientation:** Session Kickoff runs from line ~73 to ~290. Steps 0 (resume), 1 (identify work), 2 (load plan), 2b (drift check), 2d (AC criteria), 2e (forward comments), 3 (confirm context), 4–7 (phase kickoff) are all present. The verbosity is in 2d (long example block), 2e (full DEVENV tutorial), and the transition-from-phase narrative.

- [X] **2.1 [M] Compress Step 0 (resume) and Steps 1–2 (load plan)**
  - Step 0: keep the 3-bullet checklist; remove the explanatory paragraph after it
  - Steps 1–2: collapse the GH-issue load protocol to a numbered list with no prose preamble; keep the 4 sub-steps verbatim as they are behavioral
  - Drift check (2b): keep the 4 signal bullets and the "two or more signals" rule; trim the quoted example to one line
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **2.2 [M] Compress Steps 2d (AC criteria) and 2e (forward guidance comments)**
  - 2d: keep the "if missing / if present" fork; shorten the example block to a single 2-bullet example (not a 4-line quoted block)
  - 2e: keep the two DEVENV forms and the AC-annotation rule; remove the lengthy rationale paragraphs between them — they already appear in `copilot-instructions.md`
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **2.3 [S] Compress Steps 3–7 (context confirm through task split)**
  - Steps 3–4: each is one sentence — no change needed
  - Steps 5–6 (file links + decision flag): keep; trim the Rules sub-list from 5 bullets to 3 (drop the "omit files marked (new)" bullet — already obvious; merge the path-relativity rule into one sentence)
  - Step 7 (task split): keep the split rules and the phase-transition momentum-break callout; trim the extended "here's how I'd split" narrative to a single example line
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

---

### Phase 3 — Compress pair-programming: Task Handoff Protocol

> **Deliverable:** Task Handoff Protocol trimmed from ~1,500 words to ~700. The long example blocks (handback format, review format, guiding-when-stuck examples) are each reduced to one compact exemplar. No rules removed.

- [X] **3.1 [M] Compress "When the AI is driving"**
  - Keep steps 1–5 as numbered items
  - Step 4 handback example: reduce to a 4-line block (currently 8+ lines with multiple sub-keys); keep the ✅/What changed/Why/Look closely at structure
  - Step 5 discussion window: compress to 3 sentences — rule, engagement expectation, continuation signal
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **3.2 [M] Compress "When the user is driving"**
  - Step 1b (orienting questions): keep the 4-bullet list; remove the closing "aim for enough orientation" paragraph — already implied by the list
  - Step 2 (navigator work): keep the 4 sub-bullets; trim each to one sentence (currently 2–3 sentences each)
  - Steps 3–4 (review): keep review format example; trim the Rules paragraph after it to 2 sentences
  - "When stuck" sub-section: keep the 3 guiding examples but remove the opening 2-paragraph setup — state the rule in one sentence instead
  - Pushback example: keep as-is (it's already compact)
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

---

### Phase 4 — Compress pair-programming: remaining large sections

> **Deliverable:** Plan Revision, When the User Is in the Flow, and Environment/Infrastructure Blockers trimmed by ~40%. Anti-patterns list compressed into grouped rules.

- [X] **4.1 [M] Compress "Plan Revision During the Session"**
  - "When to trigger" list: keep all 8 bullets; remove prose preamble ("No plan survives...")
  - "How to raise it": keep the two examples; cut the paragraph before them ("Surface the issue clearly...")  — it is restated in the examples
  - "Where to place new tasks": compress 3 bullets + narrative to 2 bullets
  - "Scope: small vs structural" table: keep as-is (already compact)
  - "When the user steps outside the plan": compress to 4 sentences; the "explicit plan drop" sub-case is already covered by the flow section — cross-link rather than repeat
  - "Editing conventions": keep all 5 rules but trim prose on each to one sentence
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **4.2 [M] Compress "When the User Is in the Flow"**
  - "Recognizing it": keep 4 bullets; trim closing paragraph to one sentence
  - "AI behavior during the flow": keep 4 bullets; trim each to one sentence
  - "Re-engagement": keep the 7-step checklist; compress the check-in block examples (single-phase drift and multi-phase drift) — keep one example each but remove the opening setup paragraph
  - "Returning to structured mode": compress to 3 bullets; remove the closing explanatory sentence
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **4.3 [S] Compress "Environment and Infrastructure Blockers"**
  - Keep the 3-step "when read-only evidence is not enough" protocol
  - Trim to one example block (currently two — they illustrate the same rule); keep the clearer one (the `NU1605` blocker example)
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **4.4 [M] Compress and group anti-patterns**
  - Current list has ~30 single-sentence bullets. Group into 5 named clusters with a one-sentence header each:
    1. **Start/flow violations** (split not agreed, crossing phase boundaries, momentum → execution, readiness question → execution)
    2. **Review integrity** (memory-based review, rubber-stamping, undoing without asking)
    3. **Plan integrity** (unilateral edits, reflowing numbering, silently absorbing divergence)
    4. **File / marker hygiene** (stale file references, bare AC comments, DEVENV survivors)
    5. **Command / confirmation** (auto-running write commands, `gh` directly, batching checkboxes)
  - Keep each individual rule inside its group — just remove standalone preamble text and merge near-duplicate items
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

---

### Phase 5 — Replace duplicate blocks in both skills with links

> **Deliverable:** Both pair-programming and delegation replace their inline "Always Work From Current Files", "AC Review Gate", and "Phase Completion Gate" sections with a 2–3 sentence summary + link to the shared reference files created in Phase 1. Net reduction: ~600 words from pair-programming, ~550 words from delegation.

- [X] **5.1 [M] Replace duplicate blocks in pair-programming with references**
  - Replace `## Always Work From Current Files` with a 2-sentence summary + `[Full rule](./references/file-freshness.md)`
  - Replace `## AC Review Gate` with a 4-bullet summary of the 5 steps + `[Full gate](./references/phase-gates.md#ac-review-gate)`
  - Replace `## Phase Completion Gate` with the checklist (5 items) + `[Full gate](./references/phase-gates.md#phase-completion-gate)` — keep the checklist inline since it's used as a literal run-through
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **5.2 [M] Replace duplicate blocks in delegation with references**
  - Replace `## Always Work From Current Files` with same 2-sentence summary + link
  - Replace `## AC Review Gate` with same 4-bullet summary + link
  - Replace `## Phase Completion Gate` with checklist + link
  - Files: `.github/skills/devenv-delegation/SKILL.md`

---

### Phase 6 — Compress delegation: Session Kickoff and During a Phase

> **Deliverable:** Delegation session kickoff trimmed from ~1,170 words to ~600. "During a Phase" trimmed from ~810 words to ~450. The failure-investigation protocol is the main target in "During a Phase" — it has two lengthy examples illustrating the same rule.

- [X] **6.1 [M] Compress delegation Session Kickoff steps 1–5b**
  - Steps 1/1b (load plan, drift check): same compression as pair-programming 2.1 — keep sub-steps, trim prose preamble
  - Step 1c (AC criteria): same compression as pair-programming 2.2 — one compact example
  - Steps 2–3 (scope, suitability): suitability table and decision rules are already compact; trim the "skill-switching requires a new invocation" callout to one sentence
  - Steps 4–5b (file links, decision flags): same compression as pair-programming 2.3
  - Files: `.github/skills/devenv-delegation/SKILL.md`

- [X] **6.2 [M] Compress "During a Phase"**
  - Task progress pings: keep 3-line example as-is
  - Mid-phase stop triggers: keep "stop for / don't stop for" structure; trim each bullet to one sentence
  - Surfacing concerns: compress "blocking vs non-blocking" distinction to 3 sentences with one example
  - Failure investigation: keep the 3-step protocol; drop one of the two example blocks (they illustrate the same rule — keep the `NU1605` one)
  - Coverage drop protocol (try → surface → bypass): keep all three steps; trim step 2's quoted example to 3 lines
  - Files: `.github/skills/devenv-delegation/SKILL.md`

---

### Phase 7 — Compress create-implementation-plan summaries

> **Deliverable:** Phase Rules summary and Task Formatting Rules summary in `create-implementation-plan/SKILL.md` trimmed to remove content that duplicates the reference files they already point to. Net ~150 word reduction — modest, but the summaries currently include explanatory prose that belongs only in the references.

- [X] **7.1 [S] Trim Phase Rules summary**
  - Currently 9 bullets with explanatory prose. Reduce to 7 crisp imperative bullets — each one sentence
  - Remove the "Coverage escape hatch" bullet body prose (already in `phase-rules.md`); replace with one sentence + link
  - Files: `.github/skills/devenv-create-implementation-plan/SKILL.md`

- [X] **7.2 [S] Trim Task Formatting Rules summary**
  - Currently a code block + 2 paragraphs. Keep the code block; remove the explanatory paragraph below it (already in `task-format.md`)
  - Files: `.github/skills/devenv-create-implementation-plan/SKILL.md`

---

### Phase 8 — Cleanup & docs

> Final verification. No new behavior changes. Confirms word counts hit targets, all links resolve, and no behavioral rules were accidentally dropped.

- [X] **8.1 [S] AC Review** — scan for `[AC-N]` DEVENV comments in code (`grep -rn "\[AC-" .`); verify each AC against current skill files; run `markdown-plan-complete-ac` for each objectively verifiable criterion.
- [X] **8.2 [S] Remove all DEVENV markers** — `grep -rn "DEVENV\[" .` must return zero results
- [X] **8.3 [S] Verify word counts (Phases 1–8 targets)**
  - `wc -w .github/skills/devenv-pair-programming/SKILL.md` → ≤ 7,500
  - `wc -w .github/skills/devenv-delegation/SKILL.md` → ≤ 3,800

- [X] **8.6 [S] Verify word counts (Phases 9–13 targets)**
  - `wc -w .github/skills/devenv-gather-requirements/SKILL.md` → ≤ 4,200
  - `wc -w .github/skills/devenv-create-blueprint/SKILL.md` → ≤ 2,900
  - `wc -w .github/skills/devenv-redesign-component/SKILL.md` → ≤ 2,200
  - `wc -w .github/skills/devenv-create-technical-design/SKILL.md` → ≤ 2,100
  - `wc -w .github/skills/devenv-design-discussion/SKILL.md` → ≤ 2,000
  - `wc -w .github/skills/devenv-tech-debt-audit/SKILL.md` → ≤ 2,200
  - `wc -w .github/skills/devenv-refine-requirements/SKILL.md` → ≤ 1,700

- [X] **8.7 [S] Verify cross-cutting canonicalization**
  - `grep -rn "Q-NNN" .github/skills/devenv-gather-requirements/SKILL.md .github/skills/devenv-create-technical-design/SKILL.md .github/skills/devenv-redesign-component/SKILL.md` — must each show a single-sentence summary + link, not a format block
  - `grep -rn "Explore subagent" .github/skills/devenv-gather-requirements/SKILL.md .github/skills/devenv-create-blueprint/SKILL.md .github/skills/devenv-refine-requirements/SKILL.md` — must each show link to `_conventions.md`
- [X] **8.4 [S] Verify all cross-file links still resolve**
  - Grep for `](./references/` and `](../` in modified files; confirm each target exists
- [X] **8.5 [S] Smoke-check behavioral completeness**
  - For each removed or compressed section, confirm the behavioral rule is still present (either inline or via reference link) — use a checklist derived from AC-3

---

### Phase 9 — Cross-cutting shared references

> **Deliverable:** Three new entries in `_conventions.md` (or new shared reference files) that eliminate copy-paste across at least three skills each. No skill file edits yet — purely additive.
>
> **Orientation:** Three patterns appear verbatim or near-verbatim in three or more SKILL.md files: the Q-NNN open questions log format, the Explore subagent dispatch protocol, and the GitHub issue creation flow. All three are currently duplicated and diverge over time.

- [X] **9.1 [S] Add Q-NNN log format to `_conventions.md`**
  - Currently inline in: `devenv-gather-requirements`, `devenv-create-technical-design`, `devenv-redesign-component` (and possibly others)
  - Extract the canonical format block (status transitions, column meanings, example) and append it to `_conventions.md` under a new `## Open Questions Log (Q-NNN)` heading
  - Files: `.github/skills/_conventions.md`

- [X] **9.2 [S] Add Explore subagent dispatch protocol to `_conventions.md`**
  - Currently inline in: `devenv-gather-requirements` (Phase 1 communications handling), `devenv-create-blueprint` (Phase 1 Step 1), `devenv-refine-requirements` (Step 2 source material)
  - The pattern is: "prefer dispatching the Explore subagent, one invocation per artifact in parallel, with a structured prompt covering [fields]; surface summary back for confirmation before using"
  - Add under a new `## Explore subagent dispatch` heading in `_conventions.md`; include the standard prompt template
  - Files: `.github/skills/_conventions.md`

- [X] **9.3 [M] Create `references/github-issue-creation.md` shared reference**
  - The GitHub issue creation flow (5 steps: new or existing? → draft title → draft body → show preview → post on confirmation) appears near-identically in `devenv-create-technical-design` (Phase 8), `devenv-redesign-component` (Phase 7), and `devenv-design-discussion` (`## Output document`)
  - Create `.github/skills/devenv-pair-programming/references/github-issue-creation.md` with the canonical 5-step protocol; include all three skill-specific variants for title format and body boilerplate as named sub-sections
  - Place in `devenv-pair-programming/references/` so it is sibling to the other shared references and loadable from any skill via `../devenv-pair-programming/references/github-issue-creation.md`
  - Files: `.github/skills/devenv-pair-programming/references/github-issue-creation.md` (new)

---

### Phase 10 — Compress gather-requirements (6,100w → ~4,000w)

> **Deliverable:** `devenv-gather-requirements/SKILL.md` reduced from ~6,100 words to ~4,000. The largest skill outside pair-programming. Two large sections (`## Requirement Episodes` and the multi-document project guidance) are off-critical-path content that bloats every invocation of the skill.
>
> **Orientation:** Section word counts: `## Process` 2247w, `## Requirement Episodes` 808w, `## Output File` 510w (of which ~350w is the multi-doc splitting guidance and Index.md template). The `## Process` section is dense and behavioral; compress only where prose is explanatory rather than procedural.

- [X] **10.1 [M] Extract `## Requirement Episodes` to a reference file**
  - Create `devenv-gather-requirements/references/episodes-guide.md` with the full section text including voice/tone guidance, what episodes are not for, REQ-NNN reference mechanisms, and the footer format block
  - Replace inline section with: a 3-sentence summary of what episodes are and when to write them + `[Full episodes guide](./references/episodes-guide.md)`
  - Savings: ~700w inline
  - Files: `.github/skills/devenv-gather-requirements/references/episodes-guide.md` (new), `.github/skills/devenv-gather-requirements/SKILL.md`

- [X] **10.2 [M] Extract multi-document project guidance to a shared reference**
  - The multi-doc project section in `## Output File` (~350w for splitting rules + Index.md template) and the equivalent section in `devenv-create-blueprint/SKILL.md` (`## Output File` multi-doc splitting, ~350w) cover the same pattern from their respective angles
  - Create `devenv-gather-requirements/references/multi-doc-projects.md` with the canonical multi-doc conventions: prefix scheme, per-epic session memory, cross-doc dependency edges, Index.md structure and rules; include the Index.md markdown code block example
  - Replace the gather-requirements inline content with 3 bullets + link; replace the create-blueprint inline content with 2 sentences + link to the same reference
  - Savings: ~270w in gather-requirements, ~300w in create-blueprint
  - Files: `.github/skills/devenv-gather-requirements/references/multi-doc-projects.md` (new), `.github/skills/devenv-gather-requirements/SKILL.md`, `.github/skills/devenv-create-blueprint/SKILL.md`

- [X] **10.3 [M] Compress Phase 1 interview questions and Explore subagent block**
  - Phase 1 Step 1: the "ask about human communications" block and the 4-step Explore protocol (~200w) — replace with 1-sentence rule + `(see [Explore subagent dispatch](<link>))` pointing at the `_conventions.md` entry from Phase 9.2
  - Phase 1 probe questions: the "then probe deeper" list (5 bullets) + the actor/scenarios/scope prose (~300w total) — compress to a flat 10-bullet question list with no prose preamble
  - Savings: ~350w
  - Files: `.github/skills/devenv-gather-requirements/SKILL.md`

- [X] **10.4 [S] Replace Q-NNN log format with link**
  - Replace inline Q-NNN format block in Session Continuity section with 1 sentence + `(see [Q-NNN format](<link>))` pointing at the `_conventions.md` entry from Phase 9.1
  - Savings: ~80w
  - Files: `.github/skills/devenv-gather-requirements/SKILL.md`

---

### Phase 11 — Compress create-blueprint (3,982w → ~2,800w)

> **Deliverable:** `devenv-create-blueprint/SKILL.md` reduced from ~3,982 words to ~2,800. Primary target is Phase 2's repeated per-step confirmation instructions and the multi-doc splitting content (handled in Phase 10.2).
>
> **Orientation:** Phase 2 has 9 steps. Each step ends with a variant of: "Ask the user to confirm before recording. Update the file before proceeding." The collaborative rule is stated once at the top of Phase 2 — but then repeated in abbreviated form at the bottom of every step. Removing the per-step repetitions recovers ~400w while the master rule retains the behavior.

- [X] **11.1 [M] Remove per-step confirmation repetitions in Phase 2**
  - The master "collaborative rule" callout at the start of Phase 2 reads: "At every decision point below, propose options with trade-offs and ask the user to decide." Followed by per-step closings like "Ask the user to confirm before recording. Update the file (§4.1 Component entries) before proceeding." — this appears at the end of Steps 2, 3, 4, 5, 6, 7, 8.
  - Strengthen the master rule to include the file-update instruction, then remove the per-step confirmation/update sentences
  - Keep the per-step example blocks (they illustrate trade-off format); remove only the redundant directive sentences
  - Savings: ~350w
  - Files: `.github/skills/devenv-create-blueprint/SKILL.md`

- [X] **11.2 [S] Replace Explore subagent block in Phase 1 with link**
  - Phase 1 Step 1 and Phase 1 Step 4 both contain Explore subagent dispatch instructions (~150w each)
  - Replace with 1-sentence rule + link to `_conventions.md` entry from Phase 9.2
  - Savings: ~250w
  - Files: `.github/skills/devenv-create-blueprint/SKILL.md`

- [X] **11.3 [S] Replace Q-NNN format with link**
  - Replace inline Q-NNN format in Session Continuity with link to `_conventions.md` entry from Phase 9.1
  - Savings: ~80w
  - Files: `.github/skills/devenv-create-blueprint/SKILL.md`

---

### Phase 12 — Compress redesign-component and create-technical-design

> **Deliverable:** `devenv-redesign-component/SKILL.md` reduced from ~3,128w to ~2,100w. `devenv-create-technical-design/SKILL.md` reduced from ~2,806w to ~2,000w. Both skills have large output-format template sections embedded in the SKILL.md that belong in reference files.
>
> **Orientation:** redesign-component has separate top-level sections (`## Problem Statement`, `## Proposed Redesign--NNN.md coverage`, `## Redesign Doc Format`, plus sub-sections `## Why this redesign`, `## What changes`, `## What stays the same`, `## Acceptance criteria`, `## Target architecture`) totalling ~1,200w of output template content. create-technical-design has `## Proposed Architecture_and_implementation.md structure` at ~545w.

- [X] **12.1 [M] Extract redesign-component output templates to a reference**
  - Move `## Problem Statement`, `## Proposed Redesign--NNN.md coverage`, `## Redesign Doc Format` (and all their sub-sections: `## Why this redesign`, `## What changes`, `## What stays the same`, `## Acceptance criteria`, `## Target architecture`) to `devenv-redesign-component/references/redesign-doc-template.md`
  - Replace inline with: a 2-sentence description of what the doc contains + `[Document format](./references/redesign-doc-template.md)`; add a note that Phase 5 uses the coverage template and Phase 6 uses the doc format
  - Savings: ~1,100w inline
  - Files: `.github/skills/devenv-redesign-component/references/redesign-doc-template.md` (new), `.github/skills/devenv-redesign-component/SKILL.md`

- [X] **12.2 [M] Extract create-technical-design output structure to a reference**
  - The `## Proposed Architecture_and_implementation.md structure` section (showing the 9-section doc skeleton) is 545w and serves as a template reference — extract to `devenv-create-technical-design/references/architecture-doc-structure.md`
  - Replace inline with: the section number list as a compact 9-item bullet list + `[Full structure](./references/architecture-doc-structure.md)`
  - Savings: ~400w inline
  - Files: `.github/skills/devenv-create-technical-design/references/architecture-doc-structure.md` (new), `.github/skills/devenv-create-technical-design/SKILL.md`

- [X] **12.3 [S] Replace Q-NNN and GitHub issue flows with links**
  - Both skills: replace Q-NNN log format with link to `_conventions.md` (~80w each)
  - Both skills: replace GitHub issue creation steps 1–5 with a 1-sentence + link to `references/github-issue-creation.md` from Phase 9.3 (~180w each)
  - Savings: ~520w total
  - Files: `.github/skills/devenv-redesign-component/SKILL.md`, `.github/skills/devenv-create-technical-design/SKILL.md`

---

### Phase 13 — Compress design-discussion, tech-debt-audit, refine-requirements

> **Deliverable:** `devenv-design-discussion/SKILL.md` reduced from ~2,599w to ~1,900w. `devenv-tech-debt-audit/SKILL.md` reduced from ~2,761w to ~2,100w. `devenv-refine-requirements/SKILL.md` reduced from ~2,035w to ~1,600w.

- [X] **13.1 [M] Compress design-discussion `## Output document`**
  - The GitHub issue creation steps 1–5 (~220w) have been canonicalized in Phase 9.3 — replace with 1-sentence + link
  - The doc naming/location rules (~100w) are similar to other skills; compress to 4 bullets
  - `## Process` section (933w): read and compress the options/trade-offs presentation format (~200w savings); the repeated "push back if..." instructions can be folded into a single rule rather than repeated per-step
  - Target: `## Output document` 460w → ~120w; `## Process` 933w → ~700w
  - Savings: ~570w
  - Files: `.github/skills/devenv-design-discussion/SKILL.md`

- [X] **13.2 [M] Compress tech-debt-audit `## GitHub integration`**
  - `## GitHub integration` section (549w) covers creating/updating a GitHub issue after writing the audit. The 5-step issue creation protocol duplicates Phase 9.3 — replace with link
  - The remaining content (how to post the executive summary as a comment, how to handle guiding instructions from an issue body) can be compressed from ~350w to ~120w
  - Input detection table (348w): the table is compact and useful; trim only the prose explanation around it (~60w)
  - Target: ~660w reduction across `## GitHub integration` and `## Input detection`
  - Files: `.github/skills/devenv-tech-debt-audit/SKILL.md`

- [X] **13.3 [M] Compress refine-requirements `## Workflow`**
  - `## Workflow` is 1,126w — disproportionate relative to the skill's 2,035w total
  - Step 2 (interview) Explore subagent block: replace with link to `_conventions.md` entry from Phase 9.2 (~80w)
  - Step 3 (hard rules) verbosity: the five hard rules have explanatory prose; compress each to 2 sentences max (~150w savings)
  - Step 4b (episode staleness check): an edge case sub-step (~200w); compress the rewriting guidance to 3 bullets
  - Savings: ~400w
  - Files: `.github/skills/devenv-refine-requirements/SKILL.md`

---

### Phase 14 — Reduce pair-programming session-start overhead

> **Deliverable:** `devenv-pair-programming/SKILL.md` — session kickoff steps produce less unsolicited output. Brain bootup and task-split proposals become opt-in. Phase boundary preamble and file-link rules trimmed. Target: ~400w reduction from kickoff sections.

- [X] **14.1 [S] Make brain bootup opt-in**
  - Currently §6b runs automatically every phase and the user must choose not to engage with it
  - New rule: skip §6b by default; only run if (a) the user explicitly asks ("catch me up", "bootup:", "orient me") or (b) session memory shows this is first contact with the codebase
  - Remove the `bootup:` reply instruction from the output (it becomes the trigger keyword instead)
  - Saves ~100w of output per phase transition in normal use
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **14.2 [S] Make task-split proposal opt-in**
  - Currently §7 always proposes a split table and waits for approval before touching any file
  - New rule: default to asking "Which task should we start with?" rather than proposing a full split table; only produce the table if the user says "suggest a split" or there are 4+ tasks with mixed owners
  - Keep the hard rules (never cross phase boundaries, respect `owner:`, stop and wait for agreement) — only remove the automatic table output
  - Saves ~100w of output per phase start in normal use
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **14.3 [S] Trim phase file links preamble and verbose rules**
  - §5 "Emit phase file links" has a 60-word momentum-reset preamble that fires every phase transition
  - The formatting rules (workspace-root-relative paths, one line, dot-separated, group if >8 files) are ~60w of instruction that rarely changes behavior
  - Compress the preamble to a single sentence; compress formatting rules to 2 bullets
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

- [X] **14.4 [S] Trim orient-new-user section (§4b)**
  - §4b "Orient the user if they're new to pairing" fires only on first session but still costs tokens every load
  - Compress from 75w to ~30w — keep the core offer but drop the explanatory prose
  - Files: `.github/skills/devenv-pair-programming/SKILL.md`

---

## Contextual Information

### Problem Context

Skill files are loaded in full into the model context at invocation time. Pair-programming at ~11k words consumes a significant fraction of available context before any code is loaded. The goal is to recover context headroom for actual implementation work without reducing behavioral precision.

### Solution Context

Three complementary approaches:
1. **Canonicalization** — duplicate policy blocks extracted into shared reference files; skills link to the canonical version
2. **Prose compression** — rationale paragraphs and setup text trimmed; rules kept as imperative bullets
3. **Example reduction** — multiple examples illustrating one rule reduced to one compact exemplar

Anti-goal: removing or weakening behavioral rules. Every rule that currently exists must remain present and enforceable after this plan completes — either inline or via a direct reference link that loads with the skill.

### Forces

- **Context window pressure**: pair-programming is the largest single-skill consumer
- **Behavioral precision**: the rules added over recent sessions are all load-bearing; they must not be casualty of compression
- **Reference file loading**: `references/` files under a skill folder are loaded when the skill is invoked — pushing to references does not hide content from the model
- **Maintenance**: canonical single-source blocks are easier to update consistently

### Target Sizes

| Skill | Current (w) | Target (w) | Reduction |
|---|---|---|---|
| devenv-pair-programming | 11,041 | ≤ 7,500 | ~32% |
| devenv-delegation | 4,955 | ≤ 3,800 | ~23% |
| devenv-gather-requirements | 6,100 | ≤ 4,200 | ~31% |
| devenv-create-blueprint | 3,982 | ≤ 2,900 | ~27% |
| devenv-redesign-component | 3,128 | ≤ 2,200 | ~30% |
| devenv-create-technical-design | 2,806 | ≤ 2,100 | ~25% |
| devenv-design-discussion | 2,599 | ≤ 2,000 | ~23% |
| devenv-tech-debt-audit | 2,761 | ≤ 2,200 | ~20% |
| devenv-refine-requirements | 2,035 | ≤ 1,700 | ~17% |
| devenv-create-implementation-plan | 2,013 | ≤ 1,700 | ~15% |

### Reference Information

**Key files:**

| File | Relevance |
|---|---|
| `.github/skills/devenv-pair-programming/SKILL.md` | Primary target — largest file, most reduction potential |
| `.github/skills/devenv-delegation/SKILL.md` | Secondary target — duplicate policy blocks |
| `.github/skills/devenv-gather-requirements/SKILL.md` | Third-largest; Episodes and multi-doc content are off-critical-path |
| `.github/skills/devenv-create-blueprint/SKILL.md` | Phase 2 repeated patterns, multi-doc content |
| `.github/skills/devenv-redesign-component/SKILL.md` | Large output template sections inline |
| `.github/skills/devenv-create-technical-design/SKILL.md` | Output structure section inline |
| `.github/skills/devenv-design-discussion/SKILL.md` | Output document + GitHub issue flow |
| `.github/skills/devenv-tech-debt-audit/SKILL.md` | GitHub integration section |
| `.github/skills/devenv-refine-requirements/SKILL.md` | Workflow verbosity |
| `.github/skills/devenv-create-implementation-plan/SKILL.md` | Minor trim — summary sections only |
| `.github/skills/_conventions.md` | Receives Q-NNN format and Explore subagent pattern (Phase 9) |
| `.github/skills/devenv-pair-programming/references/` | Target folder for new shared reference files |
