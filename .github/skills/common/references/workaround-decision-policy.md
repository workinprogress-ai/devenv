# Workaround Decision Policy

This policy governs workaround-style changes in implementation sessions.

## Rule

Workaround shims are prohibited unilaterally.

They are only permitted with explicit user agreement.

A workaround shim includes any compatibility bridge whose primary purpose is to make tests or builds pass without addressing the intended underlying change, for example:

- Test-only compatibility extensions recreating removed APIs.
- Adapters that preserve legacy call shapes only to avoid updating callers.
- Temporary bridges that mask architectural drift.

## Required Collaboration Gate

Before introducing a workaround shim, the AI must stop and present:

1. Root cause of the failure.
2. Clean options that avoid the shim.
3. Risks and tradeoffs of adding the shim.
4. Why a shim is being considered.

Then ask for explicit permission.

If permission is not explicit, do not add the shim.

## Documentation Requirement

If the user approves a shim, document it in the handback:

- What was added.
- Why it was approved.
- Exit criteria and removal plan.
- Risks that remain.

## Rejection Triggers

Do not add a shim even with pressure to move fast when:

- The shim would alter production/public API contracts unexpectedly.
- The shim would hide correctness or security defects.
- The shim has no clear removal path.
