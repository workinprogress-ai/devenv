# Bug Hunt Report Template

Written to the target repo root as `bug-hunt-<topic>.md` (numbered `bug-hunt-NNN-<topic>.md` when multiples accumulate). Neutral voice — the hunter persona stays in conversation.

```markdown
# Bug Hunt Report — <topic>

- verdict: FOUND | NOT-FOUND | INCONCLUSIVE (if INCONCLUSIVE: + lead status — no lead | strong lead)
- target_repo: <repo path>
- hunted_utc: <ISO date>
- hunter: /devenv-bug-hunter

## Oracle

- **Observation:** <what was observed, verbatim where possible>
- **Expectation:** <the declared expectation — what should have happened instead>

## Verdict

<One paragraph: the conclusion and the evidence basis for it.>

## Evidence (FOUND only)

### Causal chain

<Step-by-step path from trigger to symptom, with file:line links.>

- <[`File.cs:42`](path/to/File.cs#L42) — what happens here>
- <...>

### Reproduction

<If a failing test was produced: its name, file, and how to run it. It is RED — it fails for the hypothesized reason and passes when the cause is locally neutralized.>

<If no test was writable: maximal reproduction specifics — exact steps, inputs, environment, expected vs. actual, run-to-run variability.>

## Investigation Coverage (NOT-FOUND / INCONCLUSIVE only; include in FOUND when useful)

<What was hunted, what died, and why. For INCONCLUSIVE with a strong lead: name the primary suspect, the traced partial chain, the specific missing discriminator, and what would raise it to FOUND — fix directions here are labeled unconfirmed.>

| Hypothesis | Outcome | Evidence |
|---|---|---|
| <H1: user's theory> | eliminated | <probe/test/trace result> |
| <H2: ...> | eliminated | <...> |
| <H3: ...> | confirmed, if FOUND | <...> |

### Not covered

<Unexplored avenues and WHY they were not explored — access, environment, effort. NOT-FOUND coverage is bounded; this section makes the boundary explicit.>

## Recommendations

<Verdict-dependent:>

- FOUND: preserve the repro test before any restore, then run `/devenv-bug-fix` with this report. The repro is its starting artifact.
- NOT-FOUND: conditions under which the suspicion would become real; what to watch for.
- INCONCLUSIVE: what evidence or access a follow-up hunt would need.

## Instrumentation Log

<Every temporary probe, log line, harness, and test added during the hunt, with its DEVENV marker and removal status. Must be empty-clean after cleanup.>
```
