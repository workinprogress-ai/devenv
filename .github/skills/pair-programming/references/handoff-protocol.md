# Handoff Protocol — Phrasings

Concrete language patterns for the pair-programming handoff. Use these as-is or adapt; the goal is consistency so the user always knows what state we're in.

## State signals

The session is always in one of these states. Make the state visible.

| State | Who's working | Signal |
|---|---|---|
| **Planning** | Both, talking | "What's next?" / "Want to split the next batch?" |
| **AI implementing** | AI | "Starting `<task>`." |
| **AI awaiting review** | User | "Done with `<task>`, ready for review." |
| **User implementing** | User | "Got it, you're on `<task>`. I'll wait." |
| **User awaiting review** | AI | (User pings; AI reviews and replies.) |
| **Wrap-up** | Both | "Want to wrap here? Here's where we are…" |

## AI as implementer

### Confirm assignment
>
> "Taking 2.1 — adding retry policy to BulkSyncWorker. You're on 2.2?"

### Announce start
>
> "Starting 2.1."

### Mid-task ask (no-assumptions)
>
> "Quick ask before I commit to this — should the retry honour `Retry-After` headers, or use our standard exponential backoff regardless? Plan doesn't specify."

### Hand back for review
>
> "Done with 2.1, ready for review.
>
> **Changed**: `BulkSyncWorker.cs` (added `RetryPolicy` field + wired into `PostAsync` call), `BulkSyncWorkerRetryTests.cs` (new file, 4 cases).
>
> **Reasoning**: Used Polly because it's already a transitive dep via `lib.cs.flow.try-chain`. Jitter multiplier is 0.3 — picked it without precedent, please scrutinize.
>
> **Specifically check**: the 429 vs 5xx branching; the test for `Retry-After` is a happy-path only."

## AI as reviewer

### Acknowledge user's task
>
> "Got it, you're on 2.2. I'll wait. Ping me if you want me to look anything up."

### Reviewing the diff

First: actually run `get_changed_files` and read the diff. Then respond with structure:

> "Reviewed your 2.2.
>
> **What works**: handler signature matches the existing `IBulkSyncStep` pattern; cancellation token is honoured.
>
> **Concerns**:
>
> - The `null` check on line 47 swallows what looks like a real error case — was that intentional?
> - No test for the empty-batch path; coverage will drop on this file.
>
> **Nits** (ignore if you want): variable name `tmp` on line 53.
>
> Approve once you address the empty-batch test, or push back if I'm wrong about line 47."

### Pushback
>
> "Pushing back on that. Swallowing the exception means we'll never know when sync silently breaks, and the existing telemetry hooks in this module specifically log retryable failures. Want me to log + rethrow, or log + return a typed failure result?"

### Calling out rubber-stamping (significant work only)
>
> "You approved that pretty fast — the change touches the public `IBulkSyncStep` contract. Want me to slow down and walk through the implications, or are you good?"

(Skip this for renames, formatting, or pure mechanical refactors.)

## Saying "I don't know"

> "I don't know how the existing retry behaviour interacts with the daemon's circuit breaker. Want me to dig into `lib.cs.engine.daemon` first, or do you already know?"

## Wrap-up

> "Want to wrap here?
>
> **Done**: 1.1, 1.2, 2.1, 2.2 (all reviewed + approved).
> **In flight**: 2.3 (yours, half written).
> **Left**: phase 3, phase 4 cleanup.
> **Deferred**: the logging refactor we noticed in 2.1 — not in scope, want me to file it as a follow-up issue?
>
> Next session probably starts at 2.3."
