#!/usr/bin/env bats
# Surface tests for tools/tests/run-devenv-tests.sh — the runner's parallel
# interface (constants, flag validation, sequential escape hatch). These are
# static surface checks only: the full suite is never executed from here.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    RUNNER="$PROJECT_ROOT/tools/tests/run-devenv-tests.sh"
}

@test "run-devenv-tests.sh exists and is executable" {
    [ -x "$RUNNER" ]
}

@test "run-devenv-tests.sh has valid bash syntax" {
    run bash -n "$RUNNER"
    [ "$status" -eq 0 ]
}

@test "run-devenv-tests.sh defines the parallel job constants" {
    grep -q 'readonly MAX_PARALLEL_JOBS=' "$RUNNER"
    grep -q 'DEFAULT_PARALLEL_JOBS=' "$RUNNER"
}

@test "run-devenv-tests.sh default jobs derive from nproc with fallback" {
    grep -q 'nproc' "$RUNNER"
}

@test "run-devenv-tests.sh validates --jobs arguments" {
    grep -q -- '--jobs)' "$RUNNER"
    grep -q 'requires a numeric argument' "$RUNNER"
}

@test "run-devenv-tests.sh supports --sequential" {
    grep -q -- '--sequential)' "$RUNNER"
}

@test "run-devenv-tests.sh caps requested jobs with a warning" {
    grep -q 'WARNING: Requested' "$RUNNER"
    grep -q 'parallel_jobs=$MAX_PARALLEL_JOBS' "$RUNNER"
}

@test "run-devenv-tests.sh passes --jobs to bats only when parallel" {
    grep -q 'bats_args+=(--jobs' "$RUNNER"
}

@test "run-devenv-tests.sh runs one bats invocation over collected files" {
    # The single-invocation design is what enables parallel scheduling; the
    # old three-globs shape (three separate `bats "$TESTS_DIR/<dir>"/*.bats`
    # blocks) would serialize the groups again.
    ! grep -q 'bats "\$TESTS_DIR/lib"/\*.bats' "$RUNNER"
    grep -q 'bats "${bats_args\[@\]}" "${test_files\[@\]}"' "$RUNNER"
}

@test "run-devenv-tests.sh echoes total duration" {
    grep -qF 'start_time=$(date +%s)' "$RUNNER"
    grep -qF 'duration: $((end_time - start_time))s' "$RUNNER"
}

@test "run-devenv-tests.sh rejects unknown options with exit 1" {
    run bash -c "echo q | '$RUNNER' --bogus-option" 2>/dev/null
    # Unknown option must fail fast without running the suite
    grep -q 'ERROR: Unknown option' <<< "$(bash "$RUNNER" --bogus-option 2>&1)"
    run bash -c "'$RUNNER' --bogus-option >/dev/null 2>&1"
    [ "$status" -eq 1 ]
}

@test "run-devenv-tests.sh rejects non-numeric --jobs with exit 1" {
    run bash -c "'$RUNNER' --jobs abc >/dev/null 2>&1"
    [ "$status" -eq 1 ]
}
