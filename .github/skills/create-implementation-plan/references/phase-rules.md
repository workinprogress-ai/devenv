# Phase Rules

Phases exist so that work can be **paused, reviewed, and shipped** at clean boundaries. Every phase is a candidate commit / PR.

## Hard rules

1. **Phase 1 is always: Discovery & test scaffolding.**
   - Read code, confirm assumptions, write the tests that will drive later phases.
   - It is acceptable — and often desirable — to write tests here that will be **discarded or replaced** in a later phase. Catching problems early is the goal.

2. **The last phase is always: Cleanup & docs.**
   - Remove scaffolding tests no longer needed.
   - Update README / changelog / inline docs.
   - Verify coverage has not regressed.

3. **Every phase must end committable.** A phase is committable only if all of the following are true at the end of it:
   - All tests pass (existing + any added in this phase).
   - **Test coverage does not regress** vs. the start of the phase.
   - The build is green.

4. **If a phase can't satisfy the committable rule, split it.** Do not stretch the definition.

## Soft guidance

- Aim for 2–6 phases for a typical story. Fewer = phases too big; more = tasks probably belong inside fewer phases.
- Tasks within a phase that share no `depends on` may be parallelised by a pair.
- Prefer ordering that lets the riskiest unknowns be tested earliest (Phase 1 / Phase 2).
- Throwaway scaffolding (mocks, fakes, temporary endpoints, smoke tests) is fine as long as Phase N (Cleanup) explicitly removes it.

## Committability checklist (use at end of each phase)

- [ ] All tests pass locally
- [ ] Coverage report ≥ baseline taken at the start of the phase
- [ ] No TODOs left that block the next phase
- [ ] Diff is small enough for one focused PR review
- [ ] Any scaffolding added is either still needed, or scheduled for removal in a later phase's task list

## Anti-patterns

- A "Phase 0: setup" that just does config — fold it into Phase 1.
- A "final phase" that adds new behaviour instead of cleaning up — that's a real phase; add Cleanup after it.
- Phases that depend on **future** phases (cyclic) — re-order tasks until the dependency graph is a DAG flowing forward.
- Skipping the coverage check because "it's just a refactor" — refactors are exactly when regressions sneak in.
