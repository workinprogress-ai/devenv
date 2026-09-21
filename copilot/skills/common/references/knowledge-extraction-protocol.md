# Knowledge Extraction Protocol

Shared protocol for extracting **general engineering knowledge** from sessions — emerging practices and engineering patterns — into the copilot knowledge repo's candidates area. The mirror of the [Knowledge Distillation Protocol](knowledge-distillation-protocol.md) (which handles *organization-specific* implementation specifics) and the write-side counterpart to the read rules for candidates in the [Knowledge & Engineering-Pattern Lookup Protocol](knowledge-lookup-protocol.md).

Like distillation, this runs on **explicit request only** — when the user asks to extract, capture, or distill knowledge from the session. Never offer it unprompted.

## Why this is separate from distillation

The knowledge taxonomy has two tiers with different authority:

| Tier | What it holds | Authority | Home |
|---|---|---|---|
| Org-specific specifics | Where things are wired, library idioms, enforced conventions | Accepted as "what this org does" | Knowledge repo main body |
| **Emerging general knowledge** | Best practices, component usage patterns, engineering patterns | **Candidate — not yet official**, consulted with skepticism | Knowledge repo `candidates/` area |

The engineering repo (name via `config-read copilot engineering_repo_name`, default `docs.engineering`; skills read its canonical import at `~/.copilot/engineering`) holds the **official, ratified** standards, practices, and patterns library. It evolves slowly and is wired into the org. Ratification is simple and platform-enforced: **content on `main` is ratified; the user's merge is the only way anything reaches `main`.** [`/devenv-design-discussion`](../../devenv-design-discussion/SKILL.md) is the one skill empowered to prepare changes to this repo — new entries *and* edits to existing entries, sourced from pattern-proposal issues *or* directly from session discoveries — working in the repo clone on a branch, showing the diff for approval, and surfacing the change as a PR via `pr-create-for-merge`. A PR is invisible to every read-side lookup (sessions read the clone, not open PRs), so nothing gains authority until it is merged — the enforcement layer is GitHub's permission model, not extra protocol tolls. No other skill writes to this repo.

## The classifier: pattern vs practice vs org-specific

Run candidates through this cascade in order:

1. **Is it about where/how in *this organization's* code?** (wiring, placement, library idiom of an org-owned library) → **distillation territory** — use the [Knowledge Distillation Protocol](knowledge-distillation-protocol.md), not this one.
2. **Did the org mandate it?** (it exists in the engineering repo's standards, or the user states it is official) → not extraction material — it is already ratified; at most cite it.
3. **Is it simply the accepted way — no debate required?** (best practice, usage pattern: the answer never depends on weighing forces) → **practice candidate**.
4. **Would a competent engineer pick it from a menu of alternatives depending on the forces?** (a bounded problem context, a solution shape, forces that select among several viable options) → **engineering pattern candidate**.

The discriminator between 3 and 4: a practice is *the* way; a pattern is *an* way in a category of solutions where any might be chosen given the forces. When unsure, write it as a pattern — the template's Alternatives field will expose whether alternatives actually exist.

## Candidate entry shapes

**Pattern candidate** (new file per pattern under `candidates/patterns/`):

```markdown
# <Pattern Name>

Status: candidate
Captured: <YYYY-MM-DD> from <skill/session context>

## Problem
<Bounded problem context — when you face this. General, not org-specific.>

## Forces
<The considerations that push toward or away from each alternative.>

## Solution
<The solution shape — enough to apply it, not a tutorial.>

## Alternatives in this category
<Other viable solutions and when each wins. A pattern entry that cannot
name its alternatives is a practice wearing a pattern's clothes — reclassify
it as a practice candidate.>

## Consequences
<What you gain, what you accept.>

## Session evidence
<Where this was observed to work or fail — links to artifacts if any.>
```

**Practice candidate** (new file per practice under `candidates/practices/`):

```markdown
# <Practice Name>

Status: candidate
Captured: <YYYY-MM-DD> from <skill/session context>

## Claim
<The practice, stated in one or two sentences.>

## Rationale
<Why it is the accepted way — what goes wrong without it.>

## Example
<One concrete instance. Org context is allowed here (unlike pattern
problem/forces/solution, which stay general).>
```

Candidates may carry org-context **only** in a practice's Example or a pattern's Session-evidence section — problem, forces, solution, and rationale stay general, or the content drifts into distillation territory.

## Lifecycle

1. **Discover (passive).** Skills notice pattern/practice-shaped truth while working. No detection phase, no mining pass, no offers — capture begins only on the user's explicit request (or the design-discussion in-flight offer below).
2. **Capture (explicit request only).** The user asks to extract. Present each candidate in chat as a one-liner plus its classifier (practice/pattern) and proposed file name. Nothing is written without approval of the specific additions.
3. **Route by confidence.** Two destinations, user's choice:
   - **Settled** — the discussion with the user already weighed it and it held: [`/devenv-design-discussion`](../../devenv-design-discussion/SKILL.md) prepares it directly as a change to the engineering repo (branch → diff shown → PR; see the vetting section of that skill). No staging toll — the exercising already happened, in the room, with the user present.
   - **Undecided** — promising but not yet proven: stage in the knowledge repo's `candidates/` area with `Status: candidate`, matching the shapes above. Later sessions consult candidates with skepticism — they are exercised in real designs and either reinforced or refuted by use. When proven, they route to the engineering repo as above; when refuted, they are deleted or rewritten by the same explicit-request flow that created them.

## Hard rules

- **Explicit request only, with one narrow exception** — same gate as distillation, same rationale (#26: proactive meta-offers are noise). The exception: `/devenv-design-discussion` may surface a pattern-shaped discovery once, in flight, as a one-line offer when the generalization becomes apparent mid-discussion — capture still happens only if the user takes the offer. No wrap-up capture menus anywhere.
- **Only `/devenv-design-discussion` writes to the engineering repo, and only via PR** — it prepares any change (new entries and edits to existing entries, from proposal issues or session discoveries) in the repo clone on a branch, shows the diff for approval, and surfaces it via `pr-create-for-merge`. The user's merge is the ratification; GitHub's permission model is the enforcement. No other skill touches that repo, and no skill merges.
- **The user commits** both the knowledge repo and the engineering repo — skills never commit either (PR creation via the wrapper is the sanctioned push path).
- **One capture moment** — extraction and distillation share the same explicit request ("distill this session" covers both); classify per the cascade and route each candidate to its own destination. The user should never have to know which protocol applies.
