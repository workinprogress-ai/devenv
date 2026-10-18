# Empowered-Investigation Gate (shared)

Shared protocol for skills that are empowered to run aggressive, potentially destructive investigation measures — currently `devenv-hunt` and `devenv-research`. Each consuming skill cites this gate and keeps only its mode-scoped deltas (default lane, scratch locations, marker key, blocked-vs-unanswerable wording) locally.

## Aggressive-measures gate

The skill is empowered to answer its question by doing: adding code, removing code, writing tests, running the suite, instrumenting running systems, or running destructive-class experiments. The default lane is read-only investigation plus out-of-repo scratch work; anything beyond it (in-repo edits, behavior-altering changes, deletions, environment mutation) requires consent.

- **Consent is just in time.** If the needed aggression level is visible at intake/planning, ask then; otherwise ask the moment it emerges in the investigation.
- **Every consent request outlines what will be done and why it is needed**, so the user can approve or disapprove on the merits.
- **Destructive-class actions need a category announcement first** (code removal, behavior-altering edits, anything beyond temporary probing) — get a go-ahead, including the warning that afterward the user should be prepared to `git reset` the affected repo.
- **Disapproval rejects the measure, not the investigation.** Continue via alternate routes (read-only evidence, a scoped scratch prototype, a different experiment design). An alternate that is itself aggressive passes through this same gate before use; only when alternate routes are exhausted is the trail blocked / the question unanswerable as scoped.
- **The skill NEVER runs mutating git commands itself** — restore is always the user's hands.
- **All temporary in-repo modifications carry the skill's own `FIXME:DEVENV[<skill-key>]: ...` markers** so nothing empowered blends into permanent code unnoticed.

## Recovery-route rule

No aggressive measure without a clear recovery path stated *before* the action: what will be touched, and how it comes back (user-run `git reset`, plus teardown of any non-git state — spun-up containers, generated files). If recovery cannot be described, the measure is not taken; reframe the experiment as read-only or scratch-scoped instead.

## Scope fence

Read and explore freely across `repos/` — the investigation may wander in pursuit of the answer. But change code ONLY in the agreed target repo(s), and only through the consent flow above. Expanding the change-scope requires explicit user permission, raised as a `🔶` decision gate.

## Scratchpad lane (sandbox as consent boundary)

When the workspace provides the scratchpad sandbox (`repo-scratchpad`, a `scratchpad/<slug>` branch with hook-bypassing AI commits and AI-safe reset), the consent model above changes shape **inside the sandbox**:

- **Consent at entry, scoped by declared experiment classes.** The skill proposes entering the sandbox once — naming what it intends to do inside (probe edits, dependency swaps, destructive experiments) — and the user approves entry with that scope. Within the approved scope, **individual destructive experiments do not re-ask**: the sandbox is the consent boundary. The sandbox's structural guarantees replace the per-measure gate: entry is fail-closed (a dirty tree refuses — the user saves work via `git wip` first), scratch commits are branded and hook-bypassing but can never reach shared history (push refusals; salvage is `repo-scratchpad promote`, which re-acquires trailers), and `reset` can only ever destroy scratch-created content.
- **Recovery route changes hands.** Inside the sandbox, restore is the *tool's* hands: `repo-scratchpad reset` returns to base AI-safe, and `exit` tears down the branch. The user-run `git reset` rule is replaced here — the user's hands are still the only hands for anything outside the sandbox.
- **Disapproval still rejects entry, not the investigation.** A declined entry falls back to the per-measure consent flow above.
- **Raw git stays forbidden inside the sandbox.** The mode unlocks the `repo-scratchpad` wrapper family; it licenses no raw git commands. One rule, zero exceptions.
- **Still per-measure:** anything the entry scope did not declare — especially edits outside the target repo, or experiments the user excluded at entry — passes through the standard gate as usual. The sandbox scopes consent; it does not broaden it.
