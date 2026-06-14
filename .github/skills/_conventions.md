# Skill Conventions

Single source of truth for the shape of skills under `.github/skills/`. New skills must consult this file before being authored. Maintained alongside the existing skills (`create-implementation-plan`, `pair-programming`, `delegation`); patterns here are extracted from those.

> This file is **not** itself a skill. The leading underscore keeps it sorted above the actual skill folders and makes that visually obvious.

## File layout

```
.github/skills/<skill-name>/
├── SKILL.md           # required; `name` field must match folder name
└── references/        # optional; one level deep only
    └── *.md
```

- Folder name and YAML `name` field must match exactly.
- `references/` is for concrete artifacts (templates, cheatsheets, phrasing tables) — not for arbitrary prose. Push reference content out of `SKILL.md` only when it is reusable in isolation.
- Do **not** nest `references/` more than one level deep — the agent loader walks one level only.

## Frontmatter template

```yaml
---
name: <kebab-case-name>          # 1–64 chars; must match folder
description: '<see authoring guide below>'
argument-hint: '<optional one-line hint shown for slash invocation>'
user-invocable: true             # default; omit unless you need false
---
```

Optional advanced keys (use only if needed):

- `disable-model-invocation: true` — show as slash command but never auto-load.

## Description authoring guide

The `description` is the **only** signal the model uses to decide whether to auto-load a skill. It must be keyword-rich. Hard rules:

1. **Open with one sentence** that names what the skill does.
2. **Include a `USE WHEN` clause** with the exact trigger phrases users will say (in quotes).
3. **Include a `DO NOT USE FOR` clause** that names sibling skills it should defer to.
4. Stay under 1024 characters total.
5. Do not use markdown formatting in the description — it's plain text.

Template:

```
<One-sentence purpose>. USE WHEN the user says "<phrase 1>", "<phrase 2>", "<phrase 3>", or <situational trigger>. <One sentence on what the skill does mechanically>. DO NOT USE FOR <situation> (use `/<sibling-skill>`), <other situation>, or <yet another>.
```

See the existing skills for examples; copy the rhythm.

## SKILL.md body — section ordering

Use these headings, in this order, omitting any that don't apply. Keep section titles lowercase-friendly to look natural in chat output.

1. `# <Skill Title>` — friendly title (separate from the YAML `name`).
2. **One-paragraph purpose** below the title.
3. `## When to Use` — repeat the trigger phrases from the description; explicitly list "Do not use for" cases.
4. `## Core Principles` — the 3–5 hard rules the skill enforces.
5. `## Personality` (only when behavior dial differs from the agent default).
6. `## Procedure` or named procedure sections (Session Kickoff, Task Handoff, etc.) — the actual *what to do* of the skill.
7. `## Anti-patterns` — what the skill must not do.
8. Cross-links to sibling skills inline where natural (always relative paths).

## Superseding content

When a skill removes content it previously preserved (a requirement, roadmap step, plan task, or similar artifact), the rule is: **delete from the document; log in Revision History**. Do not leave tombstone blocks, strikethroughs, or "Superseded by" blockquotes in the live document body — they add noise and are confusing to the AI on the next load.

Revision History entry format for a deletion:

```
- Removed <ID> (<one-line summary of what it was>) — <superseded by <new-ID> | withdrawn, <one-line reason>>[. Linked issue: <issue-link>]
```

Examples:

```
- Removed REQ-007 (Auth: minimum password length) — superseded by REQ-014
- Removed STEP-12 (Load test baseline) — withdrawn, moved to separate performance track. Linked issue: #418.
```

Skills that follow this convention: `devenv-refine-requirements`, `devenv-refine-roadmap`, `devenv-refine-blueprint`, `devenv-refine-implementation-plan`.

## Artifact brevity rules

- **Log only material changes.** Revision History is for meaningful scope, ordering, decision, or dependency changes. Skip entries for wording polish, checkbox ticks, and other mechanical churn.
- **Batch related edits.** If one pass makes several small changes of the same kind, record them as one concise revision bullet instead of one bullet per tweak.
- **Keep one home for detail.** If a fact already lives in a phase summary, appendix, or task context, do not restate it in Revision History unless the change itself is what matters.
- **Keep appendices bounded.** Appendix sections should be short, source-backed, and only include context not already captured in the main body. Push repetitive rationale into links or upstream artifacts.

## Model check

Add the following blockquote **immediately after the `# Skill Title` heading** (before the opening paragraph) for any skill that:

- Runs a multi-turn interview, or
- Produces a written artifact (plan, blueprint, requirements doc, roadmap, design doc, handoff), or
- Drives iterative implementation (pair-programming, delegation).

Omit it for lightweight utility skills that complete in a single turn: `pre-commit`, `open-pr`, `triage-issue`, `rubber-duck`, `skill-guru`, `session-handoff`, `update-roadmap`, `code-review`, `chat-with-code`, `plan-status`, `plan-update`.

```markdown
> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*
```

## When to push content into `references/`

Push to a reference file when **all** of:

- The content is a concrete artifact (template, cheatsheet, phrasing table, CLI map).
- A future AI loading the skill might want to copy it verbatim.
- It would balloon `SKILL.md` past ~300 lines.

Keep in `SKILL.md` when:

- It's procedural language ("first do X, then Y").
- It's a short list (< ~10 items).
- It defines the skill's behavior contract (principles, anti-patterns, personality).

## Confirmation flow (write commands)

Any command that mutates external state — `issue-comment`, `issue-update`, `issue-create`, `pr-comment`, `pr-create-for-review` — follows the same flow:

1. **Draft** the payload (comment text, body, etc.).
2. **Show** it in chat.
3. **Ask** for explicit "yes" (one specific question, not "any objections?").
4. **Run** the wrapper first. If wrappers are insufficient for the needed operation, use `gh` as a fallback and note why.
5. **Surface** the result (issue/PR number, URL).

If unsure, prefer `--dry-run` first.

## Artifact Identity Convention

For skills that produce persisted artifacts (local markdown files or GitHub issue comments), use a stable deterministic document identity. Do not use heading-prefix or fuzzy matching.

Required rules:

1. Every persisted artifact must include the metadata block at the top of the artifact body:

```markdown
<!-- DEVENV_ARTIFACT_V1
doc_id: <deterministic doc id>
artifact_type: <artifact-type>
artifact_scope: issue-comment | local-file
issue_number: <N | none>
source_file: <workspace-relative file path>
updated_at_utc: <ISO-8601>
-->
```

2. `doc_id` must be deterministic for the same artifact identity and must appear within the first 256 characters.
3. For issue-comment artifacts, generate `doc_id` via tooling (do not hand-build):
    - `issue-artifact-doc-id --issue <N> --artifact-type <artifact-type> --slug <artifact-slug>`
    - Use `--source-file <path>` instead of `--slug` when file basename is the intended slug source.
    - Generated format: `dv1:<owner-repo>:issue-<N>:<artifact-type>:<artifact-slug>`.
4. For local-file artifacts (no issue comment target), use this deterministic format:
    - `dv1:<owner-repo>:local:<artifact-type>:<artifact-slug>`
    - `<artifact-slug>` should be derived from the artifact filename stem.
5. For issue-comment publication, post via `issue-artifact-upsert` (not manual `issue-comment-list` / `issue-comment-update` matching).
6. If upsert reports duplicate `doc_id` conflict, stop and ask the user which comment ID is canonical before continuing.

Skills should keep only artifact-specific mapping details locally (artifact type, slug source, source file) and reference this convention for common behavior.

## Tooling discipline

- **Prefer repo wrappers first.** Use the repo's `issue-*` / `pr-*` / `project-*` wrappers in `tools/` by default.
- If a required operation is not supported by available wrappers, `gh` is allowed as a fallback. Say explicitly why fallback is needed.
- `--help` is consistent across the wrappers — when in doubt, instruct the AI to read `--help` for the exact flag set.

Wrapper inventory (as of authoring):

- Issues: `issue-create`, `issue-list`, `issue-update` (incl. `--add-label`/`--remove-label`), `issue-close`, `issue-comment`, `issue-comment-list`, `issue-comment-update`, `issue-get`, `issue-groom`, `issue-select`, `issue-artifact-doc-id`, `issue-artifact-upsert`
- PRs: `pr-create-for-review`, `pr-create-for-merge`, `pr-complete-merge`, `pr-merge-pull-request`, `pr-cleanup-review-branches`, `pr-get-review-link`, `pr-get-merge-link` — plus added: `pr-get`, `pr-comment`, `pr-diff`, `pr-list`, `pr-threads-get`, `pr-thread-reply`, `pr-thread-resolve`
- Projects: `project-add-issue`, `project-update-issue`

## Shared boilerplate snippets

For recurring policy text, use short references to shared snippets rather than repeating full prose in each skill.

Recommended snippet references:

- **Tool help policy**: "Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`_tools-reference.md`](../_tools-reference.md) instead of running ad-hoc `--help` during execution."
- **Catalog pointer**: "See the [Skills catalog](./common/references/skills-catalog.md) for the full list and decision tree."
- **Diagnostic mode**: "When the user requests diagnostics for undesirable output/action, follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) and emit a copyable fenced markdown block."

When updating existing skills, prefer replacing duplicated boilerplate blocks with a brief reference line to keep token usage tight.

## Shared diagnostic mode

All custom skills under `.github/skills/devenv-*/SKILL.md` must support a common diagnostic mode.

Required behavior:

1. If the user asks for diagnostics after undesirable output/action, follow [Diagnostic Mode Protocol](./common/references/diagnostic-mode-protocol.md).
2. Output a single copyable fenced markdown block.
3. Include skill-in-effect, conversation context, decision trace summary, self-diagnosis, and related context.
4. Do not expose hidden internal chain-of-thought; provide a concise decision trace summary only.

Authoring rule:

- Add a short reference line near the top of each skill pointing to the shared protocol rather than duplicating full diagnostic instructions in every SKILL.md.

## Hotspot bullet format (shared)

Used by `delegation`, `code-review`, and any skill that asks the human to focus review attention. Format:

```markdown
- [<file>:<line>](<workspace-relative-path>#L<line>) — <one-sentence reason this needs eyes>
```

Bad (vague):

```markdown
- BulkSyncWorker.cs — please review
```

Good:

```markdown
- [BulkSyncWorker.cs:142](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs#L142) — picked exponential backoff with jitter=0.3 without precedent; sanity-check the multiplier
```

Hotspot criteria (any of):

- Non-obvious choice
- Public API surface change
- Test loosened, skipped, or weakened
- New error handling / retry / fallback logic
- Low confidence
- External integration boundary touched (HTTP, DB, FS, IPC)

## No-assumptions rule (shared)

Ask before:

- Any non-trivial implementation choice not specified in the plan / instructions.
- Acting on ambiguous acceptance criteria.
- Picking between multiple existing patterns in the codebase.
- Acting on a user statement that contradicts the plan — flag the contradiction first.

Don't ask about:

- Mechanical choices that match existing style (variable names, formatting, import order).
- Things clearly stated in material the AI just read.

## Authorship and accountability (shared)

Work product ownership is always with the user.

- Do not claim, imply, or phrase that the AI "owns" authored output.
- Do not attribute responsibility to the AI for shipped changes.
- Use assistant-role wording (for example: "assistant-led execution", "review assistance", "delegated implementation support") instead of ownership wording.
- If a task uses `owner: AI` / `owner: User` metadata, treat it as execution lead only for session flow. It does not change authorship or accountability.
- When summarizing results, phrase outcomes as user-owned deliverables with assistant support.

## Sibling cross-link rule

Each skill should link to:

- Its **predecessors** in the workflow (e.g. `pair-programming` links to `create-implementation-plan`).
- Its **alternatives** (e.g. `delegation` links to `pair-programming` for high-impact work).
- Its **successors** where natural (e.g. a phase-complete skill linking to `open-pr`).

Use relative paths: `[/devenv-pair-programming](../devenv-pair-programming/SKILL.md)`.

Also add a one-liner near the top of each `SKILL.md`: "See the [Skills catalog](./common/references/skills-catalog.md) for the full list and decision tree."

## Open Questions Log (Q-NNN)

Shared format for any skill that tracks open design or requirements questions across a session.

```
Q-NNN  [status]   Question text
                  Raised: <Phase N / Step N>. Affects: [area, area].
                  Resolution: <text once resolved> / Deferred: <reason>
```

Example:

```
Q-001  [open]        Should account deletion be hard-delete or soft-delete?
                     Raised: Phase 1. Affects: REQ-003, REQ-011.
Q-002  [resolved]    Must order history persist after account deletion?
                     Resolution: anonymised retention — REQ-011 updated to clarify.
Q-003  [deferred]    Is the 200ms search latency target p50 or p99?
                     Affects: REQ-017. Deferred — pending performance benchmarks.
```

Status transitions: `open` → `brainstorming` (actively being discussed) → `resolved` (user decided; affected artifacts updated) or `deferred` (explicitly set aside; affected artifact annotated with the open question number).

Never silently drop an open question — every `Q-NNN` must end up `resolved` or `deferred` before the final output is written.

## Explore subagent dispatch

When a skill needs to summarize one or more existing documents or repos, prefer dispatching the `Explore` subagent rather than reading inline. This keeps the main conversation uncluttered and allows parallel reads.

**Standard pattern:**

> Prefer dispatching the `Explore` subagent (one invocation per artifact, in parallel where possible) with a structured prompt:
>
> *"Read `<FILE>` and produce a structured summary covering: `<fields relevant to the skill>`. Quote verbatim where wording matters."*
>
> Surface the summary back to the user for confirmation before recording it in session memory or using it to drive decisions.

**Fields by skill context:**

| Context | Fields to request |
| --- | --- |
| Requirements docs / communications | Stated goals, decisions reached, open questions, named actors, constraints mentioned, concrete behaviors described |
| Architecture / blueprint docs | Architectural decisions, components/services, integration points, QoS/constraint statements, trade-offs, open architectural questions |
| Existing component (brownfield) | Current purpose, owned aggregates, public API, events emitted/consumed, known dependencies |

**Key rule:** always confirm the summary with the user before using it to make decisions. Never silently record an Explore result as ground truth.

## Design skill context classification

For design-oriented skills (`devenv-grooming` and related refinements), begin by classifying execution context before reading files or proposing structure.

Supported contexts:

- **Planning repo context** — conversation happens in a planning repo; component code and docs are in another repo.
- **Target repo context** — conversation happens in the component repo itself.
- **Devenv multi-repo context** — conversation happens in the dev environment repo where multiple component repos may be present under `repos/`.

Required behavior:

1. Ask the user which context applies (or state inferred context and ask for confirmation).
2. Resolve and confirm the component repo path and canonical design document path before survey work.
3. Accept source inputs from either pasted text or markdown file paths (blueprint sections, requirements, notes).
4. Capture constraints explicitly in these buckets: dependencies/libraries, infrastructure/runtime, security/compliance, performance/SLO, and timeline/process constraints.
5. Post an intake summary and require explicit confirmation before moving into diagnosis or design phases.

## Component context loading

When a skill needs component-specific implementation or architecture guidance, use the shared index at:

- [`common/references/component-context/index.md`](./common/references/component-context/index.md)

Supported component types:

- Service
- API gateway
- Frontend application

Required behavior:

1. Classify component type before loading component-context files.
2. Load only the files needed for the current decision (for services, choose among architecture, implementation, and plugins as needed).
3. Do not load all component-context files by default.
4. If context for the selected component type is not yet available, continue with general skill rules and explicitly note that specialized context is pending.

## Anti-patterns

- **Vague description** that doesn't name trigger phrases — agent won't auto-load it.
- **Folder/name mismatch** — skill won't load.
- **Monolithic `SKILL.md`** — push templates and cheatsheets into `references/`.
- **Using `gh` when wrappers already support the operation** — wrappers are the default path.
- **Auto-running write commands** without the confirmation flow.
- **Cross-linking by absolute paths** or by skill *title* instead of `name`.
- **Overlapping descriptions** between skills — the model picks one, and you don't get to choose which.
- **Adding a `tests/` or `scripts/` folder** unless the skill genuinely bundles executable assets. Most don't.
