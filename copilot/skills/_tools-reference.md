# Tools Reference


Quick reference for devenv's **provider-neutral** CLI tools used by the skill suite. **Invoke tools by bare name** (`plan-parse`, `next-id`, …) — all wrappers are on `PATH` from any working directory.

**GitHub transport detail (wrapper signatures for `issue-*`, `pr-*`, `project-*`,
`pipelines-*`, repository-inspection tools; env-var semantics; config paths;
prohibitions; canonical recipes) lives in the
[GitHub protocol reference](./_shared/references/provider-protocols/github.md).
This file keeps only provider-neutral tooling and the shared contracts below.**

**The AI never runs the `gh` CLI directly — for any GitHub domain.** All GitHub
operations go through the workspace wrappers (see the protocol reference for the
roster). If an operation is not covered by any wrapper, surface it as a tooling
gap — `gh` is not a fallback. Wrappers are the workspace's abstraction layer;
the backing CLI is an implementation detail that may change.

**Common flags available on all tools (not repeated per-entry):**

- `-n, --dry-run` — show what would happen without executing
- `-V, --verbose` — enable debug output
- `--devenv` — safety override to run against the devenv repo itself; **reserved
  for work that is genuinely about the devenv repo** — never as a shortcut past
  the devenv-repo refusal. Exception: a devenv clone nested below a `repos/`
  directory (e.g. `repos/devenv` in the workspace) is auto-allowed without the
  flag — cd'ing into it is the deliberate devenv-target signal. When a wrapper
  refuses because the cwd is the canonical devenv root, target the actual project
  repo instead (see the [repo-targeting
  guard](./_conventions.md#repo-targeting-guard-required-for-issueartifact-calls))
- Repo targeting for issue/artifact wrappers — env-prefix or cwd resolution;
  see the protocol reference for the resolution order.


Tools that ingest a markdown body (`issue-artifact-upsert`, `issue-comment`, `issue-comment-update`, `issue-create`, `issue-update`, `pr-comment`, `pr-thread-reply`) share one source-resolution contract, implemented in `tools/lib/body-source.bash`:

- **Source flags:** `--body TEXT` or `--body-file FILE` — exactly one. Giving both is an error.
- **stdin via `-`:** `--body-file -` reads the body from stdin (decision: a literal file named `-` is unreachable through this flag; use `--body` for such content).
- **Auto-stdin:** when no source flag is given and stdin is **not** a TTY (piped/redirected), the body is read from stdin automatically. Empty, whitespace-only, or closed stdin is a hard error ("refusing empty stdin body") — never a silent no-op and never a hang.
- **Interactive fallback:** when no source flag is given and stdin **is** a TTY, tools with an interactive picker (currently `issue-artifact-upsert` over `.local-artifacts/`) present it; tools without one error with "a body source is required" — never a hang.
- **Never pipe nothing:** `tool < /dev/null` on an interactive tool yields the same as `--body ""`-class errors — deterministic, no blocking.

Per-tool entries below reference this section instead of restating the semantics.


## Repository inspection & plan tooling (provider-neutral)

### repo-cache-update

Refresh the C# repository cache and dependency index, then print the cache directory path on stdout.

```
repo-cache-update [--no-refresh]
```

Examples:

```bash
repo-cache-update
repo-cache-update --no-refresh
```

---

### repo-cache-deepen

Fetch-only deepening of one cached repository for branch-level git signals (progress reporting). Never checks out — the cache working copy stays on the default branch; branches land as remote refs (`refs/remotes/origin/<b>`). Idempotent and additive; safe to re-run. `repo-cache-update` does not undo deepening (fetch/deepen are additive by nature), though its `gc --prune=all` may drop unreachable objects.

```
repo-cache-deepen --repo <name> [--depth N] [--branch <b>]...
```

Key flags:

- `--repo <name>` — repository name in the cache (required)
- `--depth N` — deepen history by N commits via `git fetch --deepen=<N>` (default 200)
- `--branch <b>` — repeatable; fetch branch into `refs/remotes/origin/<b>` (forced ref update)

Examples:

```bash
repo-cache-deepen --repo lib.cs.common.essentials
repo-cache-deepen --repo service.reqord.identity --depth 500 --branch issue-42-query-progress
```

---

### markdown-plan-complete-task

Mark one or more plan task checkboxes complete or incomplete.

```
markdown-plan-complete-task [--uncomplete] TASK_NUMBER... [PLAN_FILE]
```

When `PLAN_FILE` is omitted, auto-detects the first `Plan-*.md` (or legacy `Implementation_plan-*.md`) in `.local-artifacts/`, then the current directory.

Examples:

```bash
markdown-plan-complete-task 2.3
markdown-plan-complete-task 1.1 1.2 /path/to/Plan-001.md
markdown-plan-complete-task --uncomplete 2.3 2.4
```

---

### markdown-plan-complete-ac

Mark one or more acceptance-criteria checkboxes complete or incomplete.

```
markdown-plan-complete-ac [--uncomplete] AC_NUMBER... [FILE]
```

When `FILE` is omitted, auto-detects the first `Plan-*.md` (or legacy `Implementation_plan-*.md`) in `.local-artifacts/`, then the current directory. Other files (e.g. `Specifications-*.md`) are updated only when named explicitly.

Examples:

```bash
markdown-plan-complete-ac AC-3
markdown-plan-complete-ac AC-1 AC-2 /path/to/Plan-001.md
markdown-plan-complete-ac --uncomplete AC-3 AC-4
```
