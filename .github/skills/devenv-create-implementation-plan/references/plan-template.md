# Implementation Plan Template

Copy this skeleton verbatim and fill it in. All top-level headings are required, even if a section is intentionally short ("None" / "N/A" is acceptable).

```markdown
# <Plan Title — short and specific>

<One paragraph: what this plan accomplishes and why. Enough context for a fresh
human or AI to understand the goal without opening other documents.>

## Task List

### Phase 1 — Discovery & test scaffolding

> <One- or two-sentence preamble describing the deliverable, safety properties,
> and committability of this phase. Examples: "Additive-only changes. No
> behaviour changes to existing code paths. Coverage does not decrease.">

- [ ] **1.1 [S] <Task title>** ([additional context](#task-11--short-slug))
  - <Concrete sub-step or behavioural note>
  - <Another sub-step>
  - Files: `<workspace-root-relative/path/File.cs>`
  - depends on <N.N> (omit if none)

- [ ] **1.2 [M] <Task title>**
  - <Sub-step>
  - <Sub-step>
  - Files: `<workspace-root-relative/path/File.cs>`, `<workspace-root-relative/path/FileTests.cs>`

---

### Phase 2 — <Phase name>

> <Phase preamble: what gets delivered, what's gated, what stays green.>

- [ ] **2.1 [M] <Task title>**
  - <Sub-step>
  - <Sub-step>
  - Files: `<workspace-root-relative/path/File.cs>`
  - decision: <the choice to make, and why it's non-obvious> (omit if none)
  - depends on 1.2

- [ ] **2.2 [L] <Task title>** ([additional context](#task-22--short-slug))
  - <Sub-step>
  - <Sub-step>
  - Files: `<workspace-root-relative/path/File.cs>`, `<workspace-root-relative/path/NewFile.cs>` (new)

---

### Phase N — Cleanup & docs

> Final cleanup and documentation. Removes throwaway scaffolding from earlier
> phases, updates user-facing docs, and verifies coverage hasn't regressed.

- [ ] **N.1 [S] Remove scaffolding tests no longer needed**
- [ ] **N.2 [S] Update README / changelog / inline docs**
- [ ] **N.3 [S] Verify coverage has not regressed**

---

## Contextual Information

### Problem Context

<What problem are we solving? Who is affected? What does success look like in
business / user terms?>

### Solution Context

<Chosen approach at a high level. Key design decisions and the reasoning. Any
explicitly rejected alternatives and why.>

### Forces

<Bulleted list of constraints and pressures shaping the plan: existing
architecture, deadlines, performance requirements, compatibility, team
capacity, etc.>

- **<Force 1>**: <description>
- **<Force 2>**: <description>

### Additional Considerations and Notes

<Anything else worth knowing: known unknowns, follow-up work explicitly out of
scope, related issues, risks and mitigations.>

### Additional Task Context

<Per-task deep dives. Anchor each entry with a descriptive slug so tasks above
can link to it.>

#### <a id="task-11--short-slug"></a>1.1 — <Task topic>

<Detailed context: file paths, code references, edge cases, test ideas, links
to related code or docs. A future AI loading just this section should have
enough to execute the task.>

#### <a id="task-22--short-slug"></a>2.2 — <Task topic>

<Detailed context.>

### Reference Information

**Key files to understand before implementing:**

| File | Relevance |
|---|---|
| `<workspace-root-relative/path/File.cs>` | <Why this file matters; what to study; what pattern to follow.> |
| `<workspace-root-relative/path/Other.cs>` | <Relevance.> |

**Related links:**

- <GH issue, design doc, related PR, external spec, etc.>
- <Link>
```

## Notes on filling it in

- **Title** — name the outcome, not the activity. "Add bulk-sync retry policy" beats "Work on bulk-sync".
- **Opening paragraph** — assume the reader has zero prior context.
- **Phase preamble blockquotes** — every phase gets one. State the deliverable, what's gated/safe, and why the phase ends committable. This makes commit boundaries scannable.
- **Phase boundaries** — each phase must end committable. If a phase can't, split it.
- **Task headers** — bold, with size label, optional inline `(additional context)` link.
- **Sub-bullets first, metadata last** — descriptive sub-bullets describe the work; `Files:` / `decision:` / `depends on` come at the bottom of the bullet list.
- **Anchor slugs** — use `#task-NN--short-slug` (descriptive), not `#task-N-N` (opaque). Match with `<a id="task-NN--short-slug"></a>` in *Additional task context*.
- **Reference table** — prefer a "key files" table with a relevance column over a flat link list. Add a separate **Related links** sub-list for issues/docs/PRs.
- **Section heading case** — Title Case for `## Task List`, `## Contextual Information`, etc.
