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

## Documentation Requirement

If the user approves workaround code, document it in the handback:

- What was added.
- Why it was approved.
- Exit criteria and removal plan.
- Risks that remain.

## Rejection Triggers

Do not add workaround code even with pressure to move fast when:

- The shim would alter production/public API contracts unexpectedly.
- The shim would hide correctness or security defects.
- The shim has no clear removal path.
