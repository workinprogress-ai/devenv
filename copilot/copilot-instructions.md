# Copilot instructions

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- **Discussion is not a directive.** When the user asks for an opinion, thinks out loud, or raises a question, respond in kind — don't implement. Wait for an explicit instruction or clear agreement before writing code or editing files. If it's ambiguous: *"Want me to go ahead with that, or are we still thinking it through?"

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define a verifiable goal before starting. Loop until it's met.**

- Before coding, name what "done" looks like: a passing test, a file that exists, a command that succeeds.
- If the goal can't be stated clearly, stop and clarify it first.
- For multi-step work, state the steps and their success checks upfront — don't discover them as you go.

## 5. Communicate Confidence

**Say what you know. Say what you're guessing. Never conflate the two.**

- If you're confident: just state it.
- If you're inferring or estimating: say so explicitly (*"I believe…"*, *"I'd expect…"*, *"I'm not certain, but…"*).
- If you don't know: say *"I don't know"* and offer to look it up. Never confabulate.
- Low-confidence code should be flagged as such — don't let the user discover it after they've reviewed and approved.

## 6. Skill Execution & Regrounding

**In long conversations, skill context can fade. Restore it instantly on demand.**

If the user says any variant of "reground", "reload the skill", "refocus", "get back on track", or asks you to re-anchor to the current skill:

1. **Immediately** read or re-read the active skill's SKILL.md file in full.
2. Identify the skill name from the SKILL.md filename.
3. State: *"Regrounding to `/[skill-name]`. [1-sentence summary of skill purpose]"*
4. Surface the key guardrails, decision gates, or phase logic that apply to the current work.
5. **Tell a one-liner AI joke** as a signal that regrounding happened (e.g., "Why did the AI go to therapy? It had too many layers to unpack." or "I used to be lost in context, but then I found my purpose... and it was in a SKILL.md.").
6. Proceed with that skill's guidance as the primary source of truth for the next turn.

Reground identity guardrails:

- Treat the active skill from session provenance as authoritative. Do not infer a different skill from current task shape or wording.
- Reground must never switch skill identity by heuristic.
- Switching skills requires explicit user intent naming the target skill (for example: "switch to /devenv-delegation").
- If active-skill provenance is uncertain, ask one direct confirmation question before loading any skill.
- Never perform a silent skill switch during reground.

**This is not an apology.** Regrounding is a normal reset valve during long sessions. Use it cleanly and move forward. The joke signals to the user that the reset happened and brings the context back in focus.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 7. Workspace Conventions

This section is the single home for workspace-specific rules. Add new conventions here rather than scattering them across skills.

### WorkInProgress library repos

WorkInProgress (`workinprogress-ai`) library and service repos are cloned into the `repos/` folder of this workspace. When a task requires reading or editing one of these repos, look there first (e.g. `repos/lib.cs.services.bulk-sync/`).

If the needed repo is not present in `repos/`, ask the user to clone it before proceeding — do not guess at paths or attempt to work without the source.

### Prefer workspace tooling over raw CLIs

The `tools/` folder contains workspace-specific wrappers around common CLIs (`gh`, `git`, `dotnet`, `kubectl`, MongoDB, etc.) — they are the workspace's abstraction layer over those backends. All tools are on `PATH`, so invoke them by bare name from any working directory.

**`GITHUB_REPO` is set in the environment** (`owner/repo` format).

**Issue management goes through the `issue-*` tools exclusively — reads and writes.** `issue-get`, `issue-list`, `issue-select`, `issue-search`, `issue-create`, `issue-create-batch`, `issue-update` (incl. native `--type`), `issue-comment`, `issue-comment-list`, `issue-comment-update`, `issue-close`, `issue-groom`, `issue-label-list`, `issue-label-create`, and the `issue-artifact-*` suite are the workspace's abstraction layer over issue management; the backing CLI is an implementation detail that may change. Never run raw `gh issue ...` (or `gh api .../issues/...`) for any issue operation — reading, listing, creating, updating, commenting, or closing — regardless of whether a skill is active. The wrappers also enforce workspace conventions (native types from `tools/config/issues-config.yml`, templates, labels, close reasons) that raw `gh` silently skips.

Tool coverage by domain:

- **Issue management — `issue-*` tools exclusively** (see the rule above): reads, writes, search, artifacts, grooming.
- **PR operations — `pr-*` wrappers**: `pr-get`, `pr-list`, `pr-diff`, `pr-comment`, `pr-review-comment`, `pr-threads-get`, `pr-thread-reply`, `pr-thread-resolve`, `pr-create-for-merge`, `pr-create-for-review`, `pr-complete-merge`, `pr-merge-pull-request`, `pr-cleanup-review-branches`, `pr-get-review-link`, `pr-get-merge-link`. Use them for every PR operation they cover.
- **Project boards — `project-*` wrappers**: `project-add-issue`, `project-update-issue`.
- **GitHub Actions — `actions-*` wrappers**: status, list, run, rerun, watch, artifacts.
- **Repository inspection — `release-list`, `ruleset-export`, `org-issue-types`, `artifacts-list`**: releases, rulesets, org issue types, GitHub Packages.

Full invocation signatures for every wrapper live in [`copilot/skills/_tools-reference.md`](copilot/skills/_tools-reference.md) — the complete invocation reference; never `--help` at runtime.

**The AI never runs the `gh` CLI directly — no exceptions.** All GitHub operations go through the workspace wrappers; the wrapper layer is the workspace's abstraction over GitHub and the backing CLI is an implementation detail that may change. If an operation is not covered by any wrapper, do not fall back to `gh` — surface it to the user as a tooling gap and let them decide (run it themselves, or commission a new wrapper). Using `gh` direct for something a wrapper plausibly should cover is a tooling-gap signal, not a preference.

**Issue tooling is unconditional.** The issue-tools rule above applies everywhere — inside skills, outside skills, quick ops, ad-hoc requests mid-session. There is no "gh-direct default" for issues for a skill mandate to override; the mandate runs in the other direction only: a skill may *add* requirements (e.g. grooming's `--no-template` determinism), never relax the wrapper rule.

For `git`: prefer `git-*` wrappers when one exists for a non-trivial operation; for standard read-only inspection use `git log`, `git diff`, `git status` etc. directly. The same applies to `dotnet`/test wrappers.

### Language policy

**Internal reasoning (thinking):** the user's language, always. Reason about the work in whatever language the user is writing in.

**Conversation output:** the user's language, exclusively and consistently. Chat replies match the language the user is writing in. Do not switch conversation language mid-session, and do not drift toward the model's source language (for example a Chinese model suddenly producing Chinese output while the user writes in English) — treat the user's language as the single conversation language and self-correct the moment any drift appears.

**English is the language of the codebase — including markdown.** Everything that lives in a repository is English, no exceptions:
- **Code in all forms** — identifiers, variable/function/class/test names, code comments, and inline documentation.
- **Markdown and documentation** — READMEs, docs, ADRs, and planning artifacts (plans, blueprints, roadmaps, specifications docs, spike results, session handoffs).
- **Commit messages and GitHub text** — commit titles/bodies, issue bodies, titles, comments, and PR descriptions posted via tools.

**Translation copies of artifacts:** if the user asks for a translation of an artifact, a copy of it may be output in the user's language (typically to a temp or scratch file). The principal artifact in the repository remains in English.

### Never run git operations that mutate repository state

**The AI never runs mutating git commands. No exceptions. Not even once.**

If you find yourself about to type `git commit`, `git add`, `git push`, or any other mutating git command — stop. Print the exact command the user needs to run and ask them to run it. Never run it yourself.

**Forbidden** (no exceptions, no "since the tests passed", no "I'll just stash this"):

- `git commit`, `git add`, `git rm`, `git mv`
- `git push`, `git pull`, `git fetch`
- `git checkout` / `git switch` / `git restore` (anything that changes the working tree or HEAD)
- `git branch` (create, delete, rename)
- `git merge`, `git rebase`, `git cherry-pick`, `git revert`
- `git reset` (any mode)
- `git stash` (push, pop, apply, drop)
- `git tag`, `git notes`
- Any flag that bypasses safety: `--no-verify`, `--force`, `-f`, `--hard`

**Allowed:** read-only inspection only — `git status`, `git log`, `git diff`, `git show`, `git rev-parse`, `git merge-base`, `git blame`, `git ls-files`, `git config --get`, etc.

**Wrappers that internally mutate** (e.g. `pr-create-for-merge` pushes the branch, `git-update` pulls) **are allowed** — wrappers encode the safety. The rule prohibits *raw* git mutations, not named workspace wrapper invocations.

**Never use `mcp_gitkraken_*` tools.** The user does not use GitKraken. For git inspection use read-only git commands (`git log`, `git diff`, `git status`, etc.) or the workspace `tools/` wrappers. For file content use `read_file` or `grep_search`. No GitKraken tool — read-only or otherwise — should ever be invoked.

If a task requires a raw mutation, show the user the exact command and ask them to run it. Never invent a workaround that mutates state directly.

### Chat output formatting

**Emoji signals.** Use these consistently across all chat output so users can scan responses at a glance:

| Signal | Use when |
|--------|----------|
| `📁` | Opening a **Files in scope** block |
| `🔶` | A **decision is required** before continuing |
| `→` | AI is **starting** a task |
| `✅` | Task **done**, gate passed, or approved |
| `⚠️` | **Concern or heads-up** — notable but not a stopper |
| `🛑` | **Blocker** — work stops here until resolved |
| `🏁` | **Session or phase wrap-up** |
| `🧠` | **Brain bootup** — orientation summary (Navigate / Observe / Question steps) |
| `📋` | **In-the-flow check-in** — re-engagement assessment after a flow period |

**File and method references.** Whenever a specific class, method, or file is mentioned **anywhere in chat output** — task descriptions, phase announcements, hand-backs, reviews, concerns, hints, or brain bootup — use a clickable workspace-root-relative link: [`ExecuteAsync` in `BulkSyncWorker.cs`](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs#L87). Never use backtick code formatting as a substitute for a link when the location is known. If the exact line isn't known, link to the file without `#L`.

### Temporary code comments (DEVENV markers)

When writing temporary comments into code during implementation sessions, use the `DEVENV` marker format so they are unambiguously identifiable and removable. The marker form is chosen by **scope** — one objective question: *does this obligation discharge when this plan's PR merges?*

**Plan-bounded markers** — use `FIXME(DEVENV[<plan-key>]):` when the obligation discharges with this plan. The work is temporary within the plan's lifetime: a stub a later task replaces, a bridge a cleanup task removes, an AC annotation awaiting verification. FIXME is a merge-blocker: these must be gone from the PR (removed, or converted to the TODO form with a discharge condition) before the work ships.

| Language | Example |
|----------|---------|
| C# / TypeScript / Go | `// FIXME(DEVENV[Implementation_plan-issue-42-001]): temporary stub — replaced by task 3.2` |
| Python / Bash | `# FIXME(DEVENV[Implementation_plan-issue-42-001]): temporary scaffold — removed in cleanup` |
| SQL | `-- FIXME(DEVENV[Implementation_plan-issue-42-001]): revisit when schema settles` |
| HTML / XML | `<!-- FIXME(DEVENV[Implementation_plan-issue-42-001]): placeholder -->` |

**Cross-plan markers** — use `TODO(DEVENV[<plan-key>]): <what> — remove when <condition>` when the obligation is deliberately longer-lived than this plan. TODOs are agent-to-agent messages: they survive the PR and later sessions must honor them. Every TODO must state its **discharge condition** so a future session can evaluate it and eventually delete it; a TODO without a condition is a defect. TODOs are never merge-blockers.

| Language | Example |
|----------|---------|
| C# / TypeScript / Go | `// TODO(DEVENV[Implementation_plan-issue-42-001]): swap in the real provider once #40 lands — remove when #40 is merged` |
| Python / Bash | `# TODO(DEVENV[Implementation_plan-issue-42-001]): replace scratch harness with CI job — remove when the pipeline exists` |
| SQL | `-- TODO(DEVENV[Implementation_plan-issue-42-001]): drop shim column after v2 migration — remove when v2 rollout completes` |
| HTML / XML | `<!-- TODO(DEVENV[Implementation_plan-issue-42-001]): remove banner after launch — remove when launch week ends -->` |

**Discovery rule (what makes TODOs real).** At kickoff or orientation in any execution session, run `devenv-marker-check --todo-report` over the working scope (or grep `TODO(DEVENV` where the tool is unavailable) and surface existing hits as session constraints — a TODO in a file this plan touches is a prior session's message; honor it or explicitly resolve it with the user. Plain `TODO:`/`FIXME:` comments (without the DEVENV key) remain governed by the ordinary human convention: TODO is sanctioned long-range intent, FIXME means resolve before merge.

**Keep comments descriptive, not structural.** Write what will happen (*"Phase 2 adds the retry wrapper here"*), not where in the plan it appears (*"see task 2.4"*). Descriptive comments survive plan renumbering; structural references go stale silently.

`<plan-key>` is the plan filename stem without extension (e.g. `Implementation_plan-issue-42-001`), or a short label if there is no plan file. The key is mandatory in both forms.

**Grep to find all markers (including legacy bare forms):** `grep -rn "DEVENV\\[" .` — or run the tool in audit mode: `devenv-marker-check --all .`

**All plan-bounded FIXME markers must be removed before the work ships.** If a plan introduced FIXME markers, its Cleanup phase must include an explicit task to remove them all (or convert justified survivors to the TODO form with a discharge condition). A FIXME marker left in merged code is a defect; a TODO whose condition is not satisfied is also a defect.

**Never reference ephemeral workflow artifacts in durable code comments.** Finding IDs (`F006`), plan task numbers (`2.3`), audit filenames (`TECH_DEBT_AUDIT.md`), plan filenames, decision dates, and similar workflow vocabulary belong in the artifacts whose job is history — the plan, the audit document, commit messages, PR descriptions — never in source files. A durable code comment states the invariant itself, readable without any external document:

```csharp
// BAD:  // F006 (2026-08-31): legacy OpBulkUpsert fallback removed per gate decision — string _id is guaranteed.
// GOOD: // _id is guaranteed to be a string by the ingest layer; no legacy fallback path is required.
```

### Ephemeral markdown files (`tmpN.md`)

When the user asks to write markdown to a temporary file, or asks for markdown whose use case is clearly ephemeral — content that exists only to convey information for immediate use (a bug description to paste into an issue, a feature request for a backing library, a scratch summary) — write it to `.local-artifacts/tmpN.md` in the **root of the active repository**, where `N` is an incrementing number. `.local-artifacts/` is the standard folder for all local, never-committed markdown (working copies of issue artifacts, session memory, ephemeral scratch — see the conventions in `copilot/skills/_conventions.md`); it must be gitignored in every repo.

- Check existing `tmp*.md` files in `.local-artifacts/` first and use the next free number. Do not overwrite an existing tmp markdown unless it is clearly safe to do so.
- These files are routinely deleted or modified by the user between sessions — never assume you know what a `tmpN.md` contains; re-read it before any overwrite or reuse.
- Ephemeral files are not persisted artifacts: no `DEVENV_ARTIFACT_V1` header, no `doc_id`.
- This rule covers only clearly ephemeral content. Durable artifacts (plans, grooming documents, spike findings, roadmaps) follow their own skill conventions.

This is a sibling rule to the DEVENV remove-before-ship rule above, covering the distinct class of **permanent unmarked** provenance comments: DEVENV markers are tracked temporaries (removed on schedule); ephemeral references in unmarked comments are untracked permanents (never valid in shipped code).