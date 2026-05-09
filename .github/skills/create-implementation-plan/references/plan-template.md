# Implementation Plan Template

Copy this skeleton verbatim and fill it in. All top-level headings are required, even if a section is intentionally short ("None" / "N/A" is acceptable).

```markdown
# <Plan Title — short and specific>

<One paragraph: what this plan accomplishes and why. Enough context for a fresh
human or AI to understand the goal without opening other documents.>

## Task list

### Phase 1 — Discovery & test scaffolding

- [ ] 1.1 <Task title>
  <Brief paragraph explaining the task.>
  - <Optional bullet>
  - depends on <N.N> (omit if none)
  - See [Additional context](#task-1-1) (omit if not needed)

- [ ] 1.2 <Task title>
  <Brief paragraph.>

### Phase 2 — <Phase name>

- [ ] 2.1 <Task title>
  <Brief paragraph.>
  - depends on 1.2

- [ ] 2.2 <Task title>
  <Brief paragraph.>
  - See [Additional context](#task-2-2)

### Phase N — Cleanup & docs

- [ ] N.1 Remove scaffolding tests no longer needed
- [ ] N.2 Update README / changelog / inline docs
- [ ] N.3 Verify coverage has not regressed

## Contextual information

### Problem context

<What problem are we solving? Who is affected? What does success look like in
business / user terms?>

### Solution context

<Chosen approach at a high level. Key design decisions and the reasoning. Any
explicitly rejected alternatives and why.>

### Forces

<Bulleted list of constraints and pressures shaping the plan: existing
architecture, deadlines, performance requirements, compatibility, team
capacity, etc.>

- <Force 1>
- <Force 2>

### Additional considerations and notes

<Anything else worth knowing: known unknowns, follow-up work explicitly out of
scope, related issues, risks and mitigations.>

### Additional task context

<Per-task deep dives. Anchor each entry so tasks above can link to it.>

#### <a id="task-1-1"></a>1.1 <Task title>

<Detailed context: file paths, code references, edge cases, test ideas, links
to related code or docs. A future AI loading just this section should have
enough to execute the task.>

#### <a id="task-2-2"></a>2.2 <Task title>

<Detailed context.>

### Reference information

- <Link to GH issue, design doc, related PR, external spec, etc.>
- <Link>
```

## Notes on filling it in

- **Title** — name the outcome, not the activity. "Add bulk-sync retry policy" beats "Work on bulk-sync".
- **Opening paragraph** — assume the reader has zero prior context.
- **Phase boundaries** — each phase must end committable. If a phase can't, split it.
- **Additional task context anchors** — use HTML `<a id="task-N-N"></a>` so markdown links work in any renderer.
- **Reference information** — always include the GH issue link if one exists.
