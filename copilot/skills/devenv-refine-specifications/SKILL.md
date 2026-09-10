---
name: devenv-refine-specifications
description: 'Revise an existing Specifications-*.md after stakeholder priorities shift, new actors or scenarios surface, a spike invalidates an assumption, or implementation discovery exposes gaps. USE WHEN the user says "refine/update the specifications", "the specifications need updating", hands off a stale specifications doc, hands off issue number(s) describing a needed specifications change (upstream-impact work orders or issues from any source) or asks to work the upstream-impact queue, or a change spans specifications and blueprint (cascade mode — one session edits both). Preserves SPEC-NNN IDs and dependency links, appends rather than reflows, deletes superseded items clean (the why lives in ADRs; the document carries target state only). If intake reveals a non-surgical change, stop and recommend /devenv-write-specifications continuation mode. DO NOT USE for creating a specifications doc (use /devenv-write-specifications), brainstorming broad changes (use /devenv-write-specifications continuation mode), ad-hoc one-line edits (just edit the file), or blueprint-only revision (use /devenv-refine-blueprint — cascade mode here covers changes spanning both).'
argument-hint: 'Path to a Specifications-*.md file'
user-invocable: true
---

# Refine Specifications

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

Revise an existing specifications document based on new information — stakeholder priorities that shifted, new actors or scenarios that surfaced, a spike that invalidated an assumption, or implementation discovery that exposed gaps. Preserve every prior decision and ID; never silently rewrite history.

**This skill is how specifications stay living.** Specifications are not point-in-time artifacts gathered once and frozen — they are the system's current functional truth, kept accurate as reality moves. Refinement is the normal, expected maintenance path for that truth: when the world changes, the specifications change with it (surgically, with IDs stable and history recorded), so downstream artifacts — blueprints, roadmaps, plans — can trust what they read. A specifications document that no longer matches reality is a defect in the document, not a footnote.

Write specification items body sections as the current target behaviour and constraints. Keep historical change narrative out of the document entirely — the document is target state, period. Rationale for significant changes lives in ADRs (`docs/Decisions/`, see the shared [ADR template](../common/references/adr-template.md)); git records when. If a legacy `## Revision History` section exists from an older workflow version, migrate its still-relevant entries into ADRs and delete the section.

## When to Use

- The user has a `Specifications-*.md` that needs new specifications, revised acceptance criteria, new actors/scenarios, scope adjustments, or re-grouped priorities
- A previous `/devenv-write-specifications` run is now out of date
- A spike, blueprint, or implementation discovery surfaced specification items facts the doc didn't anticipate
- New human communications (transcripts, emails, meeting notes) arrived after the original interview

Use this skill when the user already knows the intended change direction and wants that change applied safely.

If the user is still exploring options or rethinking the shape of the specification set, route to [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md) in continuation mode (pass the existing specifications file path).

If no specifications doc exists, stop and redirect to [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md).

## Inputs

The user provides one of:

- **A file path** — e.g. `docs/Specifications/Specifications-orders-001.md`.
- **Issue number(s)** — any issue whose body describes a needed specifications change, whatever its origin. Queue work orders (`upstream-impact` label, filed by grooming, execution closeouts, spikes, plan refinement) carry the predictable body format ("what changed, why, affected sections") and load straight in via `issue-get <N> --pretty`. Issues from any other source (users, stakeholders, ad-hoc) are equally valid input — read the body, extract the intended change, and confirm the direction with the reporter if it's ambiguous. Either way, follow the [cross-artifact cascade protocol](../common/references/cross-artifact-cascade.md)'s issue-intake loop.
- **The upstream-impact queue** — "work the queue" / no specific issue: `issue-list --label upstream-impact`, present, let the architect pick all/some, then loop per issue.

Plus optionally the file path when an issue references a specific doc. At intake, run **span detection** (cascade protocol): if the change alters both what the system does and how it is shaped, enter **cascade mode** — this session drives both the specifications and the blueprint edits under the shared protocol, with ADRs recording significant decisions. Either refine skill can drive; entry choice only picks the home document.

Also offer queue consumption on any entry: "N open upstream-impact issues in this repo — fold them into this session?"

For multi-document projects (one doc per epic), refine **one doc per invocation** for doc-scoped changes. Cascade mode supersedes this when the change spans artifacts (a cross-epic cascade runs once against all affected docs).

## Splitting an oversized specifications doc

If the doc has grown past ~30 specification items or now covers what feels like multiple epics, the user may ask to split it. Treat splitting as a special refinement:

1. Interview: confirm split boundary, new `<topic>` names, new prefix per doc.
2. Create new docs by copying source, then **delete** non-belonging specification items from the source doc and re-prefix specification items that stay (e.g. `SPEC-007` → `ORD-007`). No inline tombstones.
3. Update the source doc accordingly: moved specification items are simply gone; the split rationale goes in an ADR if significant.
4. Walk all cross-doc `Depends on:` lines and update to new IDs and doc paths.
5. Update session memory for each new doc.
6. Create or update `Index.md`. See [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md) §*Index.md for multi-file artifacts*.
7. If a roadmap exists, suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) for stale STEP-NN → SPEC-NNN backreferences.

## Updating Index.md on plain refinements

If the project already has an `Index.md` (multi-doc project) and a refinement adds, removes, or supersedes a cross-doc dependency edge, **update `Index.md` in the same pass** so its cross-doc dependency section stays accurate.

## Workflow

### 0. Surgical-vs-non-surgical triage

Before interviewing for edits, quickly classify the requested change.

Treat as **non-surgical** when any of these is true:

- The user signals broad rethink language: "rethink", "redesign", "what if we changed direction", "let's brainstorm"
- The change appears to affect multiple sections at once (vision + specification items + priority groups) with unclear final direction
- The request introduces multiple tensions that need option-weighing before edits are known
- The likely impact is wide and uncertain (many dependencies/IDs likely affected, but replacement decisions are not yet settled)

If non-surgical:

1. Stop direct edit flow.
2. Explain why: this is discovery/brainstorming, not direct refinement.
3. Recommend [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md) continuation mode with the same file path.
4. Offer one explicit confirmation gate: continue anyway with direct edits, or switch to gather now.

If surgical, continue with the workflow below.

### 1. Load and parse

- Read the file. Identify all top-level numbered sections (`## 1. Vision`, `## 2. Specification Items`, `## 3. Priority Groups`, etc.).
- Run `spec-dependency-check <doc>` for the authoritative inventory: `SPEC-NNN` IDs (with their category prefix scheme), the dependency edges between them, and `GROUP-NN` group-order violations — no hand-walking of `Dependencies:` lines.

### 2. Interview the user about what changed

Use `vscode_askQuestions` to gather:

- **What's new** — actors, scenarios, specification items, constraints, scope items to add
- **What's wrong** — sections whose descriptions or acceptance criteria are now misleading
- **What's no longer relevant** — sections to delete clean (IDs never reflow; the why, if significant, goes in an ADR)
- **What changed priority** — specification items moving between `GROUP-NN`s, or the MVP definition shifting
- **Open questions** — "Are there open questions from the original gathering session that were deferred and can now be resolved? Are there new ambiguities or tensions this refinement introduces?"
- **Source material** — "Are there meeting transcripts, email threads, recordings, voice memos, or other communications records behind these changes? If so, where are they?"

If the user provides communications artifacts, summarise each one separately (prefer the `Explore` subagent, one invocation per artifact, in parallel where possible) with a prompt focused on stated goals, decisions reached, named actors, constraints mentioned, and concrete behaviours described. Surface each summary back for confirmation, then use the approved summaries to drive the change list. Note the source in the revision-history entry (step 4) so the rationale can be re-traced.

### 3. Apply changes — preserve everything

**Hard rules:**

- **Never reflow IDs.** `SPEC-007` stays `SPEC-007` for its lifetime. New specification items get the next sequential number per category prefix (e.g. `AUTH-008`, `ORD-014`) — resolve via `next-id --file <doc> --prefix '<PREFIX>-' --full`. Gaps from deleted items are expected and harmless.
- **Superseded specification items are deleted clean** — no strikethrough, no tombstone text. If the supersession is significant (a future implementer would ask why), write an ADR; otherwise delete silently. Update every `Dependencies:` reference pointing at the removed ID.
- **Rewrite acceptance criteria in place as current truth.** Updated criteria keep the specification item's ID; the document never carries prior-state narrative. Prior wording lives in git history and, when significant, an ADR.
- **Dependency links must stay valid.** If a specification item is superseded, walk every other specification item's `Dependencies:` line and update the link to point at the replacement (or remove the link). Verify with `spec-dependency-check <doc>` after the edit — it flags unknown references and cycles deterministically.
- **Priority groupings can be re-ordered freely** — they are stakeholder priority, not delivery sequencing. New specification items need to be placed into a group.
### 4. Internal consistency review

After applying all changes, run `spec-dependency-check <doc>` for the deterministic layer (unknown references, dependency cycles, group-order violations, broken SPEC-ID links), then scan the full updated specification set for semantic consistency. This step is especially important because refinements often introduce new tensions between new and existing specifications that weren't present in the original document.

Check for:

- **New contradictions introduced** — does any new or reworded specification item conflict with an existing one?
- **Acceptance criteria conflicts** — two specification items' Given/When/Then clauses producing incompatible outcomes for the same actor/scenario.
- **Dependency integrity gaps** — a new specification item depends on an existing one, but the existing specification item's acceptance criteria don't satisfy what the new one needs.
- **Scope boundary violations** — new specifications that cross the in-scope/out-of-scope boundary.
- **Supersession gaps** — a specification item was superseded but another specification item still depends on it without acknowledging the change.
- **Ambiguous shared terms** — a new term introduced that is already used elsewhere with a different meaning.

For each finding, surface a labelled `CONFLICT: SPEC-X vs SPEC-Y` block naming the tension. For each, offer: resolve inline, add to open questions, or accept as documented trade-off. **Do not write the file while known contradictions remain unresolved.**

### 4b. Episode staleness check

If an `Episodes-<topic>-NNN.md` companion file exists, check whether any changed specification items are illustrated in it:

1. Read the episodes file.
2. For each specification item that was added, reworded, or superseded in this refinement, check whether it appears in any episode's "Specification Items illustrated" footer or inline links.
3. Mark stale episodes with a notice at the top of that episode:

   ```markdown
   > ⚠️ **Stale** — specification items illustrated by this episode have changed since it was written. Review before relying on it. Affected: [SPEC-014](#spec-014), [SPEC-019](#spec-019)
   ```

4. Surface the stale episodes to the user:

   > *"Episodes 2 and 4 illustrate specification items that changed in this refinement ([SPEC-014](#spec-014), [SPEC-019](#spec-019)). I've marked them stale. Would you like me to update them now, or batch that for a later session?"*

**Rewriting episodes is deliberate, not automatic.** Batch updates until specification items are stable. When rewriting: keep character names, places, and tone — only change what is now factually wrong.

### 5. Write the result

Overwrite the file in place. The user can `git diff` to review and revert.

### 6. Record significant decisions as ADRs

For any change where a future implementer would ask *why* (supersession of a specification item, a priority flip driven by stakeholder review, a split, a cascade decision), write an ADR using the shared [ADR template](../common/references/adr-template.md) into `docs/Decisions/`. Trivial edits need no ADR — git records them. The specifications doc itself never carries change history.

### 7. Surface downstream impacts

After writing, list what may need follow-up:

- **Blueprint impact**: a new specification item may require new components or revised deltas → suggest [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md)
- **Roadmap impact**: a new specification item, or a moved priority group, may require new or re-sequenced roadmap steps → suggest [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md)
- **Plan impact**: existing plans may now reference superseded specification items → suggest [`/devenv-refine-plan`](../devenv-refine-plan/SKILL.md) for affected plans
### 8. Offer a stability audit

If the user signals the specifications are approaching final form (incremental refinements, statements like "I think we're almost done", or a series of sessions producing diminishing structural changes), offer a stability audit:

> *"This refinement looks incremental — we might be approaching a stable doc. Would you like to run a stability audit? It's a top-to-bottom scan, typically 1–4 rounds, that ends with an explicit stability declaration. Worth doing before this feeds into planning or implementation."*

See the stability audit protocol in [`/devenv-write-specifications` § Stability Audit](../devenv-write-specifications/SKILL.md#stability-audit-final-convergence-review).
## Anti-patterns

- Silently overwriting acceptance criteria
- Reflowing IDs (breaks links from blueprints, roadmaps, plans, and issues)
- Keeping superseded specification items as strikethrough or tombstone text — delete them clean; an ADR holds the why when it matters
- Rewriting the specifications doc from scratch — that's [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md), not refine
- Forcing non-surgical, brainstorm-heavy changes through this skill instead of escalating to [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md) continuation mode
- Writing prior-state narrative in specification item bodies — the document is target state; prior wording lives in git history and ADRs
- **Skipping the internal consistency review.** Refinements routinely introduce new tensions between new and old specification items — always check.
- **Writing the file while known contradictions remain unresolved.** Every conflict finding must be resolved, accepted as a documented trade-off, or explicitly logged before writing.
- Treating Phase 3 priority groups as a delivery roadmap (delivery sequencing belongs in [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md))
- Forgetting to surface blueprint, roadmap, and plan impact after the edit
- **Silently ignoring stale episodes** when specification items change — always check for a companion episodes file and mark stale episodes.
- **Rewriting episodes mid-stream** before the specifications are stable — batch episode updates to the end of a refinement cycle.

## Sibling Skills

- [`/devenv-write-specifications`](../devenv-write-specifications/SKILL.md) — to create a new specifications doc from scratch, or to brainstorm broad/non-surgical changes in continuation mode
- [`/devenv-create-roadmap`](../devenv-create-roadmap/SKILL.md) — to create a roadmap (and GitHub issues) from the refined specification items; supports a specification items-only mode when no blueprint exists
- [`/devenv-refine-blueprint`](../devenv-refine-blueprint/SKILL.md) — when changes have architectural implications
- [`/devenv-refine-roadmap`](../devenv-refine-roadmap/SKILL.md) — when changes affect delivery sequencing of an existing roadmap
- [`/devenv-refine-plan`](../devenv-refine-plan/SKILL.md) — when changes affect an in-flight plan

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
