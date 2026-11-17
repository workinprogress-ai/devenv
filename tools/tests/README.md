# Devenv Test Suite

One lane, one gate:

- **vitest** — `tools/tests/ts/**/*.test.ts`, run by `pnpm test` (or
  `pnpm test:ts`). Suites that need a terminal (the fork suites, the
  isolation canary) drive a pty (`script -qec`) from the shared harness
  (`tools/tests/ts/harness/`), and the parallel stub system lives in
  `stubCli` (call-log convention included).

The one suite outside that lane is the manual-only live lane (below), written
for the `bats` runner: it hits real provider APIs and never runs in the gate,
only through an explicit invocation.

## Shared vitest harness (`tools/tests/ts/harness/`)

Black-box suites spawn tools and assert on status/output; the spawn/stub/
tmp boilerplate is shared, not per-suite:

- `runTool(tool, args, {env, stdin, cwd})` — spawn `tools/ts/<tool>.ts`
  as a node child; returns `{status, stdout, stderr, output}`.
- `stubCli(dir, name, script)` / `stubGh(dir, mode?)` / `stubGit(dir,
  repoRoot, mode?)` — PATH-stub factories; every stub call logs one line
  to `<dir>/calls.log` (`stubCalls(dir, name?)` reads it back) so
  "destructive command NOT issued" assertions count invocations.
- `toolScript(tool)` — absolute path of `tools/ts/<tool>.ts`. A suite runs
  a tool as `spawnSync("node", [toolScript(tool), ...args])` (or through
  `runTool`) and never through the depth-1 stubs in `tools/<tool>`: those
  are generated install artifacts (`.devcontainer/entry-stubs-sync.sh`)
  and do not exist in a clean checkout. A suite that needs a fixture
  checkout with stubs writes the two-line stub into the fixture itself.
- `useProviderDown()` — puts a `gh` and `az` that exit 1 first on `PATH`,
  for suites whose contract is behaviour when the provider is down.
- `pathWithStubs(dir)` — the PATH prefix value.
- `tmpDir(prefix)` / `tmpToolboxRoot(prefix, org)` — throwaway fixture
  roots (the latter writes a github-provider `devenv.config`); `rmrf`
  cleans up.

Import surface: `import { runTool, stubGh, ... } from "./harness/index.ts"`.
A suite with behavioral stub modes passes the whole script body via
`stubGh`/`stubGit`'s mode parameter — the factory owns only the
boilerplate. `issue-comment-list.test.ts` is the reference migration.

`bash tools/tests/run-devenv-tests.sh` runs the vitest lane — one command is the whole gate; `pnpm test` aliases it.

## Hermetic by construction: tests never reach a provider backend

The regular run must never touch GitHub, Azure DevOps or any other real
backend, in any environment. Every provider call is mocked. A setup file
(`harness/scrub-env.ts`, registered in `vitest.config.ts`) runs before every
test file and makes the guarantee structural:

- `process.env` is reduced to an allow-list (`harness/env.ts`): no `DEVENV_*`,
  config folders, provider variables, credentials, ssh agent or editor.
- `DEVENV_ROOT` points at a per-worker fixture root holding
  `fixtures/devenv.test.config` (the github-provider config), so a checkout's
  own `devenv.config` never selects the provider under test. A suite that
  needs another provider or root sets its own value.
- `HOME` is an empty directory with a fixed git identity, and every devenv
  tools directory (the generated stubs) is removed from `PATH`.
- A canary fails the test that reaches a backend: a shim executable for every
  entry of `CANARY_COMMANDS` (`harness/canary.ts`: provider and network
  clients, package managers, remote-copy tools, host-affecting commands) sits
  first on `PATH` (a suite's own stub
  directory shadows them), a fetch guard rejects every non-loopback request in
  the worker and in every spawned node process, and a check after every test
  and after every file turns a recorded hit into a failure. `git` is not
  shimmed (suites need it and use local file remotes); instead the worker sets
  `GIT_ALLOW_PROTOCOL=file` and the fixture `.gitconfig` allows only the file
  transport, so a clone, fetch, push or ls-remote over https or ssh fails. What
  it does not cover: a direct `node:http`/`https`/`net` client would bypass the
  fetch guard, which
  is why `network-egress-guard.test.ts` forbids one in regular tool code. A
  suite that builds a minimal env for a child process spreads `canaryEnv()`
  into it so the shims and the preload still apply; a suite that builds its
  `PATH` from scratch bypasses them and must stub `gh` and `az` itself.
  `useProviderDown()` is the explicit exception: it answers "provider
  unavailable" for the whole file, so use it only where that is the contract
  under test.

## Provider smoke suites: the only code that may touch a backend

Each provider adapter carries a live smoke suite beside it:
`tools/lib/providers/azure/smoke.ts` and `tools/lib/providers/github/smoke.ts`. They are
special-case, on-demand suites that exercise a real backend, documented in full beside the
adapters: [GitHub](../lib/providers/github/SMOKE.md) and
[Azure](../lib/providers/azure/SMOKE.md).

- **When to run one.** By hand, when the adapter layer changes: a verb added or changed, a
  transport or authentication change, a provider CLI upgrade. CI never runs them and the
  regular run never collects them: they live outside `tools/tests/ts/`, no vitest include
  pattern matches them, and no regular test imports or runs one against a backend
  (`provider-smoke-guard.test.ts` pins all of this).
- **How to opt in.** Each refuses to run (exit code 2, no request made) without explicit
  variables. GitHub: `GITHUB_SMOKE=write`, `GITHUB_SMOKE_OWNER=<test organisation>` and
  `GITHUB_SMOKE_CONFIRM=<the same organisation>`, plus `GITHUB_SMOKE_ALLOW_REAL_ORG` when the
  target is the organisation configured in `devenv.config`. Azure: `AZURE_SMOKE=1` (read-only)
  or `AZURE_SMOKE=write` with `AZURE_SMOKE_CONFIRM=<test project>` (destructive), plus
  `AZURE_DEVOPS_ORG`, `AZURE_SMOKE_TEST_PROJECT` and `AZURE_PAT`.
- **What each creates and cleans up.** The GitHub suite creates its own private repository
  `devenv-smoke-<pid>-<timestamp>` in the test organisation, plus a project and a team at
  organisation level, and exercises issues, pull requests, projects, pipelines, organisation
  rulesets and repositories against them; it records every item it creates and deletes only
  those at the end. The Azure suite works inside one pre-existing disposable test project and
  deletes the work items, repository and policies it created.
- **Cost and permissions.** Both need a real credential with write access in the test target.
  The GitHub suite needs repository, `delete_repo`, `workflow`, `project` and organisation
  admin scopes, uses a little Actions time and a few hundred API calls, and leaves audit-log
  entries. The Azure suite needs Code, Pull Request, Work Items, Boards, Build, Packaging and
  Policy rights on the test project. Scenarios the account or plan cannot support skip with a
  reason instead of failing.
- **Guard test.** `provider-smoke-guard.test.ts` runs without a backend: it spawns each suite
  with failing `gh`, `curl`, `az` and `git` stubs on `PATH` to prove the opt-in refusal reaches
  no backend, reads the GitHub suite's registry with `--list-coverage`, and checks it against the
  contract table: every verb in the contract's GitHub column is exercised by a scenario or listed
  as excluded with a reason.

## Test hygiene: scratch artifacts live in tmp, never in the repo

Suites that execute extracted bash functions or stub CLIs must route every
fixture path through a scratch-dir guard: a helper that throws unless the
base directory is absolute and under `os.tmpdir()`. A lost/unset temp root
would otherwise resolve fixture paths relative to the CWD and scatter (or
overwrite) files in the repo — this has happened once, which is why the rule
is a guard, not a convention. `tools/tests/ts/bootstrap-functions.test.ts`
(`tmpPath`) is the reference implementation.

## Running Tests

### Run all tests (the default)

```bash
./tools/tests/run-devenv-tests.sh
```

The runner executes the vitest lane (`tests/ts/`). Jobs default to `nproc`,
capped by `MAX_PARALLEL_JOBS` (currently 8); `--jobs` sizes the worker pool
(`--sequential` runs single-worker) so a full sweep cannot exhaust the
container's thread limit.

### Manual-only: `live/`

`live/` is **not** collected by the runner and never runs in `pnpm test`: it
exercises real provider APIs against an org scratch project and needs
credentials. Run it by hand, gated on `RUN_LIVE_TESTS=1` (see the header of
`live/project_tools.live.bats` for the full invocation):

```bash
RUN_LIVE_TESTS=1 SCRATCH_PROJECT=tooling-scratch DEVENV_REPO=<org>/<repo> bats tools/tests/live/
```

### Runner flags

```bash
./tools/tests/run-devenv-tests.sh --jobs 4     # explicit parallelism
./tools/tests/run-devenv-tests.sh --sequential # debugging: jobs=1
./tools/tests/run-devenv-tests.sh --help
```

`--jobs N` accepts a numeric argument; values above the cap are limited with a
warning. A failing suite exits non-zero in both modes, and the runner echoes
total duration.

### Run a specific test file

```bash
pnpm exec vitest run tools/tests/ts/fork-export.test.ts
```

### Run tests with verbose output

```bash
pnpm exec vitest run --reporter=verbose
```

## Parallel-Safety Contract

Every test must be safe to run concurrently with every other test. The shared
harness (`tools/tests/ts/harness/`) provides this by default — each test
derives its fixtures from scratch roots (`tmpDir`), so global state writes
land in per-test temp directories. The rules for new tests:

- **Use the harness** (`tmpDir`, `tmpToolboxRoot`, `stubCli`, `runTool`) —
  don't hand-roll setup that skips scratch isolation.
- **Never write to real user state** — no `git config --global` against the
  real `~/.gitconfig`; use `GIT_CONFIG_GLOBAL` or a scratch `HOME`.
- **Never use fixed shared paths** — no `/tmp/my-fixture` literals; derive
  from the suite's scratch root. Path-assertion fixtures (asserting a string
  *equals* a path without touching it) are fine.
- **Never `pkill -f` by name** — the pattern can match other tests'
  in-flight processes. Kill only PIDs recorded in your own PID file under
  the scratch root.
- **No fixed shared filenames** for files written in `beforeEach` and removed
  in `afterEach` — under parallel workers, test cases run in separate
  processes and will race. Use `mkdtempSync`.

If a test cannot meet the contract, mark it and run it sequentially — don't
make the suite flaky for everyone.

## Writing Tests

### Provider Seam vs. CLI Mocking

Neutral-layer code (`tools/lib/*.ts` facades, wrapper scripts) calls the
TS provider modules, never a provider CLI directly — and their tests stub
at the same seam (`stubGh` with mode scripts, or the facade over a stubbed
transport). Mocking the `gh` binary works only because github is the active
provider; under any other provider the neutral code path never touches `gh`
and the mock silently stops firing. Provider-scoped suites legitimately
stub the CLI — that IS their boundary.

### Basic Test Structure

Suites follow the established black-box pattern: spawn the tool (or source
the seam) in a child process, assert on status and output. Use the shared
harness for spawn/stub/tmp boilerplate; one `it` per pinned behavior.

## Test Coverage Areas

Every suite is a `*.test.ts` file directly under `tools/tests/ts/`, named for
the tool or library it covers. The main groupings:

- **Tools, one suite per wrapper family** — `issue-*.test.ts`, `pr-*.test.ts`,
  `git-*.test.ts`, `repo-*.test.ts`, `kube-*.test.ts`, `mongo-*.test.ts`,
  `fork-*.test.ts`, `commit-*.test.ts` and the `cli-contract-*.test.ts`
  sweeps that pin option parsing and exit codes across tools.
- **Provider layer** — `provider-*.test.ts`, `azure.test.ts`,
  `github-*.test.ts`, `facade-loader.test.ts`: the facade, capability gates,
  transport, auth, the routing lock and the bash/TypeScript agreement matrix.
- **Core libraries** — `core-*.test.ts`, `config-reader.test.ts`,
  `error-handling.test.ts`, `lib-core.test.ts`, `domain-*.test.ts`.
- **Bootstrap and container** — `bootstrap-functions.test.ts`,
  `container-start.test.ts`, `background-updates.test.ts`,
  `entry-stubs-sync.test.ts`, `devcontainer-json.test.ts`,
  `unwip-install-extras.test.ts`.
- **Hygiene and standards** — `outdated-comments.test.ts`,
  `function-documentation.test.ts`, `logging-documentation.test.ts`,
  `magic-numbers.test.ts`, `naming-conventions.test.ts`,
  `pre-commit-hooks.test.ts`, `identity-docs.test.ts`,
  `lint-documentation.test.ts`, `lint-skills.test.ts`.

## Best Practices

1. **Test naming**: Use descriptive test names that explain what is being tested
2. **Isolation**: Each test should be independent and not rely on other tests
3. **Cleanup**: Always clean up in teardown, even if test fails
4. **Mocking**: Use mock data/repos instead of real GitHub API calls
5. **Fast tests**: Keep tests fast by avoiding unnecessary delays
6. **Clear assertions**: Use clear, specific assertions that explain failures

## CI Integration

Tests run automatically in GitHub Actions on:

- Pull requests
- Pushes to main/master
- Manual workflow dispatch

## Debugging Failed Tests

1. Run with verbose output: `pnpm exec vitest run tools/tests/ts/<file>.test.ts --reporter=verbose`
2. Run a single test by name: `pnpm exec vitest run tools/tests/ts/<file>.test.ts -t "test name pattern"`
3. Check the test's scratch directory (not cleaned up on failure, when the suite keeps it) for inspection
4. Add `console.log` statements in the test for debugging

## Adding New Tests

When adding new scripts or functions:

1. Create corresponding test file (or add to existing)
2. Test happy path (normal successful execution)
3. Test error conditions
4. Test edge cases
5. Run `./tools/tests/run-devenv-tests.sh` to ensure no regressions

## See Also

- [Vitest Documentation](https://vitest.dev/)
- [Function Naming Conventions](../../docs/Function-Naming-Conventions.md)
