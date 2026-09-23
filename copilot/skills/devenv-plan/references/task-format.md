# Task Formatting Rules

## Canonical format

```
- [ ] **N.N [S|M|L] Task title**
  - Files: `workspace-root-relative/path/File.cs`, `workspace-root-relative/path/FileTests.cs`
  - decision: <the choice to make, and why it's non-obvious> (only if applicable)
  - owner: User | AI  (omit when either party can take it — that's the default)
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
- Files: `repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs`, `repos/lib.cs.services.bulk-sync/tests/BulkSyncWorkerTests.cs`
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

## Numbering

- First number = phase. `1.x` = Phase 1, `2.x` = Phase 2, ...
- Second number = task within the phase, starting at 1.
- Sub-tasks extend the series: `1.3.1`, `1.3.2`, `1.3.3`.
- Task numbering is numeric-only. Do not use alphabetic suffixes such as `1.3a` or `2.4b`.
- Numbering is stable unless a structural revision inserts work in the middle of an existing task series. In that case, renumber downstream tasks from the insertion point onward and update in-plan references; otherwise, prefer inserting with a sub-number instead (e.g. add `1.3.4` rather than reflowing `1.4`).

## Atomicity

Each task should be:

- **Discrete** — one clear deliverable.
- **Implementable as a whole** — no "and then..." that hides a second deliverable.
- **Verifiable** — the executor knows when it's done (passing test, file exists, command succeeds, etc.).

If a task can't be expressed as one concise step line, it probably needs to be split, or its detail belongs in `Additional context:` under that task.

## Parallelism

- No explicit "parallel" annotation.
- Mark blockers as `depends on N.N`.
- Anything in the same phase without a `depends on` between them may be done in parallel.

## Writing additional context

When a task needs more detail than a concise step line can carry, place that depth directly under the task with `Additional context:`:

```markdown
- [ ] **2.2 [M] Wire retry policy into BulkSyncWorker**
  - Files: `repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs`
  - depends on 2.1
  - Additional context:
    - Edge cases: 429 vs 5xx; jittered backoff; honor `Retry-After` header.
    - Tests to add: `BulkSyncWorkerRetryTests` covering each case.
```

## Good vs. bad examples

### Good

```markdown
- [ ] **1.2 [S] Add empty-payload behavior-locking test if existing coverage is insufficient**
  - Files: `repos/lib.cs.services.bulk-sync/tests/BulkSyncWorkerTests.cs`
  - Additional context: Validate behavior for both empty arrays and null payloads.
```

Why it's good: bold title, sized, concrete step, files listed, and task context directly under the task.

```markdown
- [ ] **2.3 [M] Choose and implement retry backoff strategy**
  - Files: `repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs`, `repos/lib.cs.services.bulk-sync/src/IRetryPolicy.cs` (new), `repos/lib.cs.services.bulk-sync/tests/BulkSyncWorkerRetryTests.cs`
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
