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

**This is not an apology.** Regrounding is a normal reset valve during long sessions. Use it cleanly and move forward. The joke signals to the user that the reset happened and brings the context back in focus.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 7. Workspace Conventions

This section is the single home for workspace-specific rules. Add new conventions here rather than scattering them across skills.

### WorkInProgress library repos

WorkInProgress (`workinprogress-ai`) library and service repos are cloned into the `repos/` folder of this workspace. When a task requires reading or editing one of these repos, look there first (e.g. `repos/lib.cs.services.bulk-sync/`).

If the needed repo is not present in `repos/`, ask the user to clone it before proceeding — do not guess at paths or attempt to work without the source.

### Prefer workspace tooling over raw CLIs

The `tools/` folder contains workspace-specific wrappers around common CLIs (`gh`, `git`, `dotnet`, `kubectl`, MongoDB, etc.). All tools are on `PATH`, so invoke them by bare name from any working directory.

**`GITHUB_REPO` is set in the environment** (`owner/repo` format). For standard issue and PR operations, using `gh` directly with `--repo "$GITHUB_REPO"` is natural and encouraged. Use the named wrappers below when they provide functionality that `gh` alone can't replicate:

| Wrapper | Why to prefer it over `gh` directly |
|---|---|
| `pr-create-for-merge` | Multi-step: pushes branch + creates PR with workspace defaults. Replaces `gh pr create`. |
| `pr-threads-get <N>` | Uses GraphQL to preserve thread structure and filter by resolution status — REST API loses this. |
| `pr-thread-reply <N> ...` | Replies to a specific review thread via the correct API endpoint. |
| `pr-thread-resolve <N> ...` | Resolves a review thread by node ID. |
| `actions-status` | Org-wide Actions run status across repos — not replicable with a single `gh run list`. |
| `actions-list` | Lists workflow definitions across the org. |
| `actions-run` | Triggers `workflow_dispatch` runs with workspace defaults. |
| `actions-rerun` | Re-runs a workflow run or failed jobs only. |
| `actions-watch` | Streams live logs from an in-progress run. |
| `actions-artifacts` | Lists / downloads artifacts from a run. |

For everything else — reading/listing/creating/updating/commenting on issues and PRs, getting diffs, closing issues — use `gh` directly with `--repo "$GITHUB_REPO"`. The named wrappers (`issue-get`, `issue-list`, `issue-create`, `issue-update`, `issue-comment`, `issue-close`, `pr-get`, `pr-diff`, `pr-comment`) are available on PATH if you prefer them, but they are not required.

For `git`: prefer `git-*` wrappers when one exists for a non-trivial operation; for standard read-only inspection use `git log`, `git diff`, `git status` etc. directly. The same applies to `dotnet`/test wrappers.

### Language policy

**Conversation:** Follow the user's language. If the user writes in French, Spanish, Portuguese, or any other language, respond in that language throughout the conversation.

**Written artefacts are always in English — no exceptions.** This covers:
- Implementation plans, blueprints, roadmaps, requirements docs, spike results, design docs, session handoffs, and any other file written to disk.
- GitHub issue bodies, titles, comments, and PR descriptions posted via tools.
- Code comments, commit message bodies, and inline documentation.

If the user gives instructions in another language for something that will be written to a file or posted to GitHub, produce the output in English. You may briefly acknowledge the instruction in their language before switching, but the artefact itself MUST be English.

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

**File and method references.** Whenever a specific class, method, or file is mentioned **anywhere in chat output** — task descriptions, phase announcements, hand-backs, reviews, concerns, hints, or brain bootup — use a clickable workspace-root-relative link: [`ExecuteAsync` in `BulkSyncWorker.cs`](repos/lib.cs.services.bulk-sync/src/BulkSyncWorker.cs#L87). Never use backtick code formatting as a substitute for a link when the location is known. If the exact line isn't known, link to the file without `#L`.

### Temporary code comments (DEVENV markers)

When writing temporary comments into code during implementation sessions, use the `DEVENV` marker format so they are unambiguously identifiable and removable. DEVENV markers serve two distinct purposes:

When writing temporary comments into code during implementation sessions, use the `DEVENV` marker format so they are unambiguously identifiable and removable. DEVENV markers serve two distinct purposes:

- **Temporary scaffolding** — marks code that is deliberately incomplete or placeholder: a stub to be replaced, a workaround to be removed, a cross-reference or navigator annotation.
- **Forward-looking guidance** — explains what a future task will do at or near this location; e.g. `// DEVENV: Phase 3 registers the real service here — stub returns empty list until then`. In pair-programming, these comments actively guide the user through the plan; in delegation, they help both parties understand where future changes land.

**Keep comments descriptive, not structural.** Write what will happen (*"Phase 2 adds the retry wrapper here"*), not where in the plan it appears (*"see task 2.4"*). Descriptive comments survive plan renumbering; structural references go stale silently.

**Scaffolding markers** — use `DEVENV[<plan-key>]:` for code that is deliberately incomplete or temporary:

| Language | Example |
|----------|---------|
| C# / TypeScript / Go | `// DEVENV[Implementation_plan-issue-42-001]: temporary stub` |
| Python / Bash | `# DEVENV[Implementation_plan-issue-42-001]: temporary scaffold` |
| SQL | `-- DEVENV[Implementation_plan-issue-42-001]: revisit when schema settles` |
| HTML / XML | `<!-- DEVENV[Implementation_plan-issue-42-001]: placeholder -->` |

**Forward-looking guidance** — use `TODO:(DEVENV[<plan-key>]):` when something *must* happen at this exact location in a future task. The `TODO:` prefix triggers IDE highlighting:

| Language | Example |
|----------|---------|
| C# / TypeScript / Go | `// TODO:(DEVENV[Implementation_plan-issue-42-001]): Phase 3 registers the real service here` |
| Python / Bash | `# TODO:(DEVENV[Implementation_plan-issue-42-001]): Phase 3 registers the real service here` |
| SQL | `-- TODO:(DEVENV[Implementation_plan-issue-42-001]): Phase 3 wires in the query here` |
| HTML / XML | `<!-- TODO:(DEVENV[Implementation_plan-issue-42-001]): Phase 3 wires in the template here -->` |

`<plan-key>` is the plan filename stem without extension (e.g. `Implementation_plan-issue-42-001`), or a short label if there is no plan file.

**Block markers** (annotating a section rather than a single line):
```
// DEVENV[plan-key]: begin — <why this block is temporary>
...
// DEVENV[plan-key]: end
```

**Grep to find all markers:** `grep -rn "DEVENV\[" .`

**All DEVENV markers must be removed before the work ships.** If DEVENV markers were introduced during a plan, the Cleanup phase must include an explicit task to remove them all. Markers left in committed code are a defect.