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
  TypeScript tools import `lib/providers/facade/<family>.ts`, never a
  provider module directly (`provider-explain.ts` excepted — it
  introspects); `provider-boundary.test.ts` enforces the rule.
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
| `lib/domain/commit-batch.ts` | commit-batch manifest model: strict parse + validators (coverage, index purity, duplicate membership, literal/deletion-aware existence — path-grain and hunk-grain) |
| `lib/domain/hunk-select.ts` | hunk-selection primitives over a unified diff: split, spec parse, selection patch build, payload identity (pure) |
| `lib/domain/hunk-stage.ts` | partial-staging engine: enumerate live hunks, resolve selectors, apply --cached with preflight + three-part-invariant verification |
| `lib/domain/fork/` | fork family: config/URI basics (`index`), patch identity (`twin`), surfaces |
| `lib/domain/scratchpad.ts` | sandbox lifecycle state |
| `lib/domain/artifacts.ts` | issue-artifact header/census model |
| `lib/domain/desktop-menu.ts` | desktop menu entries |

New tools use the TS template and this section. Gaps in the catalog are
filled as modules land; when a module's role changes, update its row here.

## Bash minimum: the doctrine

**TypeScript is the default for anything with logic.** Bash persists only in
the stay-bash categories below — each exists because bash is genuinely the
better tool there, not by inertia. Porting preserves the black-box contract
(argv, exit codes, output wording); behavior changes are separate commits,
never bundled with a port. Adding a tool to a stay-bash category — or a new
category — is a deliberate act: name why bash is the better tool there, in
the table, not just the tool. Anything not listed is TypeScript.

The stay-bash categories (the working tree is authoritative; this table names
the kinds and the current members):

| Kind | Members | Reason |
|---|---|---|
| exec glue | `tools/<name>` depth-1 stubs, git-hook shims, `tools/internal/` entry points (`_on_*.sh`, `prepare-commit-msg` hook shim), `tools/run-devenv-tests` wrapper | an entry point must be an executable file; a stub holds no logic — it execs |
| test harness | `run-devenv-tests` | validates the TS toolchain; cannot depend on what it validates |
| shell runtime artifacts | `git-completion.bash`, `bash_completion_custom`, `bash-prompt.sh`, `zsh-prompt.sh` | files that ARE bash by their nature |
| host-side setup | the `setup` script | runs before a container — and before node — exists |
| provider bootstrap-side modules | `tools/lib/providers/*/` bash modules | the provider-port phase's non-goal; the TS facade consumed their logic |

Tool bodies whose historical bash-ness rested on "must run when the toolchain
is broken" (`editor`, bootstrap repair, credential rotation, the lint gates,
tiny CLI shims) moved to TypeScript in the bash-minimum phase: they keep
their depth-1 stubs (exec glue) and their black-box contracts. A broken node
is not preserved as a fallback for tool bodies.

**Stay-bash category definitions:**

- **Exec glue** — an entry point that must be an executable file: depth-1
  stubs, git-hook shims (git's contract), and `tools/internal/` machinery
  invoked as external commands (`_on_*.sh` entry points, the
  `prepare-commit-msg` hook shim). A shim holds no logic of its own; its
  logic lives in TypeScript and it execs.
- **Shell runtime artifacts** — files that ARE bash by their nature:
  `git-completion.bash`, `bash_completion_custom`, `bash-prompt.sh`,
  `zsh-prompt.sh`.
- **Host-side setup** — the `setup` script: it runs before a container (and
  therefore before node) exists.
- **Provider bootstrap-side bash modules** — `tools/lib/providers/*/`
  bootstrap-side modules (the provider-port phase's non-goal; the TS facade
  consumed their logic).
- **Toolchain-independent tooling** — tools whose value is being runnable
  when the TS toolchain itself is broken or unbootstrapped: the test
  harness, the editor recovery hatch, bootstrap repair, credential
  rotation, and the lint gates that co-gate the toolchain's own output.

**Doctrine, not a CI gate.** Stay-bash membership is enforced by review, not
by a build failing on the sight of a `.sh` file. The categories above are the
complete list; a new member needs a named reason in review, and a ported
surface keeps its black-box contract. This rule is standing guidance — it
does not run in CI.

**Test format:** suites exercising fzf pickers, real TTY flows (a real
`script -qec` pty), real git-hook execution, or bats-in-bats machinery stay
bats; other tool suites are vitest. Stub-based fzf tests are
vitest-portable (the corpus stubs fzf deliberately) and follow the normal
port rule — the bats assertions are the oracle until each family's port
lands, and no net coverage loss is the acceptance bar.

**Fixture-only testing for side-effecting tools:** a tool that mutates
world state (staging, committing, pushing, tracker writes, plan mutations,
installers) is tested only against fixtures — a temp-repo scaffold, a
scripted editor, a stub binary on `PATH` — never by invoking it live in the
real repo. Read-only verification against the real repo (status, log, list,
config reads) remains fine. The real-repo invocation of a side-effecting
tool is by definition a production action: it goes through its normal
workflow path with review, never through a test.

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
# ... other libs as needed (config-reader, provider seam modules —
# see the Library catalog for the post-Phase-10 allowlist)

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

A tool's source lives in one of three folders, and `.devcontainer/entry-stubs-sync.sh`
generates the bare-name stub in `tools/` from the winning file:

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

The bash verb layer retired with the provider-port phase (Phase 10 of the
TS consolidation): `versioning.bash`, `provider-loader.bash`,
`git-operations.bash`, `issue-operations.bash`, `artifact-operations.bash`,
and every provider verb twin are gone — their logic lives in the TS facade
(`tools/lib/providers/`) and `lib/core/`. The bash that remains under
`tools/lib` is the bootstrap seam allowlist, exactly:

```bash
config-reader.bash            copilot-knowledge.bash      error-handling.bash
providers/provider-core.bash
providers/github/{auth,setup,bootstrap}.bash
providers/azure/{auth,setup,bootstrap}.bash
providers/azure/credential-helper.sh
```

| Library | Provides | When to source |
|---|---|---|
| `error-handling.bash` | Logging (`log_debug/info/warn/error/fatal`, `success`), exit-code constants, `die`, `invalid_args`, `require_option_value`, `api_failure`, `handle_global_flag`, `enable_strict_mode`, `require_command`, `safe_remove` | **Always** (seam-chain members only, post-Phase-10). Non-negotiable. |
| `config-reader.bash` | `config_init` / `config_read_value` / `config_get_raw` over `devenv.config` | Seam chain reading configuration |
| `lib/core/body-source.ts` (TS) | `resolveBodySource` | Tools that accept markdown/text bodies — the shared resolver (the historical `body-source.bash` is retired) |

## Exit-code contract (suite-wide)

Use the constants from `tools/lib/core/exit-codes.ts`. Never invent numbers.

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
- Validate every argument and option value before the first mutation or
  provider call; a bad value exits 2, never 0 and never 1.
- Document the codes your script actually uses in the `show_usage` heredoc.

## Argument parsing: the CLI contract

Every tool in `tools/ts` follows one contract, enforced by
`tools/tests/ts/cli-contract-sweep.test.ts` (source checks for every tool, plus
a `--help` probe for tools with no host-affecting calls):

- **One parse through `toolCli`** (`tools/lib/core/cli.ts`), strictly: no
  `strict: false`. `-h/--help`, `-v/--version`, `-V/--verbose`, `-n/--dry-run`
  and `--devenv` come from the house table; a tool advertises only the house
  flags it honors (`usageCommonFlags({ noDryRun, noDevenv })`).
- **An unknown flag is misuse**: exit 2, decided before any provider call or
  mutation, with stdout left empty. New and changed tools print the standard
  "Use --help for usage information" hint on stderr; the parse-errors test
  (`tools/tests/ts/cli-contract-parse-errors.test.ts`) pins the exact hint for
  `tooling-create-script`, `install-extras` and `issue-types`, and holds the
  other tools it lists (`get-services-config`, `terraform-plan`,
  `devenv-desktop-menu-add-folder`, `devenv-desktop-menu-add-shortcut`,
  `config-read`, `devenv-memory-watch`, `pr-get-merge-link`,
  `pr-get-review-link`, `issue-comment-list`, `cs-dependencies-trace`,
  `artifacts-list`, `repo-update-config`, `repo-reset-merge-config`) to exit 2
  with a `--help` mention on stderr. Other tools follow the same convention but
  are not individually enforced; a runtime failure such as a missing config
  file keeps its own exit code.
  The single documented exception is `git-wip-recover`, which keeps the exit 1
  its predecessor used for an unknown option.
- **`--help` and `--version` exit 0 with output on stdout** and need neither
  network, credentials nor a configured workspace. Nothing — provider
  authentication, capability checks, config reads — runs at module load before
  arguments are parsed and help is handled; authenticate on the main path,
  after parsing.
- **Repeatable flags** are declared `multiple: true`; a flag documented as
  repeatable that keeps only its last value is a defect.
- **Forwarders** (a tool that passes the rest of its argv to a child command:
  `kube-pod-exec`, `kube-logs`, `git-graph`, ...) parse only their own leading
  options and stop at the first command word, using
  `tools/lib/core/forward-argv.ts`; everything after is forwarded unread, and a
  leading `--` ends option scanning. A forwarded `-n` or `-h` is never the
  tool's own flag. The pod-addressed kube forwarders (`kube-logs`,
  `kube-pod-exec`, `kube-pod-console`) additionally accept their own
  `-n/--namespace` (`-n NS`, `-nNS`, `--namespace NS`, `--namespace=NS`) after
  the pod word and before the command; the command's own `-n` stays the
  command's.
- A message or title that begins with `-` needs `--` first (`git-wip -- -n note`).

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

- Import `resolveBodySource` from `tools/lib/core/body-source.ts`; never bare-`cat` stdin and never hand-roll the resolution.
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

- Use `providerRepoTarget` (`lib/providers/provider-core.ts`) — it resolves
  the target and runs the devenv-repo safety gate; explicit `--repo` wins
  over `DEVENV_REPO`.
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

New tools get a vitest suite at `tools/tests/ts/<tool>.test.ts` (the shape
above). The bats-per-tool rule below is bash-era guidance: it applied to
tools whose coverage already lived in bats, pending their vitest port.

- ~~Syntax test (`bash -n`), `--help` test (rc 0, prints "Usage:")~~ — for
  TS subjects, `tsc` + the lint gates supersede the syntax check; keep one
  behavioral `--help` assertion in vitest
- At least one behavioral test per mode, using stub commands on `PATH` for
  external dependencies (see any `tools/tests/ts/*.test.ts` for the stub
  pattern)
- Exit-code assertions for each error class your tool emits
- Tests must pass with `DEVENV_REPO`, `GH_REPO`, `DEVENV_ROOT`, and
  `DEVENV_TOOLS` either set or unset — stub the environment, don't depend on it

Run everything: `bash tools/tests/run-devenv-tests.sh` (from a clean
environment: `env -u DEVENV_REPO -u GH_REPO ...`).

## Static analysis

Four gates run in the pre-commit hook (when `tools/` or `.devcontainer/`
changes) and in CI, and all must pass with zero findings:

- `tsc --noEmit` (`pnpm typecheck`) — the strict type gate.
- `eslint tools` (`pnpm lint:ts`) — unused code, strip-only syntax rules, and
  the type-aware `no-floating-promises` / `no-misused-promises` rules: an
  unawaited async provider check (`authStatusOk`) tests a Promise, which is
  always truthy, so the gate it guards can never fire.
- `lint-scripts` — shellcheck over the remaining bash; fix errors and do not
  add disables without a comment explaining why.
- The vitest suite (`bash tools/tests/run-devenv-tests.sh`).

TypeScript tools execute natively under node, so every job that runs a tool
needs Node 24.18 or newer (`engines` in `package.json`; CI pins `24.18.0`,
kept in lockstep with `NODE_VERSION` in `.devcontainer/tool-versions.bash`).

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
