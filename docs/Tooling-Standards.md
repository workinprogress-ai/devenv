# Tooling Standards Guide

How to write, structure, and test tools in this repo's `tools/` suite. These
standards are enforced by review and (where noted) by the type gate, eslint,
shellcheck (`lint-scripts`), and the test suites. Every new tool is TypeScript
and starts from `tools/templates/script-template.ts` (via
`tooling-create-script <name>`), which embodies this guide. The small bash
that remains is the container bootstrap layer, described under
[The bash that remains](#the-bash-that-remains).

Related docs: [Function Naming Conventions](Function-Naming-Conventions.md),
[Additional Tooling](Additional-Tooling.md).

Note that CI enforces both halves of docs quality: changed markdown is run
through `markdownlint-cli2` **and** `markdown-link-check` in the
`lint-markdown` job — a PR with broken links or lint failures will not pass.

## The golden rules

1. **Parse arguments through `toolCli`** (`tools/lib/core/cli.ts`) — it
   supplies the house flags (`-h`, `-v`, `-V`, `-n`, `--devenv`), strict
   parsing and the version banner. Never write your own flag loop.
2. **Log through `tools/lib/core/logging.ts`** (`logInfo`, `logWarn`,
   `logError`, ...). Never define your own logger or print ad-hoc prefixes.
3. **Exit with the named constants from `tools/lib/core/exit-codes.ts`**,
   never bare numbers — `EXIT_MISUSE`, not `2`. `EXIT_SUCCESS` (0) is the
   only code that may be written as a literal.
4. **Never read stdin without a TTY guard** — a bare read on an interactive
   terminal hangs the session. Use `resolveBodySource` (`lib/core/body-source.ts`).
5. **`--help` must work without auth, network, or positional arguments** —
   handle it before any validation or provider authentication, and run
   nothing at module load that needs a host.
6. **Fail on a rejected promise**: top-level `main()` ends in
   `.then(code => process.exit(code), err => { logError(...); process.exit(1) })`
   so an unhandled failure never exits 0 (the template shows the shape).

## TypeScript standards

All new tooling is TypeScript executed natively by Node type-stripping
(no build step, no tsx/ts-node). The root `package.json` carries
`"type": "module"` (ESM everywhere); legacy `.js` configs are ESM
(`export default`). `.ts` sources use `import` syntax and run via
`exec node <script>.ts` from the generated depth-1 stub (a two-line shell
shim that execs node). `tsconfig.json` is strict
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
| `lib/core/commands.ts` | external-command presence checks |
| `lib/core/body-source.ts` | markdown/text body resolution (flag, file, stdin with TTY guard) |
| `lib/core/cli.ts` | `toolCli`: house flags, strict parse, usage blocks |
| `lib/core/node-floor.ts` | Node ≥23.6 guard |
| `lib/core/config.ts` | devenv.config parsing (raw vs expanding values) |
| `lib/core/args.ts` | option/argument parsing and requirement checks |
| `lib/core/change-id.ts` | Change-Id trailer generation/parsing + O_EXCL locking |
| `lib/core/editor.ts` | editor selection (PREF_EDITOR → FALLBACK_EDITOR → nano) |
| `lib/core/git.ts` | git plumbing (state, branches, WIP guards, rewrite detection) + `changedFiles` changed-set enumeration (`-z` porcelain, rename pairs split) |
| `lib/ui/` | prompts, progress, panels (clack + picocolors) |
| `lib/domain/events.ts` | lifecycle event signals (PR + skill events); reads the PR body through the provider facade |
| `lib/domain/issues/` | issue type/label config model + issue graph |
| `lib/domain/repos/` | repo-type config model (zod) |
| `lib/domain/release/` | release/PR version plumbing (`version.ts`) |
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

## The bash that remains

**TypeScript is the default for anything with logic.** Bash persists only
where a file must be bash by its nature or must run before node exists. Porting
preserves the black-box contract (argv, exit codes, output wording); behavior
changes are separate commits, never bundled with a port. Anything not listed
below is TypeScript.

| Kind | Members | Reason |
|---|---|---|
| exec glue | `tools/<name>` depth-1 stubs, git-hook shims (`.husky/`), `tools/internal/` entry points (`_on_*.sh`, the `prepare-commit-msg` and `commit-action-check` shims), the `tools/run-devenv-tests` wrapper | an entry point must be an executable file; a stub holds no logic, it execs |
| shell runtime artifacts | `git-completion.bash`, `bash_completion_custom`, `bash-prompt.sh`, `zsh-prompt.sh` | files that ARE bash by their nature |
| host-side setup | the `setup` script | runs before a container, and before node, exists |
| container bootstrap | `.devcontainer/*.sh` / `*.bash`, and the bootstrap surface under `tools/lib/` (see below) | runs before node is installed |

**The bootstrap surface.** The bash under `tools/lib/` is exactly this
allowlist, and nothing else belongs there:

```text
config-reader.bash            copilot-knowledge.bash      error-handling.bash
providers/provider-core.bash
providers/github/{auth,setup,bootstrap}.bash
providers/azure/{auth,setup,bootstrap}.bash
providers/azure/credential-helper.sh
```

`error-handling.bash` is reduced to the `log_debug`/`log_info`/`log_warn`/
`log_error` functions the provider layer calls; `config-reader.bash` reads
`devenv.config`. No tool sources them. What each file keeps, and which
bootstrap step sources it, is documented once in the providers README, under
[Bash bootstrap surface](../tools/lib/providers/README.md#bash-bootstrap-surface);
do not extend these files with new verbs. Where the bash and TypeScript layers
must give the same answer (provider detection, identity, the organization a
remote names), `tools/tests/ts/provider-bash-agreement.test.ts` pins them.

**Doctrine, not a CI gate.** Membership of the bash categories is enforced by
review, not by a build failing on the sight of a `.sh` file. A new bash file
needs a named reason in review: why it must run before node, or why it must be
a shell file. A broken node is not preserved as a fallback for tool bodies;
tools keep their depth-1 stubs and their black-box contracts.

**Test format:** every suite is vitest under `tools/tests/ts/`. Suites that
need a real terminal (pickers, interactive prompts) drive a `script -qec` pty
through `tools/tests/ts/harness/pty.ts`, and suites that exercise real git-hook
execution do so in a fixture repository. The one manual-only exception is
`tools/tests/live/` (live provider calls), which is never collected by the
gate.

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
TypeScript — fd numbers do not survive process spawn — so a lock is a
lockfile protocol. Reference implementation:
`lib/core/change-id.ts` (`locked()`). Extract a shared `lib/core/lock.ts`
when a second consumer appears; do not create it speculatively.

## Tool skeleton (required structure)

`tooling-create-script <name>` generates this from
`tools/templates/script-template.ts`; the template is the source of truth.

```ts
#!/usr/bin/env node
// my-tool.ts - One-line description
// Version: 1.0.0

import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();   // first: an old Node otherwise dies with a raw syntax error

const SCRIPT_VERSION = "1.0.0";
const TOOL_NAME = "my-tool";

function showUsage(): never {
  console.log(`Usage: ${TOOL_NAME} [OPTIONS]
...
Options:
${usageCommonFlags()}
`);
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  try {
    const cli = toolCli({ name: TOOL_NAME, version: SCRIPT_VERSION, argv });
    if (cli.common.help) showUsage();   // before auth, validation, anything that can fail
    // ... tool flags: cli.values["..."]; positionals: cli.positionals
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    console.error("Use --help for usage information");
    return 2;                           // EXIT_MISUSE
  }
  // ... the tool's behavior; authenticate here if it talks to the provider
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => { logError(err instanceof Error ? err.message : String(err)); process.exit(1); },
);
```

Import paths are relative to the tool's folder; `tooling-create-script`
rewrites the template's `REL_LIB` prefix for the output directory (`--dir`,
default `scripts/`) so the imports resolve wherever the file is created.

## Where a tool lives

A tool's source lives in one of three folders, and `.devcontainer/entry-stubs-sync.sh`
generates the bare-name stub in `tools/` from the winning file:

- `tools/ts/` — the provided TypeScript tool bodies (the Node ≥ 23.6
  type-stripping sources the node stubs dispatch to).
- `tools/fork/` — a fork's own or overriding tools (committed in the fork).
- `tools/custom/` — a user's own or overriding tools (gitignored, machine-local).

A same-named file in a higher folder wins: custom over fork over ts.
The sync runs at bootstrap; re-run it after adding or removing an override. See
[Forking](./Forking.md#adding-and-overriding-tools-toolsfork-and-toolscustom).

When one tool invokes another devenv tool, it names an **exact path inside the
tools root** — never a bare name for PATH lookup. The default form is the
depth-1 stub, `join(toolsDir, "<tool>")`, which honors the override chain
(a fork's `tools/fork/<tool>` wins, exactly as for users). One exception: the
repo-get dispatcher family (`git-repo`) invokes its same-layer source,
`join(toolsDir, "ts", "repo-get.ts")`, preserving the same-directory
dispatch contract. External CLIs (`git`, `node`, `dotnet`, …) keep PATH
invocation — the rule covers devenv tools only. The
`sibling-dispatch.test.ts` suite enforces both halves: no devenv tool is
spawned by bare name, and every constructed stub path resolves to a real
file.

A fourth folder, `tools/internal/`, is **not** part of that override chain:
it holds machinery scripts that the devenv or githook machinery invokes —
scripts a user would generally never run by hand (lifecycle event entry
points `_on_*.sh`, the `prepare-commit-msg` githook backing script, the
CI commit-message checker, each a thin shim over a TypeScript body). Internal scripts get no depth-1 stub, are not
on `PATH`, are excluded from the `tools/*` gitignore whitelist via
`!tools/internal/`, and are not overridden by `tools/fork/` or
`tools/custom/`. See
[Additional Tooling — Internal machinery scripts](./Additional-Tooling.md#internal-machinery-scripts-toolsinternal).

## Library catalog

The TypeScript module catalog above is the library catalog: import what you
use from `tools/lib/`. The two modules every tool reaches for first:

| Module | Provides |
|---|---|
| `lib/core/logging.ts` | `logDebug`, `logInfo`, `logWarn`, `logError`, `logFatal`, `logSuccess`, `setLogLevel`, `errorMessage` |
| `lib/core/args.ts` | `invalidArgs` (log, hint, exit 2), `requireOptionValue`, `requireString`, `requireEnv`, `requireFile`, `requireDirectory` |
| `lib/core/body-source.ts` | `resolveBodySource` — the shared resolver for tools that accept markdown/text bodies |
| `lib/core/commands.ts` | `commandAvailable`, `requireCommand`, `requireCommandOrExit` for external CLIs |

The bash libraries under `tools/lib/` are the bootstrap allowlist described
under [The bash that remains](#the-bash-that-remains); a tool never sources them.

## Exit-code contract (suite-wide)

Use the constants from `tools/lib/core/exit-codes.ts`. Never invent numbers.
The exported names are `EXIT_SUCCESS`, `EXIT_GENERAL_ERROR`, `EXIT_MISUSE`,
`EXIT_CONFLICT`, `EXIT_API_FAILURE` and `EXIT_AMBIGUITY`.

| Constant | Value | Use for |
|---|---|---|
| `EXIT_SUCCESS` | 0 | Success (a literal `0` is fine) |
| `EXIT_GENERAL_ERROR` | 1 | Anything that failed and isn't classified below |
| `EXIT_MISUSE` | 2 | Invalid arguments, unknown options, missing flag values, bad usage |
| `EXIT_CONFLICT` | 3 | Duplicate/ambiguous match where exactly one was required |
| `EXIT_API_FAILURE` | 4 | Provider/API operation failed, or the target was not found |
| `EXIT_AMBIGUITY` | 5 | Multiple equally valid candidates and no default (a tool-local convention, used by `issue-artifact-select`) |

Rules:

- Semantic intent wins over historical numbers. "Issue not found" is **4**, not
  1, even if the script historically exited 1.
- Usage/help errors ("missing value for -f", "unknown option", "PR number is
  required") are **2**.
- Validate every argument and option value before the first mutation or
  provider call; a bad value exits 2, never 0 and never 1.
- Document the codes your tool actually uses in its usage text.

## Argument parsing: the CLI contract

Every tool in `tools/ts` follows one contract, enforced by
`tools/tests/ts/cli-contract-sweep.test.ts` (source checks for every tool, plus
a `--help` probe for tools with no host-affecting calls):

- **One parse through `toolCli`** (`tools/lib/core/cli.ts`), strictly: no
  `strict: false`. `-h/--help`, `-v/--version`, `-V/--verbose`, `-n/--dry-run`
  and `--devenv` come from the house table; a tool advertises only the house
  flags it honors (`usageCommonFlags({ noDryRun, noDevenv })`).
- **An unknown flag is misuse**: exit 2, decided before any provider call or
  mutation, with stdout left empty (the sweep asserts this for every probed
  tool). New and changed tools print the standard
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
  authentication, capability checks, config reads, banners, spawned host
  commands — runs at module load before
  arguments are parsed and help is handled (the sweep scans every tool's
  module-load code for spawns and output before the `toolCli` call);
  authenticate on the main path, after parsing.
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
- A message or title that begins with `-` is passed as `--opt=-value` (or via
  `--body-file`): strict parsing refuses a separated dash-led value
  (`--body "- item"`) as ambiguous with exit 2. Positional message words that
  begin with `-` need `--` first (`git-wip -- -n note`).
- **Empty option values are misuse.** A mutating tool refuses `--opt ""`
  (typically an unset shell variable) with exit 2 before its first mutation:
  `toolCli({ rejectEmptyValues: true })` for the issue and PR mutators, and
  `requireString` where a tool reads a string option itself (`git-wip`,
  `pipelines-status`). The sweep probes `--opt ""` on every tool that sets
  `rejectEmptyValues`. Tools that have not adopted it yet treat an empty value
  as the option being absent.

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

Repo targeting resolves through the provider layer (explicit `--repo` →
`DEVENV_REPO` → provider-specific repo env, if the active provider defines one
→ configured org + cwd basename). `DEVENV_REPO` is the only repo-targeting
environment variable. Org identity comes from `providerOrgGet` (config
`[organization] org` → seed); a provider module owns the equivalent chain for
its backend.

- Use `providerRepoTarget` (`lib/providers/provider-core.ts`) — it resolves
  the target and runs the devenv-repo safety gate; explicit `--repo` wins
  over `DEVENV_REPO`.
- Do not hand-roll repo/org resolution chains; five historical idioms
  existed and were consolidated for exactly this reason. `GH_REPO` is
  provider-owned transport state — scripts never read or write it.

## Temp files and cleanup

- Create scratch directories with `mkdtemp` (`node:fs`) and remove them in a
  `finally` block, so an early return or a thrown error still cleans up.
- Happy-path removal alone is not cleanup; early exits leak.

## Logging and error handling

All logging comes from `tools/lib/core/logging.ts` — never define your own
logger. Output is `[YYYY-MM-DD HH:MM:SS] LEVEL: message` on stderr, with the
level right-padded; colors stay off when stderr is not a TTY (`NO_COLOR` is
honored).

| Function | Level | Use for |
|----------|-------|---------|
| `logDebug` | DEBUG | Troubleshooting detail; shown only with `-V/--verbose` (which calls `setLogLevel(LOG_LEVEL_DEBUG)`) |
| `logInfo` | INFO | Normal operational messages |
| `logSuccess` | SUCCESS | Completion messages (same threshold as INFO) |
| `logWarn` | WARN | Recoverable issues |
| `logError` | ERROR | Handled failures |
| `logFatal` | FATAL | Unrecoverable errors; logs only — the caller exits |

```ts
logDebug(`Found ${count} items to process`);
logInfo(`Processing repository: ${repoName}`);
logError("Failed to connect to the provider");
return EXIT_API_FAILURE;
```

Conventions:

- **Provide context**: `logInfo(`Processing repo: ${repo} (${count} files)`)`,
  not `logInfo("Processing")`.
- **One exit decision point**: helpers throw or return a result; `main` turns
  it into an exit code. `invalidArgs` (`lib/core/args.ts`) is the one helper
  that logs and exits 2 itself, for usage errors.
- **Report an error message** with `errorMessage(err)`, not `String(err)`.

## Interactive tools

- Prompts and pickers go through `tools/lib/ui` (clack). Declare a non-TTY
  fallback with `isInteractive()` and degrade with a clear error rather than
  hanging.
- Dry-run flags: `-n/--dry-run` comes from `toolCli`; a tool whose own flag
  needs the `-n` short passes `noDryRun`.

## Testing requirements

TypeScript tools get vitest coverage at `tools/tests/ts/<name>.test.ts`:

- Unit tests for lib modules alongside behavioral tests that spawn the tool
  and assert on status/output (black-box pattern — see `family-repos.test.ts`).
  Spawn `tools/ts/<name>.ts` through `runTool` or `toolScript` from
  `tools/tests/ts/harness/`, never through the generated depth-1 stubs, which
  do not exist in a clean checkout.
- Exit-code assertions for each error class the tool emits.
- At least one behavioral `--help` assertion (exit 0, usage on stdout).
- Stub external CLIs on `PATH` with `stubCli`, `stubGh` and `stubGit`, and
  never call a live provider from a test: the regular run is hermetic and a
  canary fails any test that reaches a backend (see
  [tools/tests/README.md](../tools/tests/README.md)).
- Tests must pass with `DEVENV_REPO`, `GH_REPO`, `DEVENV_ROOT` and
  `DEVENV_TOOLS` either set or unset — stub the environment, don't depend on it.

Run everything: `bash tools/tests/run-devenv-tests.sh` (or `pnpm test`; from a
clean environment: `env -u DEVENV_REPO -u GH_REPO ...`).

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

To skip all pre-commit checks (markdown lint, the four gates above and
`lint-skills`) for a commit, set `DEVENV_GIT_DISABLE_CHECKS` to `1`, `true`,
`yes` or `on` (case-insensitive), for example
`DEVENV_GIT_DISABLE_CHECKS=1 git commit ...`. Unset, empty, `0` and `false`
leave the checks on. The WIP gate and the `commit-msg` checks still run, and CI
runs the gates regardless.

TypeScript tools execute natively under node, so every job that runs a tool
needs Node 24.18 or newer (`engines` in `package.json`; CI pins `24.18.0`,
kept in lockstep with `NODE_VERSION` in `.devcontainer/tool-versions.bash`).

## Common mistakes this guide exists to prevent

- Capturing a helper's stdout when it returns its result another way — pick
  one channel, document it, test it.
- `--help` broken because argument validation or authentication runs before
  help is handled.
- A flag documented as repeatable but declared without `multiple: true`, so
  only the last value is kept.
- Reading stdin on a TTY (interactive hang) instead of using
  `resolveBodySource`.
- A bare exit code of `1` for not-found or invalid arguments, defeating
  programmatic use.
- A floating promise: an `async` call that is not awaited, so its failure is
  lost and the process exits 0.
- Spawning a devenv tool by bare name instead of an exact path under the tools
  root.
