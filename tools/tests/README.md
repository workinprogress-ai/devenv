# Devenv Test Suite

This directory contains automated tests for the Devenv development environment scripts.

## Overview

Tests are written using [BATS (Bash Automated Testing System)](https://github.com/bats-core/bats-core), which is installed automatically during the bootstrap process.

## Running Tests

### Run all tests (parallel — the default)

```bash
./tools/tests/run-devenv-tests.sh
```

The runner executes the whole suite (`lib/`, `scripts/`, `devenv/`) in a single
`bats --jobs` invocation. Jobs default to `nproc`, capped by `MAX_PARALLEL_JOBS`
(currently 8).

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
bats tools/tests/lib/test_error_handling.bats
```

### Run tests with verbose output

```bash
bats -t tools/tests/
```

### Run tests with debug output

```bash
DEBUG=1 bats tools/tests/
```

## Parallel-Safety Contract

Every test must be safe to run concurrently with every other test. The shared
[`test_helper.bash`](./test_helper.bash) provides this by default — each test
gets its own `TEST_TEMP_DIR` (`mktemp -d`) and a redirected `HOME`, so global
state writes land in per-test temp directories. The rules for new tests:

- **Use `test_helper.bash`** (`test_helper_setup` / `test_helper_teardown`) —
  don't hand-roll setup that skips the `HOME`/`TEST_TEMP_DIR` redirect.
- **Never write to real user state** — no `git config --global` against the
  real `~/.gitconfig`; use `GIT_CONFIG_GLOBAL` or the redirected `HOME`.
- **Never use fixed shared paths** — no `/tmp/my-fixture` literals; derive
  from `TEST_TEMP_DIR`. Path-assertion fixtures (asserting a string *equals*
  a path without touching it) are fine.
- **Never `pkill -f` by name** — the pattern can match other tests'
  in-flight processes. Kill only PIDs recorded in your own PID file under
  `TEST_TEMP_DIR`.
- **No fixed shared filenames** for files written in `setup()` and removed in
  `teardown()` — under `--jobs`, test cases of the same file run in separate
  processes and will race. Use `mktemp` (see `test_fanout_semantics.bats` for
  the pattern).

If a test cannot meet the contract, mark it and run it sequentially — don't
make the suite flaky for everyone.

## Test Structure

- `test_helper.bash` - Common helper functions and setup/teardown for each test
- `test_*.bats` - Individual test files for specific functionality

## Writing Tests

### Basic Test Structure

Test files should follow this structure:

```bash
#!/usr/bin/env bats

load test_helper

@test "description of what is being tested" {
    # Test code here
    run some_command
    [ "$status" -eq 0 ]
    [[ "$output" == *"expected string"* ]]
}
```

### Testing Functions vs. Whole Scripts

#### Testing Individual Functions

When testing library functions, source the library and call functions directly:

```bash
@test "function_name returns expected value" {
    # Source the library
    source "$DEVENV_ROOT/lib/error-handling.bash"
    
    # Call function directly
    result=$(log_info "test message")
    
    # Assert result
    [ "$status" -eq 0 ]
}

@test "function_name handles errors" {
    source "$DEVENV_ROOT/lib/error-handling.bash"
    
    # Test error condition
    run my_function "invalid_arg"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "ERROR" ]]
}
```

#### Testing Whole Scripts

When testing complete scripts, use `run` to execute them:

```bash
@test "script.sh succeeds with valid arguments" {
    run bash "$DEVENV_TOOLS/my-script.sh" --arg value
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Success" ]]
}

@test "script.sh has --help flag" {
    run bash "$DEVENV_TOOLS/my-script.sh" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Usage:" ]]
}

@test "script.sh validates syntax" {
    # Syntax check without execution
    run bash -n "$DEVENV_TOOLS/my-script.sh"
    [ "$status" -eq 0 ]
}
```

### Available Helper Functions

From `test_helper.bash`:

- `setup()` - Runs before each test (creates temp directory, sets env vars)
- `teardown()` - Runs after each test (cleans up temp directory)
- `create_mock_git_repo(path)` - Creates a mock git repository at the given path
- `function_exists(name)` - Checks if a bash function is defined

### Test Environment Variables

The following environment variables are available in tests:

- `TEST_TEMP_DIR` - Temporary directory for test artifacts
- `ORIGINAL_PWD` - Original working directory
- `DEVENV_ROOT` - Path to devenv root
- `devenv` - Path to devenv root (lowercase alias)
- `DEVENV_TOOLS` - Path to scripts/ directory
- `GH_USER` - Mock GitHub username
- `GH_ORG` - Mock GitHub organization
- `GH_TOKEN` - Mock GitHub token
- `USER_EMAIL` - Mock user email
- `HUMAN_NAME` - Mock user name
- `PROJECT_ROOT` - Legacy alias for DEVENV_ROOT (backward compatibility)

## Test Coverage Areas

### Libraries (`lib/`)

- `lib/test_error_handling.bats` - Error handling and logging functions
- `test_config.bats` - Configuration management
- `test_git_config.bats` - Git configuration utilities
- `test_versioning.bats` - Version parsing and comparison
- `test_retry_logic.bats` - Retry logic surface checks
- `test_editor.bats` - Editor function and VS Code fallback behavior (with mocked code command)
- `test_issues_config.bats` - GitHub issue type configuration and management functions

### Repository & PR scripts (`scripts/`)

- `test_repo_get_validation.bats` - Repo name validation and sourcing
- `test_repo_update_all.bats` - Parallel update flags and usage
- `test_repo_calc_version.bats` - Semantic version calculation from commits/tags
- `test_repo_bump_version.bats` - Argument validation for forced bump commits
- `test_pr_complete_merge.bats` - Conventional Commit enforcement and gh workflow (mocked)
- `test_script_usage.bats` - --help flags and usage documentation across scripts
- `test_script_versioning.bats` - Version headers and versioning library integration
- `test_script_template.bats` - Script template validation and create-script.sh

### Bootstrap & Container

- `test_bootstrap_functions.bats` - Bootstrap script functions and error handling
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
- [Contributing Guide](../docs/Contributing.md)
- [Coding Standards](../docs/Coding-standards.md)
- [Function Naming Conventions](../docs/Function-Naming-Conventions.md)
