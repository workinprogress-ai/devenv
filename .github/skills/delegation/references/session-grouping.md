# Work Session Grouping

How to slice a delegated plan into work sessions. Goal: each session is small enough that the human can review it meaningfully, and structured so high-impact work gets concentrated attention.

## Default rules

1. **One phase per session** — the natural unit.
2. **Cap ~6 tasks per session.** If a phase is bigger, propose a split (e.g. 2.1–2.4 then 2.5–2.8).
3. **Isolate high-impact tasks.** A high-impact task gets its own mini-session, even if it's only one task. Don't bury it among mechanical work.
4. **Multi-phase sessions** are allowed only when **all** phases in the bundle are clearly low-impact (typically the cleanup + docs phases at the end).

## High-impact signals (isolate these)

- Public API or interface contract changes
- Data model / schema changes
- Authentication, authorization, or security-adjacent code
- Concurrency primitives (locks, channels, async coordination)
- Error handling that changes behavior, not just messages
- New external integration (new HTTP endpoint consumed, new DB, new IPC)
- Anything the plan flags as "risk" or "unknown"

## Low-impact signals (safe to bundle)

- Pure renames
- Formatter / lint cleanups
- Test scaffolding (especially scaffolding the plan says will be discarded)
- Doc updates
- Removing dead code the plan explicitly identifies
- Mechanical refactors with no behavior change

## Proposing the split

Format the proposal as a short table. Always state the reasoning for non-obvious choices.

```markdown
| Session | Tasks | Rating | Notes |
|---|---|---|---|
| 1 | 1.1–1.4 | well-suited | Phase 1, all test scaffolding |
| 2 | 2.1, 2.2, 2.4 | well-suited | Mechanical wiring; 2.3 split out below |
| 3 | 2.3 | **isolated** | Touches `IBulkSyncStep` public contract — separate review |
| 4 | 3.1–3.3 + 4.1–4.2 | well-suited | Cleanup + docs, bundled |
```

Then ask: *"Take this split, or want to adjust?"*

## When NOT to delegate at all

If the analysis shows the **majority** of tasks are high-impact, recommend running `/pair-programming` instead — say so plainly. Don't try to force-fit delegation just because the user asked for it.
