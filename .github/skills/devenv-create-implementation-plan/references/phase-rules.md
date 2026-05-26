# Phase Rules

Phases exist so that work can be **paused, reviewed, and shipped** at clean boundaries. Every phase is a candidate commit / PR.

## Hard rules

1. **Phase 1 is always: Discovery & test scaffolding.**
   - Read code, confirm assumptions, write tests for the current state of the code.
   - Stubs (`throw new NotImplementedException()`, default returns, etc.) are valid — write tests that assert the **current observable behaviour**, including that a stub throws as expected. These tests are **not discarded** when implementation lands; they evolve to assert real behaviour.
   - Catching problems early is the goal. Code written with immediate test coverage tends to be better architected.

2. **The last phase is always: Cleanup & docs.**
   - Remove any temporary scaffolding code (not tests — tests evolve, not disappear).
   - Update README / changelog / inline docs.
   - Final check that coverage has not regressed across the whole plan.

3. **Every phase must end committable.** A phase is committable only if all of the following are true at the end of it:
   - All tests pass (existing + any added in this phase). **A phase may not end with intentionally failing tests.** If a test was written in the failing state first (TDD), the implementation that makes it pass must be in the same phase — the red-green cycle must close before the phase ends.
   - **Test coverage does not regress** vs. the start of the phase.
   - Tests added in this phase **assert observable behaviour** — a test that merely executes code without asserting anything does not count toward coverage.
   - The build is green.

4. **If a phase can't satisfy the committable rule without disproportionate cost, the exception path applies.** This is a last resort, not a routine escape:
   - State explicitly in the plan why the rule can't be met for this phase.
   - Accept a temporary coverage dip only when the cost of immediate testing genuinely outweighs the benefit (rare).
   - The next phase must restore coverage to at least the pre-exception baseline.

   **The user can override the coverage rule** for a given phase in two ways:
   - **Explicit rejection** — the user directly says the rule doesn't apply to this phase.
   - **Coverage exclusion** — the user opts to mark code with the appropriate language attribute (e.g. `[ExcludeFromCodeCoverage]` in C#, `/* istanbul ignore */` in TypeScript) to legitimately exclude it from measurement.

5. **Tests are written per-phase, not at the end.** Each phase's task list must include test tasks for what that phase introduces. Do not create a standalone "write tests" phase at the end — by then the code is hard to test and the discipline is already lost. If using a TDD red-green approach within a task, the full cycle (write failing test → implement → test passes) must complete within the same phase — do not write a failing test for behaviour that will only be implemented in a later phase.

## Soft guidance

- Aim for 2–6 phases for a typical story. Fewer = phases too big; more = tasks probably belong inside fewer phases.
- Tasks within a phase that share no `depends on` may be parallelised by a pair.
- Prefer ordering that lets the riskiest unknowns be tested earliest (Phase 1 / Phase 2).
- Temporary scaffolding code (mocks, fakes, test doubles, temporary endpoints) is fine as long as Phase N (Cleanup) explicitly removes the scaffolding code. Tests themselves are not scaffolding; they stay.

## Committability checklist (use at end of each phase)

- [ ] All tests pass locally
- [ ] Coverage report ≥ baseline taken at the start of the phase
- [ ] Tests added this phase assert observable behaviour (not just execute code)
- [ ] No TODOs left that block the next phase
- [ ] Diff is small enough for one focused PR review
- [ ] Any temporary scaffolding code added is either still needed, or scheduled for removal in a later phase's task list

## Anti-patterns

- A "Phase 0: setup" that just does config — fold it into Phase 1.
- A "final phase" that adds new behaviour instead of cleaning up — that's a real phase; add Cleanup after it.
- A standalone "write tests" phase at the end of the plan — tests belong inside each phase alongside the code they cover.
- Phases that depend on **future** phases (cyclic) — re-order tasks until the dependency graph is a DAG flowing forward.
- Skipping the coverage check because "it's just a refactor" — refactors are exactly when regressions sneak in.
- Tests that hit lines without asserting anything — these inflate coverage numbers but catch nothing.
- Writing failing tests for functionality to be implemented in a later phase — the TDD red-green cycle must complete within the same phase it starts. Tests written in Phase 1 must assert **current observable behaviour** (including "this stub throws as expected") and must pass at the end of Phase 1. Do not write a test that expects real behaviour the code does not yet have.
