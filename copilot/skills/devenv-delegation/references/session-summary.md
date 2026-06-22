# Session Summary Template

Use this format at the end of every work session (and when aborting mid-session). The **review hotspots** section is the most important — it's where the human's attention should focus.

## Template

```markdown
## Session N summary — <phase or scope>

### What was done
- 2.1 — <one-line description>
- 2.2 — <one-line description>
- 2.4 — <one-line description>

### Files changed
- [path/to/file1.cs](path/to/file1.cs) — added retry policy
- [path/to/file2.cs](path/to/file2.cs) — wired worker
- [path/to/file1.tests.cs](path/to/file1.tests.cs) — 4 new tests

### Review hotspots
- [BulkSyncWorker.cs:142](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs#L142) — picked exponential backoff with jitter=0.3 without precedent; sanity-check the multiplier
- [RetryPolicy.cs:28](repos/lib.cs.services.bulk-sync/src/RetryPolicy.cs#L28) — new error-handling branch for 429 vs 5xx; behavior diverges from the existing `try-chain` pattern
- [BulkSyncWorkerTests.cs:67](repos/lib.cs.services.bulk-sync/tests/BulkSyncWorkerTests.cs#L67) — `Retry-After` test only covers happy path

### Decisions made
- **Used Polly** instead of writing retry from scratch — already a transitive dep via `lib.cs.flow.try-chain`. Plan didn't specify; flagged this on 2.1.
- **Did not** honour `Retry-After` headers — plan called for "standard backoff regardless"; confirmed with you mid-session.

### Open questions / low confidence
- Not sure whether the daemon's circuit breaker interacts with the new retry policy. Didn't dig into `lib.cs.engine.daemon`. Worth a look before merging.

### Suggested next session scope
- Phase 3 (3.1–3.3): wiring the new policy into the remaining workers. All mechanical, well-suited for delegation. ~4 tasks, single session.
```

## Hotspot bullet format

Each hotspot bullet must contain:

1. A **clickable link** to the exact `file:line` (workspace-relative path, `#L<num>` anchor).
2. A **one-sentence reason** the human should look here.

Bad (too vague):

```markdown
- BulkSyncWorker.cs — please review
```

Good:

```markdown
- [BulkSyncWorker.cs:142](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs#L142) — picked exponential backoff with jitter=0.3 without precedent; sanity-check the multiplier
```

## When to flag a hotspot

Any of:

- AI made a non-obvious choice
- Public API surface changed
- A test was loosened, skipped, or weakened
- New error handling / retry / fallback logic
- AI had low confidence on this code
- External integration boundary (HTTP, DB, filesystem, IPC) was touched

If a session has **zero** hotspots, say so explicitly — don't omit the section. Zero hotspots is a meaningful signal ("all mechanical, nothing surprising").

## After delivering the summary

Wait. Do not start the next session. The user reviews and either:

- Accepts → proceed to next session, or wrap up if last.
- Pushes back → fix per feedback, then re-summarize the same session.

## Issue comment offer

After the summary, **offer** to post a status comment on the parent issue:

> "Want me to post this summary as a comment on issue #N?"

Show the proposed comment text (usually the summary itself, possibly trimmed to highlights). Wait for explicit "yes" before running `issue-comment <N> --body-file <path>`.
