---
name: devenv-triage-issue
description: Triage one or more GitHub issues — classify type (bug/feature/question), suggest labels, priority, size (S/M/L), check for duplicates, and draft a clarifying comment when the issue is incomplete. USE WHEN the user says "triage this issue", "triage #123", "label and size this", "is this a duplicate", "draft a response asking for repro steps", or hands off a fresh untriaged issue / batch / pasted issue text. Auto-detects input: issue number(s) → fetched via `issue-get`; pasted text → triaged in place. Produces a structured recommendation block per issue, then bundles all proposed writes (labels, comment, close-as-duplicate) into a single y/n confirm before applying via `issue-update` / `issue-comment` / `issue-close`. DO NOT USE FOR implementing the issue (use `/devenv-pair-programming` or `/devenv-delegation`), turning it into a plan (use `/devenv-create-implementation-plan`), investigating feasibility (use `/devenv-spike`), or plain summaries (use the default agent / `summarize-github-issue-pr-notification`).
argument-hint: An issue number, list of issue numbers, or pasted issue text to triage
---

# Triage issue

Take a fresh / untriaged GitHub issue and produce a structured triage recommendation: type, labels, priority, size, duplicate check, and (if needed) a drafted clarifying comment. Bundle all proposed writes into one confirmation before applying.

> Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`../_tools-reference.md`](../_tools-reference.md).

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.

## When to Use

- A new issue lands and needs labels, priority, and sizing.
- You suspect an issue may be a duplicate of an existing one.
- The reporter didn't include enough detail and you want a polite request for clarification.
- You have a batch of untriaged issues to work through.

If the work is clear and you just want to do it, use `/devenv-pair-programming` or `/devenv-delegation`. If the issue is a complete spec ready to plan, use `/devenv-create-implementation-plan`. If the issue is a cross-component epic, use `/devenv-create-blueprint` + `/devenv-create-roadmap`. If feasibility is unknown, use `/devenv-spike`. For a plain summary, the default agent's `summarize-github-issue-pr-notification` skill is faster.

## Inputs

Auto-detect:

- **Single issue number** (`123` or `#123`) → fetch via `issue-get <n>`.
- **Multiple issue numbers** (`123 124 125` or comma-separated) → fetch each, triage in turn, then a single batch confirmation at the end.
- **Pasted issue text** → triage in place; skip duplicate-search step (no repo context).

For issue inputs, use `issue-get` for body + comments + existing labels, and `issue-list` for candidate duplicate search (filter by label or state; for keyword-based duplicate detection use `issue-list | jq` or scan titles manually).

## Triage outputs (per issue)

Produce a block like this for each issue:

```markdown
### Issue #123 — <title>

**Type:** bug | feature | question | docs | chore
**Priority:** P0 (critical) | P1 (high) | P2 (normal) | P3 (low)
  Reasoning: <one line>
**Size:** S (<1d) | M (1–3d) | L (>3d) | XL (needs spike)
  Reasoning: <one line>
**Suggested labels:** `bug`, `area/X`, `priority/P2`, `size/M`
**Possible duplicates:** #45 (similar repro), #87 (same root cause) — or "none found"
**Completeness:** complete | needs-clarification
**Drafted clarifying comment** (if needs-clarification):
> Hi @reporter — thanks for filing this. To investigate, could you share:
> - <missing item 1>
> - <missing item 2>
```

Keep reasoning brief — one line each. The point is auditable suggestions, not essays.

### Type classification

- **bug** — describes broken behavior, has (or could have) reproduction steps.
- **feature** — proposes new capability.
- **question** — asks how to do something; usually closeable with a doc link.
- **docs** — gaps or errors in documentation.
- **chore** — refactor, dependency bump, internal cleanup; no user-visible change.

### Priority heuristics

- **P0** — production broken, data loss, security, blocking the team.
- **P1** — high user impact, no workaround, or strategic.
- **P2** — normal user impact, has workaround, or scheduled work.
- **P3** — nice to have, polish, low traffic edge case.

If priority is genuinely unclear, say so and ask one targeted question — don't guess.

### Size heuristics

- **S** — a few hours, single file, well-understood.
- **M** — a day or two, a few files, mostly clear.
- **L** — multi-day, touches several modules.
- **XL** — uncertain enough to warrant `/devenv-spike` first.

### Duplicate search

Run `issue-list --state open | jq` and scan titles/bodies for 2-3 keywords from the issue. List candidates with one-line reason; do not auto-mark as duplicate without confirmation.

### Drafting clarifying comments

Only when the issue is genuinely incomplete (missing repro, ambiguous requirements, no acceptance criteria for a feature). Draft should be:

- Short (3-6 lines).
- Friendly, not interrogative.
- Specific about what's missing.
- Signed implicitly (no fake signature).

Don't draft a clarifying comment just to look busy. If the issue is complete, skip this section.

## Writes (allowed, with confirmation)

After producing the recommendation block(s), bundle ALL proposed writes into one confirmation:

```
Proposed actions:
  #123 — apply labels: bug, area/auth, priority/P1, size/M
  #123 — post clarifying comment (3 lines)
  #124 — apply labels: feature, area/cli, priority/P3, size/S
  #125 — close as duplicate of #45

Apply all? (y/n)
```

On `y`:

- Labels: `issue-update <n> --add-label "<label1>" --add-label "<label2>"` (repeatable)
- Comment: `issue-comment <n> --body-file <draft>`
- Close as duplicate/invalid: `issue-close <n>` then post a comment via `issue-comment <n> --body "Closing as duplicate of #<other>"` (confirm each separately)

On `n`: print the recommendations, do nothing, stop.

No per-action confirms. No partial-apply. The user either trusts the bundle or they don't — if they want changes, they edit the recommendation and re-run.

## Anti-patterns

- **Auto-applying writes without confirm** — every label, comment, and close requires the bundle confirmation.
- **Padding with low-confidence labels** — only suggest labels that exist in the repo and are clearly applicable.
- **Drafting a clarifying comment when the issue is already complete** — skip the section, don't generate filler.
- **Guessing priority without reasoning** — if priority depends on info you don't have, ask one question, don't pick at random.
- **Marking duplicates without checking** — list candidates with reasons; let the user confirm the close.
- **Triaging the issue AND fixing it in the same run** — triage produces recommendations only. To implement, switch to `/devenv-pair-programming` or `/devenv-delegation`.
- **Over-explaining classifications** — one-line reasoning per field. Long justifications are noise.

## Sibling skills

- `/devenv-pair-programming`, `/devenv-delegation` — once triaged, to implement.
- `/devenv-create-blueprint` + `/devenv-create-roadmap` — when the issue describes a cross-component epic.
- `/devenv-create-implementation-plan` — when the issue is complete and ready to plan.
- `/devenv-spike` — when the issue's feasibility or approach is unknown (size = XL).
- `summarize-github-issue-pr-notification` (default agent skill) — for plain summaries without triage.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
