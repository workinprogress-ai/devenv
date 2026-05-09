# Task Formatting Rules

## Canonical format

```
- [ ] N.N Task title
  A brief paragraph or a few sentences explaining the task.
  - Optional bullet list of points
  - depends on N.N (only if applicable)
  - See [Additional context](#task-N-N) (only if non-trivial)
```

## Numbering

- First number = phase. `1.x` = Phase 1, `2.x` = Phase 2, ...
- Second number = task within the phase, starting at 1.
- Sub-tasks extend the series: `1.3.1`, `1.3.2`, `1.3.3`.
- Numbering is stable. Do not renumber tasks once a plan is in flight; insert with a sub-number instead (e.g. add `1.3.4` rather than reflowing `1.4`).

## Atomicity

Each task should be:

- **Discrete** — one clear deliverable.
- **Implementable as a whole** — no "and then..." that hides a second deliverable.
- **Verifiable** — the executor knows when it's done (passing test, file exists, command succeeds, etc.).

If a task can't be described in 1–3 sentences plus a short bullet list, it probably needs to be split, or its detail belongs in *Additional task context*.

## Parallelism

- No explicit "parallel" annotation.
- Mark blockers as `depends on N.N`.
- Anything in the same phase without a `depends on` between them may be done in parallel.

## Linking to additional context

When a task needs more than a short paragraph, push the depth into the *Additional task context* section and link to it:

```markdown
- [ ] 2.2 Wire retry policy into BulkSyncWorker
  Add the retry policy from 2.1 around the outbound HTTP call. Preserve existing
  cancellation token behaviour.
  - depends on 2.1
  - See [Additional context](#task-2-2)
```

…and in *Additional task context*:

```markdown
#### <a id="task-2-2"></a>2.2 Wire retry policy into BulkSyncWorker

Files: `repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs`.
Edge cases: 429 vs 5xx; jittered backoff; honour `Retry-After` header.
Tests to add: `BulkSyncWorkerRetryTests` covering each case.
```

## Good vs. bad examples

### Good

```markdown
- [ ] 1.2 Add failing test for empty-payload bulk sync
  Reproduce the bug: sending an empty payload currently throws
  `NullReferenceException`. Test should assert the new expected behaviour
  (no-op, returns success).
  - See [Additional context](#task-1-2)
```

Why it's good: one deliverable, verifiable, points to deeper context.

### Bad

```markdown
- [ ] 1.2 Fix bulk sync and clean up logging
```

Why it's bad: two deliverables, no acceptance signal, no context.

### Bad

```markdown
- [ ] 1.2 Add failing test for empty-payload bulk sync in
  BulkSyncWorker.cs around line 142 where we call
  `_httpClient.PostAsync(...)` — note that the existing test
  `BulkSyncWorkerTests.PostsPayload` mocks the HTTP client
  with Moq and uses a fixture defined in TestFixtures.cs ...
```

Why it's bad: noisy. All that detail belongs under *Additional task context*; the task line should stay scannable.
