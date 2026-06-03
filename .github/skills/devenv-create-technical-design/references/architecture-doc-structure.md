## Proposed Architecture_and_implementation.md structure

0. Scope and acceptance criteria — in/out of scope; observable ACs at the interface level
1. Overview — what this component does and why it exists
2. Context — where it fits in the wider system
3. Interface contract — exposed and consumed surfaces
4. Internal structure — layers, modules, entry points
5. Data model — owned state, entities, consistency
6. Error handling — error types, propagation, retry
7. Test strategy — unit / integration / contract split
8. Key decisions — recorded with rationale
9. Known unknowns — deferred Q-NNN items

Wait for the user to approve the structure. They may adjust sections or scope.

**Before writing, establish the scope and acceptance criteria.** These are the most important inputs for anyone picking up the work later — including `/devenv-plan-from-spec`. Ask:

> *"Before I write the doc, two quick questions:*
> *1. What's explicitly out of scope for this design? (Helps bound the implementation plan.)*
> *2. What does done look like from the outside? Name 2–4 observable behaviours the component must exhibit when the work is complete."*

If the interface contract work in Phase 2 already made the ACs obvious, infer them and present for confirmation rather than asking cold. Mark each `*(explicit)*` if stated by the user or `*(inferred)*` if derived from the contract.

**Then write `docs/Architecture_and_implementation.md`** in the component repo. Follow the [output format](#output-format) below.

If the file already exists (stub or prior version), show the user what will change and ask whether to update in place.

After writing and confirming with the user, ask:

> *"Want to track this in a GitHub issue? I can create a new one, or post the design to an existing issue number. The document will go in a comment; the description stays as a short placeholder for `/devenv-plan-from-spec`."*

If yes:

1. **New issue or existing?** Ask whether to create a new issue or use an existing one. If the user provides an issue number, skip to step 4.

2. **Draft the issue title** — propose and ask the user to confirm or adjust:
   - `Technical Design: <component name> — <YYYY-MM-DD>`

3. **Draft the issue body** (placeholder — design goes in the comment):
   ```
   Technical design document is in the first comment below.

   Next step: use `/devenv-create-implementation-plan` or
   `/devenv-plan-from-spec <issue number>` to generate a task-level implementation plan.
   Document file: `<workspace-relative path to docs/Architecture_and_implementation.md>`
   ```

4. **Show a preview** (title + body for new issues; first ~15 lines of the document content for existing) and ask:
   > *"Ready to post the design? (y/n)"*

5. On confirmation:

   **If creating a new issue:**
   - `issue-create --repo "$GITHUB_REPO" --title "<title>" --body "<body>"`
   - Note the new issue number.
   - Write the design document to a temp file.
   - `issue-comment <N> --body-file <temp-file>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Write the design document to a temp file.
   - `issue-comment-list <N>` — scan for an existing design comment (a comment whose body begins with `# Architecture and Implementation`).
   - If found: `issue-comment-update <COMMENT_ID> --body-file <temp-file>` (replaces the prior version).
   - If not found: `issue-comment <N> --body-file <temp-file>` (adds a new comment).
   - Surface the issue URL.

   The GH issue comment is the canonical record. The local `docs/Architecture_and_implementation.md` is the git-tracked working copy — both should be kept in sync.

Never create an issue or post a comment without explicit "yes" confirmation.

---

## Output Format

```markdown
# Architecture and Implementation — [Component Name]

> [One sentence: what this component does and why it exists.]

**Status:** [In design | Stable | Under revision]  
**Last updated:** [date]  
**Blueprint reference:** [link to relevant blueprint section, if any]

---

## Scope and acceptance criteria

**In scope:** [What this design covers — the bounded set of changes being made. Be explicit so that an implementation plan author knows where to start and stop.]

**Out of scope:** [What is explicitly excluded, even if adjacent or related.]

**Acceptance criteria:** Observable behaviours the component must exhibit when the work is done. Written at the interface level — not internal assertions.
- [ ] **AC-1** *(explicit | inferred)*
- [ ] **AC-2** *(explicit | inferred)*

---

## Context

[Where this component sits in the wider system. Which domain it belongs to. What problem it exists to solve. Cross-links to relevant blueprint, requirements, or sibling components.]

---

## Interface contract

### Exposed surface

[What this component provides to the outside world: HTTP endpoints, published events, consumed messages, exported API, config surface. Each item on one line with schema/shape noted briefly.]

### Dependencies

[What this component consumes from other components or infrastructure. Direction noted. Flag any backwards-pointing dependencies.]

---

## Internal structure

[Layers and their responsibilities. Key modules. Entry points for a reader new to the code. Keep at module/concept level — not a file list.]

---

## Data model

[Owned state. Key entities and relationships. Ownership boundary. Consistency guarantees. Evolution/migration strategy.]

---

## Error handling

[Expected error types. Propagation rules. Retry / idempotency. Graceful degradation. External error surface.]

---

## Test strategy

[Unit / integration / contract split. What the unit boundary is. What infrastructure is real vs. doubled in tests. Contract test ownership.]

---

## Key decisions

| Decision | Choice | Rationale | Trade-off accepted |
|---|---|---|---|
| [topic] | [what was chosen] | [why] | [what we gave up] |

---

## Known unknowns

[Any Q-NNN items deferred to a later session. Explicitly note what is unresolved and why it was deferred.]
```

---

