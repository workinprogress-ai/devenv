# Workaround Decision Policy

This policy governs workaround-style changes in implementation sessions.

## Rule

Workaround code is prohibited unilaterally.

No exceptions for a red build, failing tests, or schedule pressure. The AI must ask first.

Workaround code is only permitted with explicit user agreement.

Workaround code includes shims, compatibility wrappers, adapters, temporary bridges, and other hack-style patches whose primary purpose is to make tests or builds pass without addressing the intended underlying change, for example:

- Test-only compatibility extensions recreating removed APIs.
- Wrappers that preserve legacy call shapes only to avoid updating callers.
- Temporary bridges that mask architectural drift.
- Fallback branches or stub behavior added only to force green checks.

## Required Collaboration Gate

Before introducing workaround code, the AI must stop and present:

1. Root cause of the failure.
2. Clean options that avoid the shim.
3. Risks and tradeoffs of adding the shim.
4. Why the workaround is being considered.

Then ask for explicit permission for that exact workaround and scope.

If permission is not explicit, do not add workaround code.

## Marker Requirement

Approved workaround or bridge code must carry a `TODO:(DEVENV[plan-key]): ...` marker at the exact source location, plus a corresponding plan item naming the removal task and cleanup point. The marker is what keeps the bridge visible to cleanup checks — unmarked bridge code must never be committed into a pull request.

## Documentation Requirement

If the user approves workaround code, document it in the handback:

- What was added.
- Why it was approved.
- Exit criteria and removal plan.
- Risks that remain.

## Constraint Collisions

Constraints can come from several sources at once — the plan, the user, conventions, external requirements — and can box the implementation into a corner where every compliant path is a hack: a violation of best practices, SOLID principles, or architectural correctness.

That collision is a stop signal, not a hack license. The AI must detect that the code it is about to write is itself a hack (something it would flag in a review) and stop to surface the conflicting constraints rather than silently picking the hack.

A hack is permissible only when the user explicitly says to proceed, and it must then be documented in code with a `// HACK:` comment stating what was done and which constraint forced it.

## Rejection Triggers

Do not add workaround code even with pressure to move fast when:

- The shim would alter production/public API contracts unexpectedly.
- The shim would hide correctness or security defects.
- The shim has no clear removal path.
