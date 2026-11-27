# Environment classes and the mutation matrix

Env-class awareness is registry-driven: the memory repo's `envs/`
registry is the authoritative class source. The class determines the
mutation policy — never the reverse, never assumed.

## The classes

| Class | Stakes |
|-------|--------|
| local | dev-only state; rebuildable |
| lower (staging) | shared pre-production state |
| upper (production) | customer-impacting state |

Class resolution: read the registry's entry for the environment in
question — one entry per registered environment; the class is a field of
that entry (via the memory repo, resolved from `[ops]`). **No registry
entry → guided scan → classify → save** — the environment is unknown,
and the unknown lane is a discovery flow, not a mutation lane. Class
never comes from cluster-name heuristics or vibes.

## The mutation matrix

The matrix is class × risk. Fixed at design time (fork-shared); runtime
facts never relax it.

**The risk axis is derived from the declared tier, never a session's
adjective.** The oracle yields the tier; the row follows:

| Declared tier + shape | Row |
|---|---|
| `read-only` | read-only |
| `mutating`, built-in confirm-guard, routine + reversible (a pod restart) | trivial mutating |
| `mutating`, reversible, blast radius confined to the named target | low-risk mutating |
| `mutating`, blast radius beyond the target or irreversible | risky mutating |
| `destructive` | destructive |

The shape facts (confirm-guard? reversible? blast radius?) come from the
tool's own declaration and behavior — the wrapper family's guards are
declared in the descriptors; blast radius is the one judgment, and it is
**resolved conservatively**: when reversibility or blast radius is
unclear, the command lands in the *stricter* row. Never the reverse. A
session cannot talk a mutation down a row; ambiguity talks it up.

| | local | lower | upper |
|---|---|---|---|
| read-only | direct | direct | direct |
| trivial mutating | direct | direct (approve) | direct (approve) |
| low-risk mutating | direct | ladder | ladder |
| risky mutating | direct (approve) | ladder | ladder |
| destructive | approve | ladder | ladder |

- **direct**: run it, report what happened.
- **direct (approve)**: request a one-line confirmation and **wait for the
  user's explicit yes** — silence, acknowledgements, or navigation phrases
  are not approval (the same rule the hard decision gate applies to `🔶`).
  Built-in confirm-guards count only when they actually prompt: **never
  set `YES=1`, `FORCE_YES=1`, or any non-interactive bypass env var to
  satisfy a guard — that is defeating the guard, not confirming.**
- **ladder**: the escalation ladder below — user-executed or
  user-witnessed with explicit approval.

**Secrets rule (all classes):** a read that returns secret material
(`kubectl get secret`, sealed values, credential env vars) is read-only
but never direct in transcript: do not echo secret values into chat,
memory, or any file the user did not name. Reference the secret by name;
read values only when the user explicitly asks, and only into the
output surface they specify. The egress rule governs network data
movement; this governs **what crosses into the transcript**.

**Context switching re-opens class resolution.** `kube-set-context` (or
any context/cluster/namespace switch) re-targets every subsequent
command: the class resolved at intake is stale the moment the context
changes. Re-resolve the target's class from the registry before any
mutation after a switch — a local-class ruling never authorizes a
mutation against a different environment.

## The escalation ladder

For anything the matrix routes to the ladder:

1. **Short commands** (one-liners): present as an inline copyable block —
   the user reads it, runs it, or tells you to.
2. **Long sequences**: write a script under `tmp/` and open it in the
   user's editor (the `editor` tool) — reviewable before execution.
3. **Outputs land in files** both the user and the skill can read —
   never summarize-and-discard evidence.
4. **Explicit user bypass**: the user may unlock a risk-tiered lane
   ("run it yourself") — recorded, one incident class only, never a
   standing grant.

The ladder exists because upper-class mistakes are customer incidents.
It is not bureaucracy theater; it is the difference between "I broke
staging" and "I broke staging and the customer saw it."

## Unknown commands

An unknown command in any class is a stop for judgment (the census-gap
signal), not a default. Resolve the declaration first (see
[caution-vocabulary.md](./caution-vocabulary.md)); the mutation matrix
applies only to declared tiers.
