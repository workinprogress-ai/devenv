#!/usr/bin/env bats
# Which files lint-scripts.sh shellchecks: top-level infra scripts under repos/ are
# included; the repository clones beneath it (other people's code) are not.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/lint-scripts.sh"

setup() {
    test_helper_setup
    # Not under /tmp: lint-scripts excludes any */tmp/* path by design.
    ROOT="$PROJECT_ROOT/.local-artifacts/lint-scope-$$-$BATS_TEST_NUMBER"
    rm -rf "$ROOT"
    mkdir -p "$ROOT/repos/some-clone/scripts" "$ROOT/tools"
    # an unguarded cd is a shellcheck *warning* (SC2164) — the default lint severity
    printf '#!/bin/bash\ncd /nonexistent-dir\necho done\n' > "$ROOT/repos/top-level.sh"
    printf '#!/bin/bash\ncd /nonexistent-dir\necho done\n' > "$ROOT/repos/some-clone/scripts/inner.sh"
    printf '#!/bin/bash\necho ok\n' > "$ROOT/tools/clean.sh"
}

teardown() {
    rm -rf "$ROOT"
    test_helper_teardown
}

run_lint() {
    PROJECT_ROOT="$ROOT" bash "$SCRIPT" --no-color -d "$ROOT"
}

@test "lint-scripts shellchecks a top-level script under repos/" {
    run run_lint
    [[ "$output" == *"repos/top-level.sh"* ]]
}

@test "a lint failure in a top-level repos/ script fails the run" {
    run run_lint
    [ "$status" -ne 0 ]
}

@test "lint-scripts does not descend into a repository clone under repos/" {
    run run_lint
    [[ "$output" != *"some-clone/scripts/inner.sh"* ]]
}

@test "with a clean top-level repos/ script and a dirty clone, the run passes" {
    printf '#!/bin/bash\necho fine\n' > "$ROOT/repos/top-level.sh"
    run run_lint
    [ "$status" -eq 0 ]
    [[ "$output" == *"repos/top-level.sh"* ]]
}

@test "--no-color works (it used to abort assigning to readonly colour variables)" {
    run run_lint
    [[ "$output" != *"readonly variable"* ]]
    [[ "$output" != *$'\033['* ]]
}

# Extensionless scripts (tools/scripts/git-*, the root setup) carry a shell shebang
# instead of a .sh suffix; those are shellchecked too, and a file with no shell
# shebang is not.
@test "lint-scripts shellchecks an extensionless script that has a shell shebang" {
    printf '#!/bin/bash\ncd /nonexistent-dir\necho done\n' > "$ROOT/tools/git-thing"
    run run_lint
    [[ "$output" == *"tools/git-thing"* ]]
    [ "$status" -ne 0 ]
}

@test "an extensionless script with an env-style shell shebang is shellchecked" {
    printf '#!/usr/bin/env bash\ncd /nonexistent-dir\n' > "$ROOT/setup"
    run run_lint
    [[ "$output" == *"setup"* ]]
    [ "$status" -ne 0 ]
}

@test "an extensionless file without a shell shebang is left alone" {
    printf 'just some notes\ncd /nonexistent-dir\n' > "$ROOT/tools/NOTES"
    printf '#!/usr/bin/env python3\nprint(1)\n' > "$ROOT/tools/pytool"
    printf '#!/bin/bash\necho fine\n' > "$ROOT/repos/top-level.sh"
    run run_lint
    [ "$status" -eq 0 ]
    [[ "$output" != *"tools/NOTES"* ]]
    [[ "$output" != *"tools/pytool"* ]]
}
