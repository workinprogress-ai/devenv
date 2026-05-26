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

## Legacy cleanup strategies

The default approach is surgical: leave legacy code in place and incrementally introduce the new implementation. This keeps every phase committable and avoids coverage dips. However, when the two implementations would share the same files across multiple phases, the resulting **mixed code** is hard to review and reason about. A dedicated cleanup phase near the start of the plan is often cleaner than tolerating the mix.

### Signals that a clean-slate phase is warranted

- The same method, class, or module will contain both old and new logic simultaneously for more than one phase.
- Reviewers would need to understand both implementations to assess any single diff.
- The legacy code's complexity actively obscures what the new implementation is doing.

### Available patterns

**Pattern 1 — Demolition (delete code and its tests together)**

Delete the legacy implementation and its dedicated tests in one phase. Nothing hangs around.

- The next phase introduces the new implementation and new tests from scratch — TDD green from the start.
- **Coverage**: maintained — the deleted lines and their tests are removed together; nothing is left uncovered.
- **Best when**: the legacy code is self-contained (a class, a service, a namespace) and callers can be updated in the same phase or do not yet exist.

**Pattern 2 — Hollow-out (keep surface, replace internals with a deliberate stub)**

Preserve method/class signatures; replace bodies with `throw new NotImplementedException()` or a safe default return.

- **Hard rule**: the same phase that hollows out the code must also update or delete any test that previously asserted the old behaviour. A `throw` stub called by a surviving test leaves that test failing — that is not committable.
- Use `return default` (or an empty/identity value) when callers must not throw during the transition, but update tests to assert the stub's behaviour explicitly, not the old behaviour.
- **Best when**: the API surface must stay intact for callers that cannot be changed yet.

**Pattern 3 — Rename-then-replace (legacy suffix)**

Rename `FooService` → `LegacyFooService` in one phase. Build the new clean `FooService` alongside it. Migrate callers in a later phase. Remove `LegacyFooService` in Cleanup.

- The rename makes "this is old" intent visible at every callsite — it appears explicitly in every diff until it is gone.
- Both implementations are fully functional and covered throughout the plan.
- **Best when**: callers are numerous or migration spans multiple phases.

**Pattern 4 — Branch by abstraction**

Extract an interface over the legacy code; both legacy and new implementations implement it; calling code depends on the interface. Swap the wiring in a later phase.

- Higher effort but maximally testable. The transitional abstraction is removed in Cleanup.
- **Best when**: calling code is tightly coupled across many sites and cannot be changed in a single phase.

### Decision guidance

| Situation | Pattern |
|---|---|
| Legacy code is self-contained and callers can update in the same phase | **1 — demolition** |
| API surface must stay; callers can't change yet | **2 — hollow-out** |
| Callers are numerous; migration spans multiple phases | **3 — rename suffix** |
| Calling code is tightly coupled across many sites | **4 — branch by abstraction** |

When two or more patterns are viable, surface the options and a recommendation during the planning interview — don't silently pick one. When one pattern clearly wins (isolated code, no external callers), use it without presenting alternatives.

**Whichever pattern is used:**
- The Cleanup phase must include an explicit task to remove all transitional scaffolding — stubs, `LegacyFoo` classes, transitional interfaces.
- No phase may end with tests failing due to stub behaviour — stubs and their corresponding test updates go in the same phase.

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
- DEVENV markers left in committed code — any `// DEVENV[...]` temporary comment introduced during the plan must be removed in the Cleanup phase. The Cleanup phase must include an explicit removal task if any markers were added. `grep -rn "DEVENV\[" .` must return zero results before the plan is complete.
- Legacy and new implementations coexisting across multiple phases with no cleanup task — if `LegacyFooService` or a hollow-out stub is introduced, the Cleanup phase must have an explicit task to remove it.
