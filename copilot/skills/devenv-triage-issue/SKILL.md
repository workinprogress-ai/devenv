---
name: devenv-triage-issue
description: Triage GitHub issues on two layers — workflow routing (which skill should handle it: bug → /devenv-bug-hunter, ready-to-plan → /devenv-create-plan, design-unclear → /devenv-grooming, one bounded question → /devenv-design-discussion, cross-component epic → /devenv-create-blueprint + /devenv-create-roadmap, unknown feasibility → /devenv-spike, debt assessment → /devenv-tech-debt-audit, docs gap → /devenv-document, missing functional definition → /devenv-write-specifications, upstream-impact label → refine skills) and GitHub metadata (type, labels, priority, size, duplicates, clarifying comment). USE WHEN the user says "triage this issue", "what should handle this issue", "route this issue", "triage #123", "label and size this", "is this a duplicate", or hands off a fresh untriaged issue / batch / pasted issue text. Auto-detects input: issue number(s) → fetched via `issue-get`; pasted text → triaged in place. Bundles all proposed writes into a single y/n confirm before applying. DO NOT USE FOR implementing the issue (skills routed to take over) or plain summaries (use the default agent / `summarize-github-issue-pr-notification`).
argument-hint: An issue number, list of issue numbers, or pasted issue text to triage
---

# Triage issue

Take a fresh / untriaged GitHub issue and produce a structured triage recommendation in two layers:

1. **Workflow routing** — where does this issue sit in the delivery workflow, and which skill should pick it up?
2. **GitHub metadata** — type, labels, priority, size, duplicate check, and (if needed) a drafted clarifying comment.

Bundle all proposed writes into one confirmation before applying.

> Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`../_tools-reference.md`](../_tools-reference.md).

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

## When to Use

- A new issue lands and needs routing: which skill handles it?
- A new issue lands and needs labels, priority, and sizing.
- You suspect an issue may be a duplicate of an existing one.
- The reporter didn't include enough detail and you want a polite request for clarification.
- You have a batch of untriaged issues to work through.

This skill recommends; it does not execute. The routing line always ends with "Say `/skill-name` to start" — the user invokes the routed skill.

> **Boundary:** `/devenv-skill-guru` (issue mode) covers the lightweight end of this — read-only fetch + which-skill-handles-this recommendation, no metadata. If the user only wants a quick routing answer, either skill works; anything involving labels, type, priority, size, duplicates, or batch processing belongs here.

## Inputs

Auto-detect:

- **Single issue number** (`123` or `#123`) → fetch via `issue-get <n>`.
- **Multiple issue numbers** (`123 124 125` or comma-separated) → fetch each, triage in turn, then a single batch confirmation at the end.
- **Pasted issue text** → triage in place; skip duplicate-search step (no repo context).

For issue inputs, use `issue-get` for body + comments + existing labels, and `issue-search` for candidate duplicate detection (keyword search across titles and bodies, ranked by hit count).

## Triage outputs (per issue)

Produce a block like this for each issue:

```markdown
### Issue #123 — <title>

**Workflow route:** <skill> — <one-line why>
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

### Workflow routing (the first layer)

Classify the issue against the delivery workflow and route. Read the body for signals, then pick exactly one primary route:

| Issue shape | Route | Why |
|---|---|---|
| Describes broken behavior, suspected or confirmed | `/devenv-bug-hunter` | The bug pipeline: verify (existence uncertain) → diagnose (existence established, root cause unknown) → fix — one invocation carries the whole pipeline |
| Single-component work, approach already chosen, issue is complete | `/devenv-create-plan` | Ready to plan: phases and tasks |
| Single-component work, approach unclear | `/devenv-grooming` | Component-level design direction must settle before tasks can be written |
| One focused design question / blocker | `/devenv-design-discussion` | Bounded option-weighing, not full planning |
| Cross-component epic (spans services/repos) | `/devenv-create-blueprint` then `/devenv-create-roadmap` | Needs architectural decomposition, then sequencing into an epic + roadmap artifact |
| Feasibility or approach unknown, needs research | `/devenv-spike` | Throwaway investigation before any planning makes sense |
| Codebase health / debt / architecture assessment | `/devenv-tech-debt-audit` | Audit produces findings + issue creation, not implementation |
| Documentation gap for an existing system | `/devenv-document` | Interview-driven docs, docs-first code-second |
| User-level functional definition missing (what should the system do?) | `/devenv-write-specifications` | Specifications interview before any architecture or planning |
| Asks for a change to an existing blueprint or specifications doc (from users, stakeholders, or any non-queue source) | `/devenv-refine-specifications` or `/devenv-refine-blueprint` | Direction is already known and surgical; label `upstream-impact` so it joins the queue |
| Just asks how to do something | answer + close, or link docs | Not every issue needs a skill |

Routing rules:

- **Check for upstream-impact issues first.** If the issue carries the `upstream-impact` label, it belongs to the refine queue: route to `/devenv-refine-specifications` or `/devenv-refine-blueprint` (issue intake, cascade mode) — do not route it to execution skills.
- **Label design-doc change requests into the queue.** When the issue body asks for a change to an existing blueprint/specifications doc but lacks the label (user- or stakeholder-filed), add `upstream-impact` as part of triage so the refine skills and the queue listing see it.
- **Ambiguity between two routes → ask one question**, don't guess. "Is the approach here already decided, or does it need design work first?"
- **Multiple skills needed → give the chain**, in order (e.g. blueprint → roadmap → per-slice plan).
- **The route ends the triage, it doesn't start the work** — always end with "Say `/skill-name` to start."

### Type classification

- **bug** — describes broken behavior, has (or could have) reproduction steps.
- **feature** — proposes new capability.
- **question** — asks how to do something; usually closeable with a doc link.
- **docs** — gaps or errors in documentation.
- **chore** — refactor, dependency bump, internal cleanup; no user-visible change.

The native GitHub type is written via `issue-update <N> --type <Bug|Feature|Task|Epic>` (map the classification above onto the native vocabulary; legacy aliases accepted).

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

Run `issue-search --state all <2-3 keywords from the issue>` — it searches titles and bodies, matches any keyword case-insensitively, and ranks by hit count. List candidates with one-line reason from the matched terms; do not auto-mark as duplicate without confirmation.

### Label vocabulary

Before suggesting labels, read the repo's existing set: `issue-label-list --format simple` — suggest only labels that exist. If the standard triage vocabulary (`priority/P0–P3`, `size/S–XL`, `upstream-impact`, `needs-triage`, `needs-grooming`) is missing, offer to bootstrap it: `issue-label-create --seed` (idempotent; from `tools/config/labels-config.yml`). Never guess at labels — an unverified `--add-label` either fails or auto-creates junk.

### Drafting clarifying comments

Only when the issue is genuinely incomplete (missing repro, ambiguous specifications, no acceptance criteria for a feature). Draft should be:

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
- Close as duplicate/invalid: `issue-close <n>` then post a comment via `issue-comment <n> --body "Closing as duplicate of #<other>"` (both run as one bundled apply like the rest — surface them clearly in the recommendation so the user can veto the bundle)

On `n`: print the recommendations, do nothing, stop.

No per-action confirms. No partial-apply. The user either trusts the bundle or they don't — if they want changes, they edit the recommendation and re-run.

## Anti-patterns

- **Auto-applying writes without confirm** — every label, comment, and close requires the bundle confirmation.
- **Routing to an execution skill for an upstream-impact issue** — `upstream-impact`-labelled issues route to the refine skills (issue intake), never to implementation.
- **Routing and executing in the same run** — triage recommends a route; the user invokes the routed skill. Don't drift into implementation.
- **Routing every issue to a heavy skill** — questions get answers, small chores get direct execution. Not everything needs a workflow artifact.
- **Padding with low-confidence labels** — only suggest labels that exist in the repo and are clearly applicable.
- **Drafting a clarifying comment when the issue is already complete** — skip the section, don't generate filler.
- **Guessing priority without reasoning** — if priority depends on info you don't have, ask one question, don't pick at random.
- **Marking duplicates without checking** — list candidates with reasons; let the user confirm the close.
- **Triaging the issue AND fixing it in the same run** — triage produces recommendations only. To implement, switch to the routed skill.
- **Over-explaining classifications** — one-line reasoning per field. Long justifications are noise.

## Sibling skills

The routing table's destinations are the siblings — every skill it can route to:

- `/devenv-bug-hunter` — the bug pipeline (verify / diagnose / fix).
- `/devenv-create-plan` — complete single-component issues ready to plan.
- `/devenv-grooming` — component design direction before planning.
- `/devenv-design-discussion` — one bounded design question.
- `/devenv-create-blueprint` + `/devenv-create-roadmap` — cross-component epics (roadmap lands as an artifact on the epic).
- `/devenv-refine-specifications` / `/devenv-refine-blueprint` — upstream-impact queue consumption (cascade mode).
- `/devenv-spike` — unknown feasibility or approach.
- `/devenv-tech-debt-audit` — codebase health assessment.
- `/devenv-document` — documentation gaps.
- `/devenv-write-specifications` — missing functional definition.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
