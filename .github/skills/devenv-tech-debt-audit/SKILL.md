---
name: devenv-tech-debt-audit
description: Thorough, opinionated tech debt and architecture audit of one or more repos. Produces TECH_DEBT_AUDIT.md (or TECH_DEBT_AUDIT-NNN.md when linked to a GitHub issue) with file-cited findings, severity, effort estimates, and a required "looks bad but is actually fine" section. USE WHEN the user says "audit this repo", "tech debt audit", "codebase health check", "architecture review", "code quality assessment", "run a debt audit on", or hands off a repo path or GitHub issue number for audit. Reads the GitHub issue body for guiding instructions when an issue number is given, then posts the executive summary as a comment. Equally tuned for C#/.NET and TypeScript stacks. DO NOT USE FOR reviewing a single PR (use `/devenv-code-review`), general pair programming (use `/devenv-pair-programming`), or producing an implementation plan from findings (use `/devenv-create-implementation-plan` after the audit is complete).
argument-hint: Repo path (e.g. repos/lib.cs.services.bulk-sync), a GitHub issue number, or multiple repo paths space-separated
---

# Tech Debt Audit

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

A deliberate, opinionated audit of one or more repos that produces `TECH_DEBT_AUDIT.md` with file-cited findings, severity, effort estimates, and a required "looks bad but is actually fine" section.

When invoked via `/devenv-tech-debt-audit`, follow the protocol below exactly.

> **Do NOT run `--help` on any tool.** All CLI signatures are pre-documented in [`../_tools-reference.md`](../_tools-reference.md) — read that file instead.

## When to use this skill

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

Auto-detect what the user provided:

| Input looks like | Interpretation |
|-----------------|----------------|
| A bare integer (`^[0-9]+$`) | GitHub issue number |
| A path starting with `repos/`, `./`, or `/` | Repo path(s) |
| Multiple tokens | Multiple repo paths |
| Nothing | Ask — do not guess |

**If a GitHub issue number is given:**

1. Run `issue-get N --pretty` to fetch the issue body.
2. Scan the body for guiding instructions: custom scope, dimension overrides, file exclusions, or specific concerns the requestor wants prioritized.
3. Extract and apply those instructions throughout the audit (announce them to the user before starting).
4. Set the output filename to `TECH_DEBT_AUDIT-N.md` where N is the issue number.

**Output location:**

- Single repo → `<repo-root>/TECH_DEBT_AUDIT[-NNN].md`
- Multiple repos → `repos/TECH_DEBT_AUDIT[-NNN].md` (synthesized report across all targeted repos)

## Phase 1: Orient

Do not skip this. Forming opinions before understanding the system produces bad audits.

1. Read the README, project manifest (`*.csproj`, `*.sln`, `package.json`, `pyproject.toml`), and any architecture docs in `/docs` or `/adr`.
2. Map the directory structure and identify the major modules / layers.
3. Run `git log --oneline -200` and `git log --stat --since="6 months ago"` to see what's actually changing and where churn concentrates.
4. Identify entry points, hot paths, and cold corners.
5. List the top 20 largest files by line count, and the 20 files most frequently modified in the last 6 months. The intersection is where debt usually hides.
6. Publish a plan so the user can see progress through the phases (use the manage_todo_list tool or equivalent).

Write a 1–2 paragraph mental model of the architecture before proceeding. If your model contradicts the README, flag it — that itself is a finding.

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
9. **Documentation drift** — README claims that don't match reality, comments that contradict adjacent code, public APIs without XML doc comments (C#) or JSDoc (TypeScript).

## Phase 3: Deliverable

Write to the output file determined in the input detection step. Use this structure:

```markdown
# Tech Debt Audit — <repo name(s)>
Generated: <date>
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

## Quick wins
- [ ] F042: <Low effort × Medium+ severity item>

## Things that look bad but are actually fine
- <Pattern considered and rejected, with explicit reasoning. This section is REQUIRED.>

## Open questions for the maintainer
- <Things you couldn't tell were debt vs. intentional.>
```

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

If a GitHub issue number was provided:

1. After writing the audit file, draft a comment containing the **executive summary** and the relative path to the full audit file.
2. Show the draft in chat.
3. Ask: *"Post this summary to issue #NNN? (y/n)"*
4. If yes, write the summary to a temp file and run `issue-comment N --body-file <temp-file>`.
5. Surface the issue URL from the tool output.

Never post without explicit confirmation.

## Anti-patterns

- **Do not assert without a citation.** "The error handling is inconsistent" is not a finding; `repos/path/src/Foo.cs:88 — catch (Exception) {}` is.
- **Do not recommend rewrites.** Recommend specific, scoped changes only.
- **Do not leave the "looks bad but actually fine" section empty.** If empty, re-examine Phase 2.
- **Do not stop on first tool failure.** If `dotnet test` fails to build, note it and continue with the remaining dimensions.
- **Do not install tools globally.** Note missing tools and proceed.
- **Do not call `gh` directly.** Use `issue-comment`, `issue-get`, etc.
- **Do not post to GitHub without explicit "yes" confirmation.**

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.
