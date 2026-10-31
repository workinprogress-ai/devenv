# Tooling Standards Guide

How to write, structure, and test tools in this repo's `tools/` suite. These
standards are enforced by review and (where noted) by the type gate, eslint,
`lint-scripts.sh`, and the test suites. New TypeScript tools start from
`tools/templates/script-template.ts` (via `tooling-create-script <name>`);
stay-bash tools start from `script-template.sh` — each embodies its half of
this guide.

Related docs: [Function Naming Conventions](Function-Naming-Conventions.md),
[Additional Tooling](Additional-Tooling.md).

Note that CI enforces both halves of docs quality: changed markdown is run
through `markdownlint-cli2` **and** `markdown-link-check` in the
`lint-markdown` job — a PR with broken links or lint failures will not pass.

## The golden rules

1. **Source `error-handling.bash` first** — it provides logging, exit codes,
   `die`, strict mode, and the argument helpers. Never define your own
   `log_error`/`log_warning`.
2. **Every script runs under strict mode** — either `enable_strict_mode` (from
   the lib) or an explicit `set -euo pipefail`. A script without it fails
   silently mid-pipeline.
3. **Exit with named constants, never bare numbers** — `exit "$EXIT_MISUSE"`,
   not `exit 2`. `exit 0` for success is the only literal allowed.
4. **Never read stdin without a TTY guard** — a bare `cat` on an interactive
   terminal hangs the session. Use the body-source helpers.
5. **`--help` must work without auth, network, or positional arguments** —
   handle global flags before any validation or `ensure_gh_login`.

## TypeScript standards

All new tooling is TypeScript executed natively by Node type-stripping
(no build step, no tsx/ts-node). The root `package.json` carries
`"type": "module"` (ESM everywhere); legacy `.js` configs are ESM
(`export default`). `.ts` sources use `import` syntax and run via
`exec node <script>.ts` from the bash stub layer. `tsconfig.json` is strict
(`noEmit` — `tsc --noEmit` is the CI type gate; Node strips types without
checking). Node ≥23.6 is the floor (24.18.0 pinned).

**Library tree:** TypeScript modules live in `tools/lib/` — the tree is
organized by role, never by language.

- `lib/core/` — runtime seams. Imports nothing internal.
- `lib/ui/` — the only interaction surface (clack-based prompts, progress,
  panels). Interactive calls must declare a non-TTY fallback; picker flows
  use clack (fzf is not a dependency of TS tooling). Multi-select rendering
  goes through `lib/ui`'s own frame (on `@clack/core`): the focused row is
  marked with a `❯` cursor column — never by color alone, which dies in
  color-less profiles; checked/unchecked stay `◼`/`◻`.
- `lib/providers/` — the provider facade implementing `CONTRACT.md`.
- `lib/domain/` — headless pure logic (issues, repos, fork, markdown, …).
  Never imports `ui/`; only tool scripts orchestrate interaction.

Dependency direction: `core` ← `ui`/`providers` ← `domain` ← tools. A layer
imports only from layers to its left; `domain` never imports `ui` (tools
are the only orchestration point where interaction happens); `core` imports
no internal module. PRs that add cross-layer imports against this direction
are rejected in review.

**Dependency allowlist (npm):** the suite runs from the two published UI
libraries plus their supported core — `@clack/prompts`, `@clack/core` (the
multi-select frame), `picocolors` — and `zod` for config-model validation.
Adding a production dependency is a deliberate act: it ships to every tool
invocation, so name what it replaces and why the standard library or an
existing module cannot do the job. Everything else is `node:` builtins and
workspace modules.

**Module catalog (as built):**

| Module | Role |
|--------|------|
| `lib/core/self-root.ts` | locate the workspace root regardless of CWD |
| `lib/core/exit-codes.ts` | suite-wide exit-code contract (2 misuse, 3 conflict, 4 API failure) |
| `lib/core/logging.ts` | log prefixes and levels |
| `lib/core/spawn.ts` | child-process seam (typed argv, no shell) |
| `lib/core/node-floor.ts` | Node ≥23.6 guard |
| `lib/core/config.ts` | devenv.config parsing (raw vs expanding values) |
| `lib/core/boundary.ts` | input-validation result types (`{ok}`/`{ok:false,error}`) |
| `lib/core/args.ts` | option/argument parsing and requirement checks |
| `lib/core/versioning.ts` | version comparison (numeric core, suffixes ignored) |
| `lib/core/change-id.ts` | Change-Id trailer generation/parsing + O_EXCL locking |
| `lib/core/editor.ts` | editor selection (PREF_EDITOR → FALLBACK_EDITOR → nano) |
| `lib/core/git.ts` | git plumbing (state, branches, WIP guards, rewrite detection) + `changedFiles` changed-set enumeration (`-z` porcelain, rename pairs split) |
| `lib/ui/` | prompts, progress, panels (clack + picocolors) |
| `lib/domain/events.ts` | lifecycle event signals (PR + skill events); reads the PR body through the provider facade |
| `lib/domain/issues/` | issue type/label config model + issue graph |
| `lib/domain/repos/` | repo-type config model (zod) |
| `lib/domain/release/` | release/PR version plumbing |
| `lib/domain/kube/` | kubectl listing/state helpers |
| `lib/domain/cs/` | .NET dependency graph |
| `lib/domain/markdown.ts` | markdown read/manipulate + body resolution |
| `lib/domain/commit-batch.ts` | commit-batch manifest model: strict parse + validators (coverage, index purity, duplicate membership, literal/deletion-aware existence) |
| `lib/domain/fork/` | fork family: config/URI basics (`index`), patch identity (`twin`), surfaces |
| `lib/domain/scratchpad.ts` | sandbox lifecycle state |
| `lib/domain/artifacts.ts` | issue-artifact header/census model |
| `lib/domain/desktop-menu.ts` | desktop menu entries |

New tools use the TS template and this section. Gaps in the catalog are
filled as modules land; when a module's role changes, update its row here.

## Bash vs TypeScript: which tools stay bash

The deciding question for every tool: **must this script run when node
is absent or broken?** Yes → stays bash. Everything else is TypeScript
behind the standard stub. Tiny pure shims (a single CLI pass-through with
no data logic) may also stay bash — standardization gains nothing there.

The stay-bash set (the working tree is authoritative; this table names the
kinds and the current members):

| Kind | Members | Reason |
|---|---|---|
| test harness | `run-devenv-tests` | validates the TS toolchain; cannot depend on what it validates |
| editor entry | `editor` | `EDITOR`/`VISUAL` target — the plain-`git commit` recovery hatch must open with node broken |
| bootstrap repair | `devenv-add-custom-bootstrap`, `devenv-add-custom-startup`, `devenv-add-env-vars` | used precisely when the toolchain is broken |
| credential rotation | `_key-update-do`, `_key-update-tailscale` | emergency path; off-PATH internal contract |
| bash quality gate | `lint-scripts`, `lint-skills`, `lint-documentation` | stay independent of the TS toolchain they co-gate (they lint the toolchain's own output) |
| tiny CLI shims | `dependencies-up`, `dependencies-down`, `docker-restart`, `get-public-ip`, `container-enable-dotnet-debugger` | single-command pass-throughs; no logic to standardize |

Adding a tool to this list is a deliberate act: name the reason in the table,
not just the tool. Anything not listed and not a tiny shim is TypeScript.

`tools/internal/` machinery (`_on_*.sh`, git-hook helpers) stays bash: git hooks are executable files by git's contract, and event entry points are spawned as external commands. The
`tools/run-devenv-tests` wrapper is bash for the same reason (it execs the
stay-bash harness). TS tools that drive these entry points (for example
`workflow-signal` invoking `tools/internal/_on_*`) spawn them as external
commands.

**Test format:** suites exercising fzf pickers, real TTY flows, or
hook/signal machinery stay bats; other tool suites are vitest.

**Interprocess locking:** serialize access to shared local files with an
`O_EXCL` lockfile: atomic create, wait-with-deadline, reclaim a lock older
than 30s (crashed writer). Kernel locks (`flock`) are unavailable to
TypeScript — fd numbers do not survive process spawn — so bash `flock`
patterns translate to lockfile protocols. Reference implementation:
`lib/core/change-id.ts` (`locked()`). Extract a shared `lib/core/lock.ts`
when a second consumer appears; do not create it speculatively.

## Script skeleton (required structure)

```bash
#!/bin/bash
# my-tool.sh - One-line description
# Version: 1.0.0
# Description: Fuller description
# Requirements: Bash 4.0+, jq, provider CLI (per devenv.config)

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
# ... other libs as needed (provider-loader, issue-operations, ...)

readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] ARGUMENT
...
Exit Codes:
    0   Success
    1   General error
    2   Invalid arguments (EXIT_MISUSE)
    4   Not found / API failure
EOF
    exit 0
}

main() {
    # Global flags FIRST — before auth, validation, or anything that can fail.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    ensure_provider_auth   # only if the tool talks to the provider (GitHub today: ensure_gh_login inside the module)

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)    show_usage ;;
            -v|--version) echo "$SCRIPT_NAME"; exit 0 ;;
            ...
        esac
    done
}

main "$@"
```

## Where a tool lives

A tool's source lives in one of four folders, and `.devcontainer/entry-stubs-sync.sh`
generates the bare-name stub in `tools/` from the winning file:

- `tools/scripts/` — the provided bash sources (the stay-bash set).
- `tools/ts/` — the provided TypeScript tool bodies (the Node ≥ 23.6
  type-stripping sources the node stubs dispatch to).
- `tools/fork/` — a fork's own or overriding tools (committed in the fork).
- `tools/custom/` — a user's own or overriding tools (gitignored, machine-local).

A same-named file in a higher folder wins: custom over fork over ts over scripts.
The sync runs at bootstrap; re-run it after adding or removing an override. See
[Forking](./Forking.md#adding-and-overriding-tools-toolsfork-and-toolscustom).

When one tool invokes another devenv tool, it names an **exact path inside the
tools root** — never a bare name for PATH lookup. The default form is the
depth-1 stub, `join(toolsDir, "<tool>")`, which honors the override chain
(a fork's `tools/fork/<tool>` wins, exactly as for users). One exception: the
repo-get dispatcher family (`git-repo`) invokes its same-layer source,
`join(toolsDir, "ts", "repo-get.ts")`, preserving the bash-era same-directory
dispatch contract. External CLIs (`git`, `node`, `dotnet`, …) keep PATH
invocation — the rule covers devenv tools only. The
`sibling-dispatch.test.ts` suite enforces both halves: no devenv tool is
spawned by bare name, and every constructed stub path resolves to a real
file.

A fourth folder, `tools/internal/`, is **not** part of that override chain:
it holds machinery scripts that the devenv or githook machinery invokes —
scripts a user would generally never run by hand (lifecycle event entry
points `_on_*.sh`, the `prepare-commit-msg` githook backing script, the
CI commit-message checker). Internal scripts get no depth-1 stub, are not
on `PATH`, are excluded from the `tools/*` gitignore whitelist via
`!tools/internal/`, and are not overridden by `tools/fork/` or
`tools/custom/`. See
[Additional Tooling — Internal machinery scripts](./Additional-Tooling.md#internal-machinery-scripts-toolsinternal).

## Library catalog

Source only what you use. All paths are `$DEVENV_TOOLS/lib/`.

| Library | Provides | When to source |
|---|---|---|
| `error-handling.bash` | Logging (`log_debug/info/warn/error/fatal`, `success`), exit-code constants, `die`, `invalid_args`, `require_option_value`, `api_failure`, `handle_global_flag`, `enable_strict_mode`, `require_command`, `safe_remove` | **Always.** Non-negotiable. |
| `versioning.bash` | Version parsing and comparison (`parse_version`, `compare_versions`, `version_gte`), environment requirement checks (`check_bash_version`, `check_git_version`, `check_environment_requirements`), `require_script_version` | When a tool needs version comparison or environment checks. `-v/--version` comes from `handle_global_flag` and `SCRIPT_VERSION`, not from this library. |
| `provider-loader.bash` | `ensure_gh_login`, `get_repo_spec`, `resolve_target_repo` | Any GitHub-facing tool (new work uses `tools/lib/providers/` — see the [provider abstraction](../tools/lib/providers/README.md)) |
| `git-operations.bash` | `check_target_repo` (devenv-repo safety gate) | Tools operating on the cwd's repo; required by `resolve_target_repo` |
| `issue-operations.bash` | Issue CRUD wrappers | Issue tools |
| `body-source.bash` | `body_source_resolve`, `body_source_capture_stdin`, `body_source_stdin_is_tty` | Tools that accept markdown/text bodies |
| `fzf-selection.bash` | `fzf_select_single`, `check_fzf_installed` | Interactive pickers |
| `artifact-operations.bash` | `artifact_header_field` | Reading `DEVENV_ARTIFACT_V1` headers |

## Exit-code contract (suite-wide)

Use the constants from `error-handling.bash`. Never invent numbers.

| Constant | Value | Use for |
|---|---|---|
| `EXIT_SUCCESS` | 0 | Success (write `exit 0` literally — fine) |
| `EXIT_GENERAL_ERROR` | 1 | Anything that failed and isn't classified below |
| `EXIT_MISUSE` | 2 | Invalid arguments, unknown options, missing flag values, bad usage |
| `EXIT_CONFLICT` | 3 | Duplicate/ambiguous match where exactly one was required |
| `EXIT_API_FAILURE` | 4 | Provider/API operation failed, or the target was not found |
| `EXIT_AMBIGUOUS` | 5 | Multiple candidates where one was required |

Rules:

- Semantic intent wins over historical numbers. "Issue not found" is **4**, not
  1, even if the script historically exited 1.
- Usage/help errors ("missing value for -f", "unknown option", "PR number is
  required") are **2**.
- `invalid_args "message"` exits 2 for you — use it instead of hand-rolling.
- Document the codes your script actually uses in the `show_usage` heredoc.

## Argument parsing

- One `while [[ $# -gt 0 ]]` + `case` loop; handle `-h`/`-v` via
  `handle_global_flag` at the top of the loop instead of duplicating arms.
- Guard every value-taking flag with `require_option_value "<flag>" "${2:-}"`.
  Pass `"${2:-}"`, never raw `"$2"` — under `set -u` a missing value must reach
  the helper as an empty string, not crash.
- Unknown options: `die "Unknown option: $1. Use --help for usage information" "$EXIT_MISUSE"`.
- Two-stage parsers (flags-after-positional) are acceptable for tools with a
  leading positional, but both stages must handle the global flags.

## JSON output contract

Tools emitting JSON follow gh's shapes: `--pretty` (or a pretty default)
prints two-space-indented `JSON.stringify(v, null, 2)` for a whole record or
a records array; compact `JSON.stringify(v)` stays for one-object-per-line
(NDJSON) streams, `--jq` projections, and summaries a script consumes —
anything a consumer splits on newlines or parses positionally must not
change shape. Choose per surface: human reading gets pretty, machine
piping keeps its contract.

## Body/stdin input

If your tool accepts a markdown/text body:

- Source `body-source.bash`; never bare-`cat` stdin.
- Flags: `--body TEXT | --body-file FILE` (`-` = stdin); with no flag and a
  piped stdin, auto-read; with no flag and a TTY, either offer an interactive
  picker or error — never hang.
- Empty or whitespace-only stdin is a hard error ("Refusing empty stdin body").
  Don't hand-roll this; the lib does it.

## Repo targeting (provider-seamed tools)

Repo targeting resolves through the provider seam via `provider_repo_target`
(explicit `--repo` → `DEVENV_REPO` → provider-specific repo env, if the active
provider defines one → configured org + cwd basename). `DEVENV_REPO` is the only repo-targeting environment variable.
Org identity comes from `provider_org_get` (config `[organization] org` →
seed); a provider module owns the
equivalent chain for its backend.

- Use `resolve_target_repo [override]` — it delegates to
  `provider_repo_target` and runs the devenv-repo safety gate. It
  hard-exits if `git-operations.bash` isn't loaded, so source that lib too.
- Do not hand-roll repo/org resolution chains; five historical idioms
  existed and were consolidated for exactly this reason. `GH_REPO` is
  provider-owned transport state — scripts never read or write it.

## Temp files and cleanup

- Use `create_temp_file VARNAME [DIRECTORY]` and `register_cleanup` from
  `error-handling.bash`. The helper registers an EXIT
  trap in the caller's shell — do not wrap it in `$( )`.
- Happy-path `rm` is not cleanup; early exits leak.

## Logging & error handling

All logging comes from `tools/lib/error-handling.bash` — never define your own
`log_*` functions. The library provides timestamps (ISO 8601), color-coded
levels, stream discipline (errors/warnings to stderr, info to stdout), and
`DEBUG`-gated verbose output.

### Setup

Source the library first (per the golden rules), then enable strict mode:

```bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

enable_strict_mode
```

### Logging functions

| Function | Level | Stream | Exits | Use for |
|----------|-------|--------|-------|---------|
| `log_debug` | DEBUG | stdout | No | Troubleshooting detail; shown only when `DEBUG=1` |
| `log_info` | INFO | stdout | No | Normal operational messages |
| `log_warn` | WARN | stderr | No | Recoverable issues |
| `log_error` | ERROR | stderr | No | Handled failures |
| `log_fatal` | FATAL | stderr | **Yes** | Unrecoverable errors — logs, then exits 1 |

```bash
log_debug "Found ${count} items to process"
log_info "Processing repository: $repo_name"
log_warn "Cache directory not found, creating it"
log_error "Failed to connect to database"
log_fatal "Cannot proceed without valid credentials"   # exits
```

Enable debug output for a single run with `DEBUG=1 my-tool` (the depth-1
runner; the flag reaches the source under `scripts/` or `ts/`).

### Usage conventions

- **Provide context**: `log_info "Processing repo: $repo ($count files)"`, not
  `log_info "Processing"`.
- **Log before risky operations** so failures carry the intent:
  `log_debug "Removing $dir" && rm -rf "$dir"`.
- **Combine with error handling**:
  `some_command || log_fatal "some_command failed; cannot continue"`.
- The strict-mode error trap logs failures automatically via `log_error` —
  don't duplicate it with a hand-rolled `trap ... ERR` unless extending it.

## Repo resolution and interactive tools

- Interactive pickers: `check_fzf_installed` first, then `fzf_select_single`;
  degrade with a clear error when fzf is missing.
- Dry-run flags: accept both `--dry-run` and `-n`.

## Testing requirements

TypeScript tools get vitest coverage at `tools/tests/ts/<name>.test.ts`:

- Unit tests for lib modules alongside behavioral tests that spawn the tool
  and assert on status/output (black-box port pattern — see
  `family-repos.test.ts`)
- Exit-code assertions for each error class the tool emits
- Stub external CLIs on `PATH` (see the provider-stub pattern in
  `test_helper.bash`) — never call a live provider from a test

Bash suites stay where they validate stay-bash behavior or drive real
git/pty machinery (`tools/tests/scripts/`, `tools/tests/lib/`,
`tools/tests/devenv/`): the stay-bats set is the fixture-heavy suites that
would need the world rebuilt to port (fork-export's git machinery, the
provider stub dispatch harnesses). A bats file for a migrated tool is a
delete candidate once its coverage exists in vitest; a bats file backing a
stay-bash tool stays.

Every tool gets a bats file at `tools/tests/scripts/test_<tool>.bats` while
while its older bats coverage remains:

- Syntax test (`bash -n`), `--help` test (rc 0, prints "Usage:")
- At least one behavioral test per mode, using stub commands on `PATH` for
  external dependencies (see `test_issue_artifact_upsert.bats` for the gh-stub
  pattern)
- Exit-code assertions for each error class your tool emits
- Tests must pass with `DEVENV_REPO`, `GH_REPO`, `DEVENV_ROOT`, and
  `DEVENV_TOOLS` either set or unset — stub the environment, don't depend on it

Run everything: `bash tools/tests/run-devenv-tests.sh` (from a clean
environment: `env -u DEVENV_REPO -u GH_REPO ...`).

## Static analysis

`lint-scripts --dir tools/scripts` must report 0
failures. Fix shellcheck errors; do not add disables without a comment
explaining why.

## Common mistakes this guide exists to prevent

These were all real bugs found by the 2026-09 tech-debt audit:

- Capturing a helper's stdout when it returns its result via a global
  (or vice versa) — pick one channel, document it, test it.
- `--help` broken because argument validation runs before flag handling.
- Missing-value flag crash: raw `"$2"` under `set -u` instead of
  `require_option_value`.
- `cat` on a TTY (interactive hang) instead of a stdin TTY-guard.
- Bare `exit 1` for not-found/invalid-args, defeating programmatic use.
- Temp file created in a subshell trap — trap dies with the subshell, file
  leaks.
