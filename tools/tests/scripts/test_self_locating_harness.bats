#!/usr/bin/env bats
# Regression test for the wrong-suite hazard (spike-001 F1): an exported
# DEVENV_TOOLS pointing at a foreign tree must not redirect devenv's own
# scripts. Asserts resolution identity — never test counts, which drift.

load ../test_helper

PROJ_ROOT="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"
RUN_TESTS="${PROJ_ROOT}/tools/tests/run-devenv-tests.sh"
LINT_SCRIPTS="${PROJ_ROOT}/tools/scripts/lint-scripts.sh"
LINT_DOCS="${PROJ_ROOT}/tools/scripts/lint-documentation.sh"
RESOLVER="${PROJ_TOOLS:-${PROJ_ROOT}/tools}/lib/self-root.bash"

@test "setup: harness and resolver exist" {
    [ -f "$RUN_TESTS" ]
    [ -f "$RESOLVER" ]
}

@test "harness resolution identity: resolver keyed on the harness path yields own checkout despite foreign DEVENV_TOOLS" {
    # The harness itself resolves via devenv_resolve_tools_root; probing the
    # resolver with the harness's BASH_SOURCE asserts the identity without
    # executing the whole suite (sourcing the harness runs it).
    run bash -c '
        source "'"$PROJ_ROOT"'/tools/lib/self-root.bash"
        DEVENV_TOOLS=/nonexistent/foreign/tools devenv_resolve_tools_root "'"$RUN_TESTS"'"
    '
    [ "$status" -eq 0 ]
    [ "$output" = "${PROJ_ROOT}/tools" ]
}

@test "harness copied to a bare checkout runs THAT checkout's suite (sentinel proof)" {
    # Self-location is real only if a copy of the harness in another checkout
    # executes that checkout's tests, not the project's. A sentinel bats file
    # that emits a unique marker proves whose suite ran.
    local bare marker
    bare="$(mktemp -d)"
    marker="SELFLOC_SENTINEL_$$_$RANDOM"
    mkdir -p "$bare/tools/tests/lib" "$bare/tools/lib"
    cp "$RUN_TESTS" "$bare/tools/tests/run-devenv-tests.sh"
    cp "$PROJ_ROOT/tools/lib/self-root.bash" "$bare/tools/lib/"
    printf '#!/usr/bin/env bats\n\n@test "%s" { true; }\n' "$marker" \
        > "$bare/tools/tests/lib/test_sentinel.bats"

    run env -u DEVENV_TOOLS -u DEVENV_ROOT timeout 60 bash "$bare/tools/tests/run-devenv-tests.sh"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$marker"* ]]

    rm -rf "$bare"
}

@test "foreign DEVENV_TOOLS does not abort the harness (pre-fix behavior was fatal)" {
    # Pre-fix, DEVENV_TOOLS=/nonexistent/... made TESTS_DIR point nowhere and
    # the harness exited 1. Post-fix it must proceed to run tests (we abort
    # the actual run via timeout-free head probing is flaky, so assert the
    # no-error header line appears and no 'not found' failure).
    run bash -c "DEVENV_TOOLS=/nonexistent/foreign/tools timeout 120 bash '$RUN_TESTS' < /dev/null 2>&1 | head -5"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Running Devenv test suite..."* ]]
    [[ "$output" != *"Test directory not found"* ]]
}

@test "lint-scripts survives foreign DEVENV_TOOLS/DEVENV_ROOT" {
    run env DEVENV_TOOLS=/nonexistent/foreign/tools DEVENV_ROOT=/nonexistent/foreign \
        bash "$LINT_SCRIPTS" --help
    [ "$status" -eq 0 ]
}

@test "lint-documentation self-derives DEVENV_ROOT despite foreign env" {
    run env DEVENV_ROOT=/nonexistent/foreign DEVENV_TOOLS=/nonexistent/foreign/tools \
        bash -c "printf '' | bash '$LINT_DOCS' /dev/null 2>&1"
    # Must not die with the old 'DEVENV_ROOT is not set' or foreign-path errors;
    # /dev/null as file arg exits cleanly (nothing to lint).
    [[ "$output" != *"DEVENV_ROOT is not set"* ]]
    [[ "$output" != *"/nonexistent/foreign"* ]]
}

@test "resolver contract: exported value matching self root is honored (no behavior change for legit redirects)" {
    run bash -c '
        source "'"$PROJ_ROOT"'/tools/lib/self-root.bash"
        DEVENV_TOOLS="'"$PROJ_ROOT"'/tools" devenv_resolve_tools_root "'"$PROJ_ROOT"'/tools/scripts/anything.sh"
    '
    [ "$status" -eq 0 ]
    [ "$output" = "${PROJ_ROOT}/tools" ]
}
