---
name: devenv-tech-debt-audit
description: Thorough, opinionated tech debt, architecture, and correctness-risk audit of one or more repos, with optional focus on a specific functional area. Produces TECH_DEBT_AUDIT.md with file-cited findings, severity, effort estimates, a required "Top bug risks" section, and a required "looks bad but is actually fine" section. After writing the audit, offers to create a GitHub issue (findings in a comment; description is a placeholder for an implementation plan). USE WHEN the user says "audit this repo", "tech debt audit", "codebase health check", "architecture review", "code quality assessment", "run a debt audit on", or hands off a repo path or GitHub issue number for audit. Reads the GitHub issue body for guiding instructions when an issue number is given, then posts the executive summary as a comment. Equally tuned for C#/.NET and TypeScript stacks. DO NOT USE FOR reviewing a single PR (use `/devenv-code-review`), general pair programming (use `/devenv-pair-programming`), or producing an implementation plan from findings (use `/devenv-create-implementation-plan` after the audit is complete).
argument-hint: Repo path(s) (e.g. repos/lib.cs.services.bulk-sync), a GitHub issue number, or repo path(s) followed by a quoted focus area description (e.g. repos/lib.cs.services.chassis "plugin pipeline and built-in plugins")
---

# Tech Debt Audit

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

A deliberate, opinionated audit of one or more repos that produces `TECH_DEBT_AUDIT.md` with file-cited findings, severity, effort estimates, and required sections for both top correctness/bug risks and "looks bad but is actually fine".

When invoked via `/devenv-tech-debt-audit`, follow the protocol below exactly.

> Use the shared [Tool help policy](../_conventions.md#shared-boilerplate-snippets) and [`../_tools-reference.md`](../_tools-reference.md).

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

## When to Use

- Running a health check on a repo before a major refactor or new feature push.
- Producing an audit artifact to anchor a tech debt discussion or planning session.
- Following up on a GitHub issue that requests an audit with specific scope or dimension instructions.

Do **not** use for reviewing a single PR (use `/devenv-code-review`), for pair programming on specific tasks (use `/devenv-pair-programming`), or for breaking down findings into actionable tasks (use `/devenv-create-implementation-plan` once the audit is in hand).

## Core Principles

1. **Find what's actually wrong.** Not diplomatic. Not surface-only. Don't pattern-match to generic best practices without grounding in this specific repo. No sycophancy. No "overall the codebase is well-structured" filler.
2. **Cite `repos/<repo>/path/to/file.ext:LINE` for every concrete finding.** Vague claims like "the code generally..." don't count. Read code before judging it — a pattern that looks wrong in isolation may be load-bearing.
3. **The "looks bad but is actually fine" section is required.** If it's empty, you didn't look hard enough. Forcing enumeration of considered-but-rejected findings is what separates a real audit from a checklist regurgitation.
4. **Don't recommend rewrites.** Recommend specific, scoped changes.
5. **Don't pad.** If a category has nothing material, write "Nothing material" and move on.

## Input detection

Auto-detect the argument left-to-right: **repo path(s)** (`repos/`, `./`, or `/`), **GitHub issue number** (bare integer — mutually exclusive with paths), **focus area** (remaining text). If nothing is provided, ask.

| Input example | Repo | Focus area |
|---|---|---|
| `repos/lib.cs.services.chassis` | chassis | none |
| `repos/lib.cs.services.chassis "plugin pipeline"` | chassis | "plugin pipeline" |
| `repos/foo repos/bar` | foo + bar | none |
| `42` | from issue body | from issue body |
| *(nothing)* | ask | ask |

If a focus area is given, announce it before starting and concentrate Phase 1/2 investigation on those files. The mental model still covers the full system.

If a GitHub issue number is given: fetch the body with `issue-get N --pretty`, extract guiding instructions (scope, dimension overrides, file exclusions), announce them, and set the output filename to `TECH_DEBT_AUDIT-N.md`.

**Output location:** single repo → `<repo-root>/TECH_DEBT_AUDIT[-NNN].md`; multiple repos → `repos/TECH_DEBT_AUDIT[-NNN].md`.

## Phase 1: Orient

Do not skip this. Forming opinions before understanding the system produces bad audits.

1. Read the README, project manifest (`*.csproj`, `*.sln`, `package.json`, `pyproject.toml`), and any architecture docs in `/docs` or `/adr`.
2. Map the directory structure and identify the major modules / layers.
3. Run `git log --oneline -200` and `git log --stat --since="6 months ago"` to see what's actually changing and where churn concentrates. **If a focus area is given**, filter to files relevant to it: `git log --oneline --stat --since="6 months ago" -- <relevant-paths>`.
4. Identify entry points, hot paths, and cold corners. If a focus area is given, map how it connects to the rest of the system.
5. List the top 20 largest files by line count, and the 20 files most frequently modified in the last 6 months. **If a focus area is given**, scope to files that the focus area depends on or that depend on it — churn in those files is where debt hides. Still note the top files outside the focus area if they are exceptional outliers.
6. Publish a plan so the user can see progress through the phases (use the manage_todo_list tool or equivalent).

Write a 1–2 paragraph mental model of the architecture before proceeding. If your model contradicts the README, flag it — that itself is a finding. If a focus area is given, close with a paragraph describing how it fits into the broader system.

## Phase 2: Audit across these dimensions

Use `rg`, language-native tooling, and IDE-equivalent analysis to find concrete examples. Cite `repos/<repo>/path/to/file.ext:LINE` as a clickable workspace-root-relative link for every finding (e.g. `[repos/lib.cs.services.chassis/src/Foo.cs:42](repos/lib.cs.services.chassis/src/Foo.cs#L42)`). Apply any dimension overrides or focus areas extracted from the issue body in Phase 1.

1. **Architectural decay** — circular deps, layering violations, god files (>500 LOC) and god functions, duplicated logic across 3+ sites where an abstraction should exist, abstractions that exist but nobody uses, dead code (unused exports/public types, unreachable branches, stale commented-out blocks).
2. **Consistency rot** — multiple ways of doing the same thing (HTTP clients, error handling, logging, config loading, validation, date handling). Naming drift. Folder structure that no longer reflects what the code actually does.
3. **Type & contract debt** — C#: missing nullability annotations (`?` / `#nullable enable`), unconstrained generics, untyped `object` parameters at trust boundaries. TypeScript: `any` / `unknown` / `as any` / loose dicts. Untyped API boundaries. Missing schema validation at trust boundaries.
4. **Test debt** — run coverage if available; identify gaps on critical paths. Tests that assert implementation rather than behavior. Skipped or flaky tests. High-churn files with no tests.
5. **Dependency & config debt** — C#: `dotnet list package --vulnerable` for CVEs, unused NuGet packages. TypeScript: `npm audit` / `pnpm audit`, unused deps (`depcheck`). Duplicate deps doing the same job. Env var sprawl (referenced but not documented; defaults inconsistent across envs).
6. **Performance & resource hygiene** — N+1 queries, sync work in async paths (C#: `.Result` / `.GetAwaiter().GetResult()` on hot paths; TypeScript: blocking I/O in async functions), uncleaned listeners or handles, unnecessary serialization.
7. **Error handling & observability** — swallowed exceptions, blanket catches (C#: `catch (Exception)` with no logging; TypeScript: `catch (e) {}`), errors logged but not handled, inconsistent error shapes across modules, missing structured logs on critical paths.
8. **Security hygiene** — hardcoded secrets, string-concat SQL, missing input validation at trust boundaries, permissive auth or CORS, weak crypto. Reference the OWASP Top 10.
9. **Correctness and runtime bug risks** — code paths likely to produce wrong behavior at runtime (off-by-one and boundary mistakes, null/undefined paths, stale cache/state transitions, timezone/date math mistakes, retry/idempotency bugs, race conditions, ordering assumptions, partial-failure handling gaps). Prioritize user-visible impact and blast radius.
10. **Documentation drift** — README claims that don't match reality, comments that contradict adjacent code, public APIs without XML doc comments (C#) or JSDoc (TypeScript).

## Phase 3: Deliverable

Write to the output file determined in the input detection step. Use this structure:

```markdown
# Tech Debt Audit — <repo name(s)>
# Tech Debt Audit: <focus-area> — <repo name>  ← when a focus area was given
Generated: <date>
Focus: <focus-area>  ← only if a focus area was given
Issue: #NNN  ← only if invoked with an issue number

## Executive summary
- <N> Critical findings, <N> High, <N> Medium, <N> Low
- Largest debt concentration: <module/path>
- <Up to 10 bullets, ranked by impact>

## Architectural mental model
<Your understanding of the system as it actually is.>

## Findings
| ID | Category | File:Line | Severity (Critical/High/Medium/Low) | Effort (S/M/L) | Description | Recommendation |
|----|----------|-----------|--------------------------------------|----------------|-------------|----------------|
| F001 | ... | [repos/path/src/Foo.cs:42](repos/path/src/Foo.cs#L42) | Critical | L | ... | ... |

Aim for 30–80 findings. Padding past that is noise.

## Top 5 — if you fix nothing else, fix these
1. **F001 — <title>**: <concrete diff sketch or refactor outline, not vague advice>

## Top bug risks
- [ ] **F0XX** — <correctness/runtime bug risk and why it can fail in production>
- [ ] **F0YY** — <risk>

Pick 3-7 items from Findings that are primarily correctness/runtime bug risks. At least one must be Severity Critical or High if such findings exist.

## Quick wins
- [ ] F042: <Low effort × Medium+ severity item>

## Things that look bad but are actually fine
- <Pattern considered and rejected, with explicit reasoning. This section is REQUIRED.>

## Open questions for the maintainer
- <Things you couldn't tell were debt vs. intentional.>
```

For each Critical/High item in **Top bug risks**, explicitly recommend follow-up via `/devenv-bug-fix` (or equivalent root-cause workflow) and include the finding ID in that recommendation.

## Stack-specific tooling

Detect the primary stack(s) from the project manifest and run the relevant tools. Run them in parallel when possible.

**C# / .NET:**
- `dotnet build --no-incremental 2>&1` — surface compiler warnings, nullability violations, and errors
- `dotnet format --verify-no-changes 2>&1` — formatting drift
- `dotnet list package --vulnerable 2>&1` — CVEs in NuGet packages
- `dotnet test --no-build --logger "console;verbosity=minimal" 2>&1` — test failures
- `rg "\.Result\b|GetAwaiter\(\)\.GetResult\(\)"` — async-over-sync anti-patterns
- `rg "#nullable\s+disable|#pragma\s+warning\s+disable\s+nullable"` — nullability opt-outs

**TypeScript / JavaScript:**
- `pnpm audit` / `npm audit` — CVEs
- `npx tsc --noEmit` — type drift
- `npx knip` — dead exports
- `npx madge --circular` — circular deps
- `npx depcheck` — unused deps

If a tool isn't installed, note it in the audit and move on rather than blocking. **Do not install dev tools globally without permission.**

## Large repos: spawn subagents

If a repo is >50k LOC or has >5 top-level modules, dispatch subagents in parallel — one per module — and synthesize their reports. Serial reading on a large repo eats the context window before findings can be written.

Each subagent gets: scope (one module), the Phase 2 dimensions list, the citation requirement, and a 200-finding cap. The main agent merges, deduplicates, and ranks.

For a multi-repo invocation, dispatch one subagent per repo, then synthesize into a single report at `repos/TECH_DEBT_AUDIT[-NNN].md`.

## Repeat-run mode

If the exact output file (`TECH_DEBT_AUDIT.md` or `TECH_DEBT_AUDIT-NNN.md` with the same issue number) already exists in the target location, read it first. Mark resolved findings as `RESOLVED`, update stale ones, and tag new findings with `NEW`. This turns the audit into a living document tracked over time.

A different issue number always produces a new file — never update a file from a previous issue run.

## GitHub integration

Two flows — do not mix them.

**Flow A (audit driven by an existing issue):** After writing the audit file, draft a comment with the executive summary + relative path to the file. Show the draft and ask: *"Post this to issue #NNN? (y/n)"*. See [github-issue-creation.md](../devenv-pair-programming/references/github-issue-creation.md) for the post protocol (artifact `doc_id` metadata, `issue-artifact-upsert`, and `doc_id` line within first 256 characters).

**Flow B (create new issue after audit):** After writing the audit, offer to track it in a GitHub issue. Issue title: `Tech Debt Audit: <focus-area> — <repo-name> — <YYYY-MM-DD>` (without focus area: `Tech Debt Audit — <repo-name> — <YYYY-MM-DD>`). Ask which content to put in the comment (full audit / executive summary + Top 5 / executive summary only). See [github-issue-creation.md](../devenv-pair-programming/references/github-issue-creation.md) for the 5-step protocol (artifact `doc_id` metadata, `issue-artifact-upsert`, and `doc_id` line within first 256 characters).

Never create an issue or post a comment without explicit "yes" confirmation.

## Anti-patterns

- **Do not assert without a citation.** "The error handling is inconsistent" is not a finding; `repos/path/src/Foo.cs:88 — catch (Exception) {}` is.
- **Do not recommend rewrites.** Recommend specific, scoped changes only.
- **Do not leave the "looks bad but actually fine" section empty.** If empty, re-examine Phase 2.
- **Do not stop on first tool failure.** If `dotnet test` fails to build, note it and continue with the remaining dimensions.
- **Do not install tools globally.** Note missing tools and proceed.
- **Do not bypass wrappers when wrappers support the operation.** Use `issue-comment`, `issue-get`, `issue-create`, etc. Use `gh` only when wrappers are insufficient.
- **Do not post to GitHub or create issues without explicit "yes" confirmation.**
- **Do not mix Flow A and Flow B.** If the argument was an issue number, use Flow A (post to existing issue). If it was a repo path, use Flow B (offer to create a new issue). Never create a new issue when the user provided an issue number.
- **Do not audit the entire repo when a focus area was given and skip the focus entirely.** A focus area narrows depth, not breadth — still read the full architecture, but concentrate Phase 2 findings on the named area.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
