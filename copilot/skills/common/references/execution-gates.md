# Execution gates & forward guidance

Canonical shared protocol for all execution-lane skills (`devenv-pair-programming`, `devenv-delegation`, and any future execution skill). Skills cite this file by reference — it applies identically to every consumer; no consumer carries a local delta of these rules. Pair-specific phase machinery referenced below lives in the skills and [phase-gates.md](../../devenv-pair-programming/references/phase-gates.md).

## Forward guidance comments

Do **not** run an upfront codebase-wide pass to seed forward comments. Instead, place DEVENV forward comments **when first touching a file for a task anyway** — the comment lands while the relevant code or document is already open:

- When implementing or reviewing a task that touches a file with a future integration point, add `// FIXME(DEVENV[plan-key]): ...` (plan-bounded) or `// TODO(DEVENV[plan-key]): ... — remove when <condition>` (cross-plan) at that spot in the same pass (source files); in documents use the `<!-- ... -->` annotation form of the same markers.
- For AC-satisfying work: `// FIXME(DEVENV[plan-key]): [AC-2] This method must return a typed result.` — the AC discharges within this plan (find later with `devenv-marker-check --ac`; document annotations use the same `[AC-N]` tag)
- Do not add normal code or document comments referencing plan phases/task numbers; temporary future-work references must use the `FIXME(DEVENV[...])` / `TODO(DEVENV[...])` format.
- At kickoff, run `devenv-marker-check --todo-report` over the working scope and surface existing TODOs as session constraints — a scoped TODO in a file this plan touches is a prior session's message; honor it or explicitly resolve it with the user.

Announce briefly when you drop one: *"Dropped a forward comment — [BulkSyncWorker.cs:142](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs#L142)…"* Skip silently when none are useful.

---

## AC review gate

Run after all implementation phases, before Cleanup. The `[AC-N]` DEVENV comments are removed in Cleanup — run the gate while they're still present.

- Scan: `devenv-marker-check --ac <repo-root>`
- **Objectively verifiable:** tick via `markdown-plan-complete-ac AC-N [<plan_file>]`; state the evidence.
- **Requires judgment:** present to user: *"AC-3 — [text]: can you confirm this is satisfied?"*; tick after confirmation.
- **No matching comment:** surface it: *"AC-4 has no implementation comment — was it addressed?"*; let user decide (tick, defer, or new task).

All ACs must be `[x]` or explicitly deferred/deprecated before Cleanup. See full protocol in [phase-gates.md](../../devenv-pair-programming/references/phase-gates.md).

---

## Phase completion gate

Before declaring a phase complete, run the committability checklist (see [phase-gates.md](../../devenv-pair-programming/references/phase-gates.md) for the full coverage-drop protocol and override options). Run the plan's **declared verification gates** — for code-declared plans (the default; also the assumption for plans with no `**Verification**` line) this is the full checklist below; for non-code declarations, run what the plan declares (deterministic, observable checks) and treat failures identically — the test/coverage items below do not apply:

- [ ] All tests pass (TDD red-green cycle closed)
- [ ] Coverage has not regressed
- [ ] New tests assert observable behavior
- [ ] No blocking TODOs
- [ ] No straggler plan-bounded DEVENV markers for completed work — `devenv-marker-check <phase-files>` fails only on FIXME(DEVENV[...]); condition-bearing `TODO(DEVENV[...])` markers that deliberately survive the phase are acceptable and must be surfaced in the handback

Coverage drops are blockers — surface and resolve before declaring complete. If the gate passes: *"✅ Gate clear — phase is committable."*

Pending questions are also blockers unless they have been explicitly deferred or externalized. A phase is not complete while it still contains unresolved `[QUESTION]` items that affect execution of that phase.

If this is the **final implementation phase**, no AC may remain unchecked. Before declaring final-phase completion, verify every AC is either `[x]` or explicitly deferred/deprecated. If any AC remains undone, the gate is blocked and final-phase completion cannot be declared.
