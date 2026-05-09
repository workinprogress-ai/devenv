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
4. **Run** the wrapper (never `gh` directly — see "Tooling discipline" below).
5. **Surface** the result (issue/PR number, URL).

If unsure, prefer `--dry-run` first.

## Tooling discipline

- **Never call `gh` directly from a skill body or its references.** Always go through the repo's `issue-*` / `pr-*` / `project-*` wrappers in `tools/`.
- If a skill needs a capability the wrappers don't provide, add or extend the wrapper first; don't shortcut to `gh`.
- `--help` is consistent across the wrappers — when in doubt, instruct the AI to read `--help` for the exact flag set.

Wrapper inventory (as of authoring):
- Issues: `issue-create`, `issue-list`, `issue-update` (incl. `--add-label`/`--remove-label`), `issue-close`, `issue-comment`, `issue-get`, `issue-groom`, `issue-select`
- PRs: `pr-create-for-review`, `pr-create-for-merge`, `pr-complete-merge`, `pr-merge-pull-request`, `pr-cleanup-review-branches`, `pr-get-review-link`, `pr-get-merge-link` — plus added: `pr-get`, `pr-comment`, `pr-diff`, `pr-list`
- Projects: `project-add-issue`, `project-update-issue`

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

## Sibling cross-link rule

Each skill should link to:
- Its **predecessors** in the workflow (e.g. `pair-programming` links to `create-implementation-plan`).
- Its **alternatives** (e.g. `delegation` links to `pair-programming` for high-impact work).
- Its **successors** where natural (e.g. a phase-complete skill linking to `open-pr`).

Use relative paths: `[/pair-programming](../pair-programming/SKILL.md)`.

Also add a one-liner near the top of each `SKILL.md`: "See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree."

## Anti-patterns

- **Vague description** that doesn't name trigger phrases — agent won't auto-load it.
- **Folder/name mismatch** — skill won't load.
- **Monolithic `SKILL.md`** — push templates and cheatsheets into `references/`.
- **Calling `gh` directly** instead of using the wrappers.
- **Auto-running write commands** without the confirmation flow.
- **Cross-linking by absolute paths** or by skill *title* instead of `name`.
- **Overlapping descriptions** between skills — the model picks one, and you don't get to choose which.
- **Adding a `tests/` or `scripts/` folder** unless the skill genuinely bundles executable assets. Most don't.
