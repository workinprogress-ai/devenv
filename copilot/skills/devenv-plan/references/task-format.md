# Task Formatting Rules

## Canonical format

```
- [ ] **N.N [S|M|L] Task title**
  - Files: `workspace-root-relative/path/File.cs`, `workspace-root-relative/path/FileTests.cs`
  - decision: <the choice to make, and why it's non-obvious> (only if applicable)
  - owner: User | AI  (omit when either party can take it — that's the default)
  - commit: `<suggested conventional subject>` (unit: N.M–N.M) (only if applicable)
  - depends on N.N (only if applicable)
  - Additional context: <task-specific nuance, edge case, or execution note>
```

The task title is **bolded** and is the primary execution step. Keep task lines concise and concrete. Include `Files:` by default for execution-facing plans. Use `decision:` and `depends on` only when they materially improve execution clarity.

`Additional context:` lives directly under the task it describes. Keep it short and practical so readers do not need to jump to another section to understand the task.

### Size labels `[S/M/L]`

Every task carries a size label immediately after the task number:

- `[S]` — ≤ 30 min, mechanical, clear scope, no judgment calls
- `[M]` — 30 min – 2 h, some judgment, a few moving parts
- `[L]` — > 2 h, complex; consider splitting

Size is an estimate for pair-split planning, not a hard SLA. If a task turns out larger than `[S]`, record the surprise in the session summary.

### Condensed step style

Task lists should be compact and current-state friendly:

- Prefer 3-6 tasks per phase.
- Each task line should read like one concrete execution step.
- Include `Files:` by default; add other metadata only when needed for handoff clarity.
- Keep any extra detail under `Additional context:` for that task instead of creating separate context sections.

If a task description needs multiple implementation bullets to be understandable, split it into separate tasks or move the extra detail into linked additional context.

### `Files:` bullet

List every file the task **reads or modifies** (including test files), using paths relative to the **workspace root** (the top-level folder open in VS Code). Example:

```
- Files: `repos/<your-service>/src/MyWorker.cs`, `repos/<your-service>/tests/MyWorkerTests.cs`
```

Rules:

- Workspace-root-relative only — never `src/...` or absolute paths.
- Include test files. Omit files the task merely reads without changing.
- New files that don't exist yet are listed with a `(new)` suffix: `` `repos/.../IRetryPolicy.cs` (new) ``.
- Used by pair-programming and delegation to auto-generate **Files in scope** links at phase kickoff.

### `decision:` bullet

Add a `decision:` bullet when a task requires a non-obvious design choice that should be discussed before (or explicitly at the start of) implementation:

```
- decision: exponential vs. fixed backoff — need to agree on multiplier before coding
```

Rules:

- One sentence describing the choice and why it's non-obvious.
- A task may have multiple `decision:` bullets.
- Signals to the AI: stop and ask before making the choice silently.
- Signals to pair-programming: this task should be human-led or discussed at handoff.

### `owner:` bullet

Add an `owner:` bullet when a task strongly belongs to one party:

```
- owner: User
```

- `User` — must be driven by the human; involves design intent, domain judgment, or a decision only the user can make
- `AI` — mechanical or boilerplate work the AI should take by default
- *(omit)* — either party can take it; this is the default and no bullet is needed

Rules:

- Omit when either party can reasonably take the task.
- Discovery-oriented Phase 1 tasks usually default to `AI` when they are read-only or mechanical (coverage inventory, seam tracing, fixture setup). Do not force `AI` when domain judgment is required.
- `User` tasks are surfaced by pair-programming when proposing the task split; the AI will not unilaterally take them.
- Pair-programming and delegation both respect this annotation when proposing splits.

### `commit:` bullet

Under a plan declaring `commit_alignment: commit-aligned` (see the plan header field; `commit-free` plans carry none), add a `commit:` bullet on the task that **closes an intended commit unit**:

```
- commit: `feat: sync schema types` (unit: 3.1–3.3)
```

Rules:

- The subject is a suggestion in conventional form; [`/devenv-commit`](../../devenv-commit/SKILL.md) crafts the real message at commit time and aligns with it when the staged work matches the unit.
- The optional `(unit: N.M–N.M)` span names the task range the commit closes; omit it when the unit is the single task carrying the bullet.
- Place it on the unit's **last** task — the point where the unit is complete and the declared gates are green. A unit that spans a phase boundary closes at its end, wherever that lands.
- The `.100` phase-gate task may carry one for the phase-closing commit (see [phase-rules.md](./phase-rules.md) for the interaction rules).
- Individually mergeable is not created by this bullet — it is already the law under rebase merges ([Commit Conventions](../../../../docs/Commit-Conventions.md)). The bullet declares, ahead of time, where the planner judges those mergeable units to sit. Reality may split one declared unit into multiple commits or defer a point; that is a deviation recorded at the handback, not an error.
- Under `commit-free`, no `commit:` bullets are written; [`/devenv-commit`](../../devenv-commit/SKILL.md) judges granularity from the diff post-hoc, as it always has.

## Numbering

- First number = phase. `1.x` = Phase 1, `2.x` = Phase 2, ...
- Second number = task within the phase, starting at 1.
- Sub-tasks extend the series: `1.3.1`, `1.3.2`, `1.3.3`.
- **Phase-gate tasks are pegged at `.100`.** A task that always sits last in its phase — a phase gate (run the declared verification, close the phase) — is numbered `.100` (e.g. `1.100`); a second and third such gate-adjacent task take `.101`, `.102`. The reserved range keeps ordinary appended work (`.4`, `.5`, ...) collision-free below the gate for the plan's lifetime — appending never renumbers the gate.
- Task numbering is numeric-only. Do not use alphabetic suffixes such as `1.3a` or `2.4b`.
- Numbering is stable unless a structural revision inserts work in the middle of an existing task series. In that case, renumber downstream tasks from the insertion point onward and update in-plan references; otherwise, prefer inserting with a sub-number instead (e.g. add `1.3.4` rather than reflowing `1.4`).

## Atomicity

Each task should be:

- **Discrete** — one clear deliverable.
- **Implementable as a whole** — no "and then..." that hides a second deliverable.
- **Verifiable** — the executor knows when it's done (passing test, file exists, command succeeds, etc.).
- **Discovery deliverables state the write, not the topic** — when a task's output is findings, phrase the completion signal as an immediate plan write ("record in Phase Notes on confirmation"), never the deferral-ambiguous "record findings as phase notes";  findings are what passes the reproduction test (a redoing agent would need them); a finding held only in working memory until phase close is lost to compaction or a long phase.

If a task can't be expressed as one concise step line, it probably needs to be split, or its detail belongs in `Additional context:` under that task.

## Parallelism

- No explicit "parallel" annotation.
- Mark blockers as `depends on N.N`.
- Anything in the same phase without a `depends on` between them may be done in parallel.

## Writing additional context

When a task needs more detail than a concise step line can carry, place that depth directly under the task with `Additional context:`:

```markdown
- [ ] **2.2 [M] Wire retry policy into MyWorker**
  - Files: `repos/<your-service>/src/MyWorker.cs`
  - depends on 2.1
  - Additional context:
    - Edge cases: 429 vs 5xx; jittered backoff; honor `Retry-After` header.
    - Tests to add: `MyWorkerRetryTests` covering each case.
```

## Good vs. bad examples

### Good

```markdown
- [ ] **1.2 [S] Add empty-payload behavior-locking test if existing coverage is insufficient**
  - Files: `repos/<your-service>/tests/MyWorkerTests.cs`
  - Additional context: Validate behavior for both empty arrays and null payloads.
```

Why it's good: bold title, sized, concrete step, files listed, and task context directly under the task.

```markdown
- [ ] **2.3 [M] Choose and implement retry backoff strategy**
  - Files: `repos/<your-service>/src/MyWorker.cs`, `repos/<your-service>/src/IRetryPolicy.cs` (new), `repos/<your-service>/tests/MyWorkerRetryTests.cs`
  - decision: exponential vs. fixed backoff — need to agree on multiplier before coding
  - depends on 2.2
```

Why it's good: the task line is concrete, and `decision:` flags the design choice so the AI stops and asks rather than guessing.

### Bad

```markdown
- [ ] 1.2 Fix bulk sync and clean up logging
```

Why it's bad: two deliverables, no size, no files, and no acceptance signal.

### Bad

```markdown
- [ ] **1.2 [S] Add failing test and refactor sync pipeline and update docs and fix retry edge cases**
```

Why it's bad: multiple deliverables collapsed into one noisy line; split this into separate concise tasks.
