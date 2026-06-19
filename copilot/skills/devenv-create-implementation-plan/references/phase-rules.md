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

4. **Coverage escape hatch (last resort).** When satisfying the coverage rule would require genuinely disproportionate effort — not just effort, but effort that outweighs the benefit of the checkpoint — an escape hatch may be used. Two acceptable forms:

   **Form A — Exclusion annotation:** Mark the new code with the appropriate language attribute to legitimately exclude it from measurement. The reason must be stated in a comment adjacent to the annotation.
   - C#: `[ExcludeFromCodeCoverage]`
   - TypeScript/JS: `/* istanbul ignore */`

   **Form B — Documented floor drop:** Accept a temporary coverage dip. The plan must explicitly document: the pre-dip baseline percentage, why immediate testing is not feasible, and which phase restores coverage (must be the next phase or the finalization phase — not "eventually").

   **Either form requires a mandatory cleanup task.** The escape hatch is a debt instrument, not a waiver. A cleanup task must be added to the finalization phase at the moment the escape hatch is invoked. This task explicitly removes the exclusion annotation or confirms coverage is restored. The escape hatch is not closed until that task completes.

   **Gating:** Escape hatch use must be declared before the phase is marked done — not retroactively justified. During pair-programming, the engineer decides and records it in the session changelog. During delegation, the AI makes a genuine effort to add the missing tests before surfacing the need; if coverage still can't be recovered after reasonable effort, the AI asks the user to choose a form before proceeding.

5. **Tests are written per-phase, not at the end.** Each phase's task list must include test tasks for what that phase introduces. Do not create a standalone "write tests" phase at the end — by then the code is hard to test and the discipline is already lost. If using a TDD red-green approach within a task, the full cycle (write failing test → implement → test passes) must complete within the same phase — do not write a failing test for behaviour that will only be implemented in a later phase.

## Soft guidance

- **Phase sizing is deliverable-first, not size-first.** Each phase has a clear deliverable that is a value-add in its own right — something a reviewer can understand and assess without context from other phases. Size follows from the deliverable; no arbitrary upper or lower count rule applies. Scaffolding, endpoint stubs, a fully-implemented feature, documentation, edge-case tests — all of these are legitimate phase deliverables. A phase that contains only intermediate steps whose sole purpose is to keep the build green is a smell that the phase boundary is in the wrong place; merge it into the adjacent phase where the real deliverable lives.
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
- [ ] Coverage report ≥ baseline taken at the start of the phase *(or escape hatch declared: annotation applied with reason comment, OR floor drop documented with recovery phase named, AND cleanup task added to finalization phase)*
- [ ] Tests added this phase assert observable behaviour (not just execute code)
- [ ] No TODOs left that block the next phase
- [ ] Phase delivered something of clear, standalone value (feature, scaffold, docs, tests) — not only intermediate steps to support a future phase
- [ ] Any temporary scaffolding code added is either still needed, or scheduled for removal in a later phase's task list

## Anti-patterns

- A "Phase 0: setup" that just does config — fold it into Phase 1.
- A "final phase" that adds new behaviour instead of cleaning up — that's a real phase; add Cleanup after it.
- A standalone "write tests" phase at the end of the plan — tests belong inside each phase alongside the code they cover.
- Phases that depend on **future** phases (cyclic) — re-order tasks until the dependency graph is a DAG flowing forward.
- Skipping the coverage check because "it's just a refactor" — refactors are exactly when regressions sneak in.
- Tests that hit lines without asserting anything — these inflate coverage numbers but catch nothing.
- Writing failing tests for functionality to be implemented in a later phase — the TDD red-green cycle must complete within the same phase it starts. Tests written in Phase 1 must assert **current observable behaviour** (including "this stub throws as expected") and must pass at the end of Phase 1. Do not write a test that expects real behaviour the code does not yet have.
- Proposing a phase outline where Phase 1 is described as "add failing coverage for new behaviour" (or equivalent) — phase proposals must describe committable deliverables, not deferred red-state work.
- DEVENV markers left in committed code — any `// DEVENV[...]` temporary comment introduced during the plan must be removed in the Cleanup phase. The Cleanup phase must include an explicit removal task if any markers were added. `grep -rn "DEVENV\[" .` must return zero results before the plan is complete.
- Legacy and new implementations coexisting across multiple phases with no cleanup task — if `LegacyFooService` or a hollow-out stub is introduced, the Cleanup phase must have an explicit task to remove it.
- Phases that consist entirely of intermediate steps (add-stub → implement → remove-stub, each as a separate phase) existing only to keep the build green — these are a sign the phase boundary is in the wrong place. Merge them into one deliverable phase. If keeping green between steps is genuinely difficult, use the escape hatch rather than creating hollow phases.
- Coverage escape hatch used without a cleanup task in the finalization phase — an exclusion annotation or documented floor drop that has no corresponding cleanup task is an open debt with no scheduled repayment.
