#!/usr/bin/env bats
# Tests for scripts/cs-dependencies-update-wizard.sh — --global mode and argument validation

bats_require_minimum_version 1.5.0

load ../test_helper

WIZARD=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

setup_minimal_cache() {
    mkdir -p "$REPO_CACHE_DIR/.index"

    # One simple repo with no org-internal deps (lands in generation 0)
    mkdir -p "$REPO_CACHE_DIR/repo-alpha/src"
    touch "$REPO_CACHE_DIR/repo-alpha/src/WorkInProgress.Alpha.csproj"

    # Write index files
    printf '%s\t%s\n' "WorkInProgress.Alpha" "repo-alpha" \
        > "$REPO_CACHE_DIR/.index/package_to_repo.tsv"
    printf '%s\t%s\n' "repo-alpha" "WorkInProgress.Alpha" \
        > "$REPO_CACHE_DIR/.index/repo_packages.tsv"
    : > "$REPO_CACHE_DIR/.index/repo_dependencies.tsv"

    # Matching timestamps so ensure_dependency_index sees the index as fresh
    echo "test-ts" > "$REPO_CACHE_DIR/.cache_timestamp"
    echo "test-ts" > "$REPO_CACHE_DIR/.index/.index_timestamp"
}

setup_two_gen_cache() {
    setup_minimal_cache

    # Add a second repo that depends on repo-alpha (generation 1)
    mkdir -p "$REPO_CACHE_DIR/repo-beta/src"
    touch "$REPO_CACHE_DIR/repo-beta/src/WorkInProgress.Beta.csproj"

    printf '%s\t%s\n' "WorkInProgress.Beta" "repo-beta" \
        >> "$REPO_CACHE_DIR/.index/package_to_repo.tsv"
    printf '%s\t%s\n' "repo-beta" "WorkInProgress.Beta" \
        >> "$REPO_CACHE_DIR/.index/repo_packages.tsv"
    printf '%s\t%s\t%s\n' "repo-beta" "WorkInProgress.Alpha" "1.0.0" \
        >> "$REPO_CACHE_DIR/.index/repo_dependencies.tsv"
}

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
    test_helper_setup

    WIZARD="$PROJECT_ROOT/tools/scripts/cs-dependencies-update-wizard.sh"
    export REPO_CACHE_DIR="$TEST_TEMP_DIR/cache"
}

teardown() {
    cd "$PROJECT_ROOT"
    test_helper_teardown
}

# ---------------------------------------------------------------------------
# Syntax and basic contract
# ---------------------------------------------------------------------------

@test "cs-dependencies-update-wizard.sh has valid bash syntax" {
    run bash -n "$WIZARD"
    [ "$status" -eq 0 ]
}

@test "cs-dependencies-update-wizard.sh shows usage with --help" {
    run "$WIZARD" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Usage:" ]]
    [[ "$output" =~ "--global" ]]
}

@test "cs-dependencies-update-wizard.sh shows version 1.1.0 with --version" {
    run "$WIZARD" --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ "1.1.0" ]]
}

# ---------------------------------------------------------------------------
# Argument validation — --global mode
# ---------------------------------------------------------------------------

@test "--global and TARGET_DIR are mutually exclusive" {
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global "$TEST_TEMP_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "mutually exclusive" ]]
}

@test "--global with a non-integer string treats it as TARGET_DIR and errors" {
    # 'foo' is not [0-9]+ so it is consumed as TARGET_DIR → mutually exclusive error
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global foo
    [ "$status" -ne 0 ]
}

@test "--global 0 is accepted as explicit start at generation 0" {
    setup_minimal_cache
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global 0 --dry-run --no-refresh
    [ "$status" -eq 0 ]
}

@test "--global with no argument defaults to generation 0" {
    setup_minimal_cache
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global --dry-run --no-refresh
    [ "$status" -eq 0 ]
}

@test "--global N exceeding max generation is an error" {
    setup_minimal_cache  # only generation 0 exists
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global 99 --dry-run --no-refresh
    [ "$status" -ne 0 ]
    [[ "$output" =~ "99" ]]
}

# ---------------------------------------------------------------------------
# Global mode — dry-run output
# ---------------------------------------------------------------------------

@test "--global --dry-run prints Global header" {
    setup_minimal_cache
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global --dry-run --no-refresh
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Global Dependency Update Wizard" ]]
    [[ "$output" =~ "DRY RUN" ]]
}

@test "--global --dry-run lists repo-alpha in generation 0" {
    setup_minimal_cache
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global --dry-run --no-refresh
    [ "$status" -eq 0 ]
    [[ "$output" =~ "repo-alpha" ]]
}

@test "--global --dry-run with two generations lists both repos" {
    setup_two_gen_cache
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global --dry-run --no-refresh
    [ "$status" -eq 0 ]
    [[ "$output" =~ "repo-alpha" ]]
    [[ "$output" =~ "repo-beta" ]]
}

@test "--global 1 --dry-run skips generation 0 and processes generation 1" {
    setup_two_gen_cache
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global 1 --dry-run --no-refresh
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Resuming from generation: 1" ]]
    [[ "$output" =~ "repo-beta" ]]
    # repo-alpha should be skipped (generation 0)
    [[ "$output" =~ "Skipping generation 0" ]]
}

@test "--global --dry-run prints completion footer" {
    setup_minimal_cache
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --global --dry-run --no-refresh
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Global dependency update complete" ]]
}

# ---------------------------------------------------------------------------
# Single-target mode still works
# ---------------------------------------------------------------------------

@test "single-target mode rejects unknown options as before" {
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" --unknown-flag
    [ "$status" -ne 0 ]
}

@test "single-target mode fails on non-existent directory" {
    run env REPO_CACHE_DIR="$REPO_CACHE_DIR" \
        "$WIZARD" /this/does/not/exist
    [ "$status" -ne 0 ]
}
