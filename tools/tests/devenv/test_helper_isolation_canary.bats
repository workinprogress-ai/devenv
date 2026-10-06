#!/usr/bin/env bats
# The test-isolation canary in test_helper.bash must FAIL the offending test, not
# merely print a warning. A nested bats run is used, inside a throwaway project
# root with its own devenv.config copy: the inner test modifies that copy (the
# real devenv.config is never touched) and the helper's teardown must notice.

bats_require_minimum_version 1.5.0

load ../test_helper

# inner_suite <test body>: a throwaway root whose tests/devenv/ holds a one-test
# suite loading the real helper; sets INNER_FILE.
inner_suite() {
    local root="$TEST_TEMP_DIR/root"
    mkdir -p "$root/tools/tests/devenv"
    echo "[organization]" > "$root/devenv.config"
    INNER_FILE="$root/tools/tests/devenv/inner.bats"
    # The "@test" marker is assembled here: written literally inside this file it
    # would be rewritten by the outer bats run.
    local marker="@""test"
    {
        echo "load '$PROJECT_ROOT/tools/tests/test_helper'"
        echo "$marker \"inner\" {"
        echo "$1"
        echo "}"
    } > "$INNER_FILE"
}

# run_inner: a nested bats run that does not inherit this run's BATS_* state
run_inner() {
    local unset_args=() v
    for v in $(compgen -e | grep '^BATS_'); do unset_args+=(-u "$v"); done
    env "${unset_args[@]}" bats "$INNER_FILE"
}

@test "modifying the root's config fails the test that did it" {
    inner_suite '    echo "tampered=1" >> "$PROJECT_ROOT/devenv.config"'
    run --separate-stderr run_inner
    [ "$status" -ne 0 ]
    [[ "$output$stderr" == *"TEST-ISOLATION VIOLATION"* ]]
}

@test "a test that leaves the config alone passes" {
    inner_suite '    true'
    run run_inner
    [ "$status" -eq 0 ]
}

@test "a violation still cleans up the temp dir (restore behavior kept)" {
    inner_suite '    echo "$TEST_TEMP_DIR" > "'"$TEST_TEMP_DIR"'/inner.tmp"; echo tampered >> "$PROJECT_ROOT/devenv.config"'
    run run_inner
    [ "$status" -ne 0 ]
    [ -s "$TEST_TEMP_DIR/inner.tmp" ]
    [ ! -d "$(cat "$TEST_TEMP_DIR/inner.tmp")" ]
}

@test "a function exported by one test (the gh-mock pattern) is absent in the next test" {
    # bats runs every test in its own process, so `export -f gh` inside a test
    # body cannot leak into later tests; suites need no `unset -f gh` teardown.
    local marker="@""test" root="$TEST_TEMP_DIR/root"
    mkdir -p "$root/tools/tests/devenv"
    echo "[organization]" > "$root/devenv.config"
    INNER_FILE="$root/tools/tests/devenv/leak.bats"
    {
        echo "load '$PROJECT_ROOT/tools/tests/test_helper'"
        echo "$marker \"exports a gh mock\" {"
        echo '    gh() { echo mocked; }; export -f gh; [ "$(gh)" = mocked ]'
        echo "}"
        echo "$marker \"sees no gh function\" {"
        echo '    run declare -F gh; [ "$status" -ne 0 ]'
        echo '    run bash -c "declare -F gh"; [ "$status" -ne 0 ]'
        echo "}"
    } > "$INNER_FILE"
    run run_inner
    [ "$status" -eq 0 ]
    [[ "$output" == *"ok 2 sees no gh function"* ]]
}
