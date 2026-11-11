# Devenv Test Suite

One lane, one gate:

- **vitest** — `tools/tests/ts/**/*.test.ts`, run by `pnpm test` (or
  `pnpm test:ts`). The bats corpus retired with the Phase-11 port: the
  fork×3 suites and the isolation canary run as vitest suites driving the
  same pty machinery (`script -qec`) from the shared harness
  (`tools/tests/ts/harness/`), and the parallel stub system lives in
  `stubCli` (call-log convention included).

The one stay-bats suite is the manual-only live lane (below): it hits real
provider APIs and never runs in the gate — kept in bats behind an explicit
runner invocation (the recorded Phase-11 lane decision).

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

Each provider adapter can carry a live smoke suite beside it
(`tools/lib/providers/azure/smoke.ts`; the GitHub adapter gets
`tools/lib/providers/github/smoke.ts`). These are special-case, on-demand
suites that exercise a real backend:

- They are never part of the regular run: they live outside
  `tools/tests/ts/`, no vitest include pattern collects them, and no
  regular test imports or spawns one (`provider-smoke-guard.test.ts` pins
  all three).
- Each refuses to run without an explicit opt-in variable and a throwaway
  target (Azure: `AZURE_SMOKE=1` read-only, `AZURE_SMOKE=write` plus
  `AZURE_SMOKE_CONFIRM=<test project>` for the destructive tier).
- Run one by hand when the adapter layer changes (a verb added or changed,
  a transport or auth change, a provider CLI upgrade), for example
  `node tools/lib/providers/azure/smoke.ts` with the opt-in set, against a
  disposable project.

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

### Bootstrap & Container

- `bootstrap-functions.test.ts` - Bootstrap script functions and error handling (ported from `test_bootstrap_functions.bats`)
- `test_container_start.bats` - Container startup locking and coordination
- `test_install_extras.bats` - Install-extras script validation
- `test_background_updates.bats` - Background update checker

### Hygiene & Standards

- `test_outdated_comments.bats` - Checks for TODO/FIXME and commented-out code
- `test_function_documentation.bats` - Function documentation standards
- `test_logging_documentation.bats` - Logging framework documentation validation
- `test_magic_numbers.bats` - Validates readonly constants instead of magic numbers
- `test_pre_commit_hooks.bats` - Pre-commit hook validation

### Issue & Project Management

- `test_issue_grooming_wizard.bats` - Issue grooming wizard validation
- `test_issue_management.bats` - Issue create/list/update/close/select scripts
- `test_project_management.bats` - Project add-issue and update-issue scripts

### Service Configuration

- `test_services_config.bats` - Service configuration repository management

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

1. Run with verbose output: `bats -t tests/test_file.bats`
2. Run with debug mode: `DEBUG=1 bats tests/test_file.bats`
3. Check test temp directory (not cleaned up on failure for inspection)
4. Add `echo` statements in tests for debugging
5. Run single test: Use `bats tests/test_file.bats -f "test name pattern"`

## Adding New Tests

When adding new scripts or functions:

1. Create corresponding test file (or add to existing)
2. Test happy path (normal successful execution)
3. Test error conditions
4. Test edge cases
5. Verify script syntax with `bash -n`
6. Run `./tests/run-tests.sh` to ensure no regressions

## See Also

- [BATS Documentation](https://bats-core.readthedocs.io/)
- [Function Naming Conventions](../../docs/Function-Naming-Conventions.md)
