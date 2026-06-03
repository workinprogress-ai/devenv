## Problem Statement

**Symptoms:** [what the user observes going wrong]
**Root cause hypothesis:** [why the current design produces this, if known]
**Success criteria:** [what must be true after the redesign]
**Constraints:** [hard limits the new design must respect]
**Ruled out:** [incremental fixes that won't work and why]

Wait for the user to confirm or correct this summary before proceeding. This is the contract that Phase 2 will use as its evaluation criteria — it must be accurate.

---

### Phase 2 — Diagnosis

This phase uses the Problem Statement from Phase 1 as its evaluation criteria.

Work through the current design section by section. For each area, record one of three verdicts:

- **Keep as-is** — the current approach is correct and should not change
- **Update** — the approach is right but the implementation or specifics need adjustment (this is refinement territory — note it but don't redesign it)
- **Rethink** — the fundamental approach to this area is the problem

| Area | Verdict | Notes |
|---|---|---|
| Interface contract | | |
| Internal structure | | |
| Data model | | |
| Error handling | | |
| Test strategy | | |

Push back if the user marks everything as "rethink" without a connection back to the agreed problem statement. A diagnosis that produces "rethink everything" usually means the problem is narrower than it appears and hasn't been precisely located yet.

For each "rethink" verdict: require a brief explanation of what the current approach gets wrong and why an incremental fix won't do. Log open questions as Q-NNN.

---

### Phase 3 — Redesign Session

Run a focused design session covering only the areas marked "rethink" in the diagnosis. For areas marked "keep" or "update", carry forward the current design without reopening decisions.

For each section being redesigned, follow the same discipline as [`/devenv-create-technical-design`](../devenv-create-technical-design/SKILL.md) (brainstorm, push back, record decisions with rationale), with one addition: **for every new decision, also record why the old approach no longer holds relative to the agreed Problem Statement**.

**Interface Contract** *(if marked rethink)*

Redesign the component's public boundary:
- What changes in the exposed surface? (endpoints, events, messages, exported API)
- What changes in the consumed surface? (dependencies, direction)
- Is this a breaking change? If so, what is the migration/compatibility strategy?
- Log Q-NNN for unresolved interface questions.

**Internal Structure** *(if marked rethink)*

Redesign the interior at the module/layer level:
- What is the new layering? What responsibilities move?
- What are the new key modules?
- What are the new key types or domain concepts?
- What is the new entry point for a reader?

**Data Model** *(if marked rethink)*

Redesign the owned state:
- What changes about the persistent data?
- What is the migration strategy? (Schema migration, data transform, cut-over plan)
- Does the ownership boundary change?
- Log Q-NNN for migration questions.

**Error Handling** *(if marked rethink)*

Redesign the error strategy:
- What error types change?
- Does the propagation strategy change?
- Do retry / idempotency guarantees change?

**Test Strategy** *(if marked rethink)*

Redesign the test approach:
- Does the unit boundary change?
- Do integration test boundaries change?
- Are new contract tests needed?

---

### Phase 4 — Open Questions

For any Q-NNN still open after Phase 2:

1. Restate the question clearly
2. Offer 2–4 options with trade-offs
3. Ask the user to decide
4. Update Q-NNN to `resolved` or `deferred`

Do not move to Phase 5 while critical design questions remain open.

---

### Phase 5 — Draft the Redesign Doc

Before writing anything, show the user a summary for approval:

```
## Proposed Redesign--NNN.md coverage

### What changes
- [Area]: [old approach] → [new approach] — [why old no longer holds]
- ...

### What stays the same
- [Area]: [kept approach]
- ...

### Target architecture sketch
- Interface contract: [key changes or "unchanged"]
- Internal structure: [new shape in a sentence]
- Data model: [key changes or "unchanged"]

### Acceptance criteria (proposed)
- AC-1: ...
- AC-2: ...
```

Ask the user to confirm scope and coverage — particularly the acceptance criteria and what's explicitly out of scope. Wait for explicit approval before proceeding to Phase 6.

---

### Phase 6 — Write

Write `Redesign--NNN.md` to the workspace root (default) or component repo root — ask the user which, default workspace root so it is easy to pass to `devenv-plan-from-spec`. Use the [redesign doc format](#redesign-doc-format) below.

**Do not modify `docs/Architecture_and_implementation.md`.** It stays as-is, accurate to the current code.

If `docs/Architecture_and_implementation.md` has a **Status** field, set it to `Under revision` — this signals to readers that a redesign is in progress without changing any design content. Reset to `Stable` in the Cleanup phase.

---

### Phase 7 — Wrap-up

After writing the file, give the user a brief summary:

- The key decisions made: what changes, what stays, and why the old approach no longer holds
- Any Q-NNN items resolved or deferred
- The path to `Redesign--NNN.md`
- **Suggested next step:** run [`/devenv-plan-from-spec`](../devenv-plan-from-spec/SKILL.md) and pass `Redesign--NNN.md` as the input spec to generate a concrete implementation plan
- **Reminder about `Architecture_and_implementation.md`:** it has been marked `Under revision` but not changed. The implementation plan's Cleanup phase must include a task: *"Update `Architecture_and_implementation.md` using the `## Target architecture` section of `Redesign--NNN.md` as the source — use `/devenv-refine-technical-design` for this."*

Then ask:

> *"Want to track this in a GitHub issue? I can create a new one, or post the redesign doc to an existing issue number. The document will go in a comment; the description stays as a short placeholder for `/devenv-plan-from-spec`.'"*

If yes:

1. **New issue or existing?** If the user provides an issue number, skip to step 4.

2. **Draft the issue title** — propose and ask the user to confirm or adjust:
   - `Redesign: <component name> — <YYYY-MM-DD>`

3. **Draft the issue body** (placeholder — redesign doc goes in the comment):
   ```
   Redesign document is in the first comment below.

   Next step: run `/devenv-plan-from-spec <issue number>` to generate a concrete implementation plan from the redesign doc.
   ```

4. **Show a preview** (title + body for new issues; first ~15 lines of the document content for existing) and ask:
   > *"Ready to post the redesign doc? (y/n)"*

5. On confirmation:

   **If creating a new issue:**
   - `issue-create --repo "$GITHUB_REPO" --title "<title>" --body "<body>"`
   - Note the new issue number.
   - Write the redesign doc to a temp file.
   - `issue-comment <N> --body-file <temp-file>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Write the redesign doc to a temp file.
   - `issue-comment-list <N>` — scan for an existing redesign comment (a comment whose body begins with `# Redesign:`).
   - If found: `issue-comment-update <COMMENT_ID> --body-file <temp-file>` (replaces the prior version).
   - If not found: `issue-comment <N> --body-file <temp-file>` (adds a new comment).
   - Surface the issue URL.

   The GH issue comment is the canonical record. The local `Redesign--NNN.md` is a working copy.

Never create an issue or post a comment without explicit "yes" confirmation.

---

## Redesign Doc Format

```markdown
# Redesign: [Component Name]

**Component:** [component name]  
**Repo:** [workspace-relative path]  
**Architecture doc:** [link to Architecture_and_implementation.md] ← marked `Under revision`; do not use as reference for the new design — use `## Target architecture` below  
**Date:** [date]  
**Related issue:** [GH issue # if any, otherwise omit]

---

## Why this redesign

[What the current approach gets wrong. Crisp and specific — 2–5 bullets. This is the "problem statement" that guided the design session.]

---

## What changes

[One subsection per area being redesigned. Skip areas that are keeping their current approach.]

### [Area — e.g. Internal Structure]

**Current approach:** [brief description of what the component currently does in this area]  
**New approach:** [what it will do instead]  
**Why the current approach no longer holds:** [concise rationale]  
**Migration concern:** [any backward-compat, data migration, or cut-over consideration — omit if none]

---

## What stays the same

[Explicit list of what is NOT changing. This bounds the scope and prevents the implementation plan from drifting into territory that doesn't need to change.]

---

## Acceptance criteria

[How we know the redesign is complete. Observable behaviour that must still work. New behaviour that must work. Use `**AC-N**` identifiers.]

- [ ] **AC-1** *(explicit | inferred)*
- [ ] **AC-2** *(explicit | inferred)*

---

## Target architecture

> This section describes what `Architecture_and_implementation.md` should say **after** implementation is complete.
> Use this as the source when running `/devenv-refine-technical-design` in the Cleanup phase.

### Overview
[One sentence: what this component does and why it exists — post-redesign.]

### Interface contract

**Exposed surface:** [post-redesign exposed surfaces]

**Dependencies:** [post-redesign consumed surfaces]

### Internal structure
[Post-redesign layering and key modules.]

### Data model
[Post-redesign owned state and key changes from today.]

### Error handling
[Post-redesign error strategy — only if it changes; otherwise "unchanged".]

### Test strategy
[Post-redesign test approach — only if it changes; otherwise "unchanged".]

### Key decisions
| Decision | Old choice | New choice | Rationale | Trade-off accepted |
|---|---|---|---|---|
| [topic] | [old] | [new] | [why old no longer holds] | [what we gave up] |
```

---

