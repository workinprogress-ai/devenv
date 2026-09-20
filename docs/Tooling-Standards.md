# Tooling Standards Guide

How to write, structure, and test tools in this repo's `tools/` suite. These
standards are enforced by review and (where noted) by `lint-scripts.sh` and the
bats suite. New tools should start from `tools/templates/script-template.sh`
(via `tooling-create-script <name>`), which embodies most of this guide.

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

## Script skeleton (required structure)

```bash
#!/bin/bash
# my-tool.sh - One-line description
# Version: 1.0.0
# Description: Fuller description
# Requirements: Bash 4.0+, jq, gh CLI

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
# ... other libs as needed (github-helpers, issue-operations, ...)

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

    ensure_gh_login        # only if the tool talks to GitHub

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

## Library catalog

Source only what you use. All paths are `$DEVENV_TOOLS/lib/`.

| Library | Provides | When to source |
|---|---|---|
| `error-handling.bash` | Logging (`log_debug/info/warn/error/fatal`, `success`), exit-code constants, `die`, `invalid_args`, `require_option_value`, `api_failure`, `handle_global_flag`, `enable_strict_mode`, `require_command`, `safe_remove` | **Always.** Non-negotiable. |
| `versioning.bash` | `script_version` (power `-v/--version`) | Always |
| `github-helpers.bash` | `ensure_gh_login`, `get_repo_spec`, `resolve_target_repo` | Any GitHub-facing tool |
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
| `EXIT_API_FAILURE` | 4 | gh/API operation failed, or the target was not found |
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

## Body/stdin input

If your tool accepts a markdown/text body:

- Source `body-source.bash`; never bare-`cat` stdin.
- Flags: `--body TEXT | --body-file FILE` (`-` = stdin); with no flag and a
  piped stdin, auto-read; with no flag and a TTY, either offer an interactive
  picker or error — never hang.
- Empty or whitespace-only stdin is a hard error ("Refusing empty stdin body").
  Don't hand-roll this; the lib does it.

## Repo targeting (GitHub tools)

- Use `resolve_target_repo [override]` — it resolves
  `--repo override` → `GITHUB_REPO` → `GH_ORG`+cwd, exports `GH_REPO`, and
  runs the devenv-repo safety gate. It hard-exits if `git-operations.bash`
  isn't loaded, so source that lib too.
- Do not hand-roll `GITHUB_REPO → GH_ORG → git remote` chains; five historical
  idioms existed and were consolidated for exactly this reason.

## Temp files and cleanup

- Use `create_temp_file VARNAME [DIRECTORY]` / `create_temp_dir` and
  `register_cleanup` from `error-handling.bash`. The helper registers an EXIT
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

Enable debug output for a single run with `DEBUG=1 ./tools/scripts/my-tool.sh`.

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

Every tool gets a bats file at `tools/tests/scripts/test_<tool>.bats`:

- Syntax test (`bash -n`), `--help` test (rc 0, prints "Usage:")
- At least one behavioral test per mode, using stub commands on `PATH` for
  external dependencies (see `test_issue_artifact_upsert.bats` for the gh-stub
  pattern)
- Exit-code assertions for each error class your tool emits
- Tests must pass with `GITHUB_REPO`, `GH_REPO`, `DEVENV_ROOT`, and
  `DEVENV_TOOLS` either set or unset — stub the environment, don't depend on it

Run everything: `bash tools/tests/run-devenv-tests.sh` (from a clean
environment: `env -u GITHUB_REPO -u GH_REPO ...`).

## Static analysis

`bash tools/scripts/lint-scripts.sh --dir tools/scripts` must report 0
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
