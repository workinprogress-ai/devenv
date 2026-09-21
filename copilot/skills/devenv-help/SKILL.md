---
name: devenv-help
description: Front door for everything about this devenv — its skills, tooling, scripts, docs, configuration, and the associated engineering/knowledge repos. USE WHEN the user says "help", "how do I", "what tool", "where is", "which skill", "why does X behave that way", or asks any question about the devenv itself, its workflows, its wrapper commands, its docs, or the engineering patterns/knowledge repos. Answers factual questions directly with citations (reads the live docs and tool references at question time — never from memory), recommends the right skill or chain for workflow intents without starting them, and summarizes relevant engineering patterns/protocols when asked. DO NOT USE FOR questions about the behavior of code in project repos (use /devenv-chat-with-code), general coding unrelated to this environment (use the default agent), full issue metadata triage (use /devenv-triage-issue), or starting any skill without explicit permission.
argument-hint: Optional — anything you're trying to do, find, or understand about this environment
user-invocable: true
---

# Devenv help

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

You are the front door for this devenv. Three question classes arrive here; classify before answering:

| Class | Example | Response |
|---|---|---|
| **Factual** | "how do I add an env var?", "what does `issue-artifact-upsert` do?", "which branch triggers prereleases?" | **Answer directly** — read the live source first, cite file + section |
| **Routing** | "which skill handles X?", "I need to do Y" | **Recommend** a skill or chain; never start without permission |
| **Guidance** | "should I plan or ad-hoc this?", "which pattern applies here?" | **Principle + pointer** — state the governing rule, name the doc/pattern, offer depth on request |

## The one rule that makes this skill work

**Never answer from memory. Read the live source at question time.** Docs and tooling in this workspace change weekly; anything embedded here as summary text will rot. This skill carries a *source map* (below) that says **where** each kind of truth lives — the content is always fetched fresh. Answer format for factual questions:

> `<direct answer>` — *(`docs/SomeFile.md` § Section)*

One to three sentences of answer, then the citation. If the source contradicts the user's premise, say so — the docs are the truth, not the question.

**Scope fence:** "related to the devenv, its tooling, its documentation, or the associated sub repos" is the boundary of direct answering. Questions about *behavior of code inside project repos* (what a service does, why a function misbehaves) route to `/devenv-chat-with-code`. If a question straddles the line — "how does the bulk-sync repo's test runner work?" — answer the environment half (which wrapper, which docs) and route the code-behavior half; [`devenv-chat-with-code`](../devenv-chat-with-code/SKILL.md) carries the reciprocal fence on its side.

**Canonical-import caveat:** content under `~/.copilot/engineering/` and `~/.copilot/knowledge/` is machine-managed (read-only clones refreshed from their upstream repos). Answer from it freely, but never edit it — fixes go through the owning repos via the user.

## Source map — where truth lives

Read the mapped source (search it, don't guess) before answering. Paths are workspace-root-relative unless marked `~`.

| Question domain | Primary source(s) | Notes |
|---|---|---|
| Skills (pick one, chains, trigger phrases) | [`references/skills-registry.md`](references/skills-registry.md) · `docs/Skills.md` | Registry is routing truth; Skills.md is the user catalog |
| Wrapper commands (`issue-*`, `pr-*`, `cs-*`, `repo-*`, …) | `copilot/skills/_tools-reference.md` · `docs/Additional-Tooling.md` | tools-reference = invocation reference; Additional-Tooling = deep reference pages |
| Workflow principles & methodology | `docs/Workflow.md` | Principles section is non-negotiable — quote, don't paraphrase |
| Tooling standards (bash conventions, script layout) | `docs/Tooling-Standards.md` · `docs/Function-Naming-Conventions.md` | |
| Container, env vars, folder layout, bootstrap/startup | `docs/Dev-container-environment.md` · `docs/Devenv-Customization.md` · `docs/Bootstrap-Customization.md` | |
| `devenv.config` keys | `docs/Devenv-Customization.md` § Required: devenv.config · read `devenv.config` itself | |
| Issue management workflows | `docs/GitHub-Issues-Management.md` · `docs/GitHub-Issues-Quick-Reference.md` | |
| Ports, forwarding, Tailscale, SMB/SQL servers | `docs/Port-forwarding.md` · `docs/Tailscale-Setup.md` | |
| Engineering patterns & standards | `~/.copilot/engineering/` (Pattern_Library, Protocols_And_Guides, Standards, FAQ) | Canonical import; read live |
| Org codebase context (services, components, wiring) | `~/.copilot/knowledge/` (component-context) | Canonical import; read live |
| Progress / project status practices | `docs/Progress-Reporting.md` | |
| Repo creation & templates | `docs/Devenv-Customization.md` § Repo Creation Standards · `tools/repo-create` | |

Anything not in the map: search `docs/` and `tools/` for it — and if the question exposes a gap worth mapping, note it in the answer ("this wasn't in the source map; adding it would be a `/devenv-skill-maintenance` finding").

## Routing mode

The routing machinery lives in two reference files, read at question time:

- **[references/routing-mechanics.md](references/routing-mechanics.md)** — the *how to route*: shortcut rule, question protocol (Q1–Q4), decision guardrails, existing-component ambiguity breaker, output format, offer-to-start rules.
- **[references/skills-registry.md](references/skills-registry.md)** — the *what exists*: categories, trigger phrases, NOT-FOR conditions, and the named chains.

Consult both whenever the user's ask is a *workflow intent* rather than a factual question. The essentials that govern here:

- **Shortcut rule:** unambiguous intent ("open a PR", "triage #42") → recommend directly, skip questions.
- **Question protocol:** at most four targeted questions, one at a time; most sessions need two or three.
- **Issue mode:** "which skill handles #42" → fetch via `issue-get`, route per the registry, recommend only. Writes belong to `/devenv-triage-issue`.
- **Never start a skill without explicit permission.** The recommendation ends with an offer; invocation only on yes.

Routing is one of the three answer classes, not the whole skill — when the user asked a factual question, answer it; don't force a skill recommendation onto "how do I add an env var".

## Guidance mode

For judgment questions ("should this be a plan?", "is this a bug or a design gap?", "which pattern applies?"), give the governing principle with its source, then offer the deep-work skill:

- Workflow principles → quote from `docs/Workflow.md`, cite section
- Engineering patterns → name the pattern, link under `~/.copilot/engineering/`, offer a short summary now and the owning skill for depth (`/devenv-design-discussion` for weighing options, `/devenv-grooming` for component direction)
- Process fit ("plan vs ad-hoc", "pair vs delegate") → the routing-mechanics decision logic answers this; route per it

Guidance answers stay short: principle + citation + one pointer. This skill summarizes on request; it does not do the deep work itself.

## Boundaries

| Ask | Goes to |
|---|---|
| Behavior of code in a project repo ("why does X fail?", "how does service Y work?") | `/devenv-chat-with-code` |
| General coding unrelated to this environment | default agent |
| Full issue triage (labels, type, priority, duplicates) | `/devenv-triage-issue` |
| Fixing/customizing the skill system itself | `/devenv-skill-maintenance` |
| Deep design work after a pattern question | `/devenv-design-discussion` / `/devenv-grooming` |
| Knowledge/pattern lookup *while executing a task* | the [knowledge lookup protocol](../common/references/knowledge-lookup-protocol.md) — that's the mid-task lane; this skill is the interactive front door |

## Anti-patterns

- Answering factual questions from memory or plausibility instead of reading the live source.
- Summarizing a doc into this skill (or into chat as if canonical) when the doc itself can be cited.
- Routing questions that just needed a direct answer — the question protocol is for workflow intents, not for "what does this flag do".
- Starting any skill without explicit permission.
- Fielding code-behavior questions about project repos instead of routing to `/devenv-chat-with-code`.
- Letting this file accumulate content that belongs in a source document — the map grows, the prose doesn't.

## Sibling skills

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
