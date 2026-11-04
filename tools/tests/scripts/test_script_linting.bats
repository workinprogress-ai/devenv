#!/usr/bin/env bats
# Tests for script syntax and shellcheck compliance

load ../test_helper

@test "all library scripts have valid bash syntax" {
    for script in "$PROJECT_ROOT"/tools/lib/*.bash; do
        run bash -n "$script"
        [ "$status" -eq 0 ]
    done
}

@test "all executable scripts have valid bash syntax" {
    # The scripts/ corpus moved to tools/ts (bash minimum); the sweep
    # continues over the shell that remains. An empty list skips the loop
    # instead of passing a literal unexpanded glob to bash -n.
    local script
    for script in "$PROJECT_ROOT"/tools/templates/*.sh "$PROJECT_ROOT"/tools/tests/run-devenv-tests.sh; do
        [ -f "$script" ] || continue
        run bash -n "$script"
        [ "$status" -eq 0 ]
    done
}

@test "bootstrap.sh has valid syntax" {
    run bash -n "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
    [ "$status" -eq 0 ]
}

@test "setup script has valid syntax" {
    run bash -n "$PROJECT_ROOT/setup"
    [ "$status" -eq 0 ]
}

@test "scripts have proper shebang" {
    local script
    for script in "$PROJECT_ROOT"/tools/templates/*.sh "$PROJECT_ROOT"/tools/tests/run-devenv-tests.sh; do
        [ -f "$script" ] || continue
        run head -n 1 "$script"
        [[ "$output" =~ "#!/bin/bash" ]] || [[ "$output" =~ "#!/usr/bin/env bash" ]]
    done
}

@test "library files have proper shebang or comment" {
    for lib in "$PROJECT_ROOT"/tools/lib/*.bash; do
        run head -n 1 "$lib"
        # Libraries should have shebang or be sourceable
        [ "$status" -eq 0 ]
    done
}
