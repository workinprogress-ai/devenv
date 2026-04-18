#!/usr/bin/env bats
# Tests for lib/cs-dependency-graph.bash — get_topological_generations

bats_require_minimum_version 1.5.0

load ../test_helper

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Create a minimal fake repo dir containing one .csproj so it appears as a
# C# repo to get_topological_generations
create_repo() {
    local name="$1"
    mkdir -p "$REPO_CACHE_DIR/$name/src"
    touch "$REPO_CACHE_DIR/$name/src/${name}.csproj"
}

# Index helpers — append rows to the relevant TSV files
add_pkg()      { printf '%s\t%s\n'     "$1" "$2"      >> "$REPO_CACHE_DIR/.index/package_to_repo.tsv"; }
add_repo_pkg() { printf '%s\t%s\n'     "$1" "$2"      >> "$REPO_CACHE_DIR/.index/repo_packages.tsv"; }
add_dep()      { printf '%s\t%s\t%s\n' "$1" "$2" "${3:-1.0.0}" >> "$REPO_CACHE_DIR/.index/repo_dependencies.tsv"; }

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
    test_helper_setup

    export REPO_CACHE_DIR="$TEST_TEMP_DIR/cache"
    mkdir -p "$REPO_CACHE_DIR/.index"

    # Initialise empty index files
    : > "$REPO_CACHE_DIR/.index/package_to_repo.tsv"
    : > "$REPO_CACHE_DIR/.index/repo_packages.tsv"
    : > "$REPO_CACHE_DIR/.index/repo_dependencies.tsv"

    # Write matching timestamps so ensure_dependency_index treats index as fresh
    echo "test-ts" > "$REPO_CACHE_DIR/.cache_timestamp"
    echo "test-ts" > "$REPO_CACHE_DIR/.index/.index_timestamp"

    # Source the libraries — CS_DEP_INDEX_DIR is derived from REPO_CACHE_DIR at
    # source time, so REPO_CACHE_DIR must be set first.
    # shellcheck source=../../lib/error-handling.bash
    source "$PROJECT_ROOT/tools/lib/error-handling.bash"
    # shellcheck source=../../lib/repo-cache.bash
    source "$PROJECT_ROOT/tools/lib/repo-cache.bash"
    # shellcheck source=../../lib/cs-dependency-graph.bash
    source "$PROJECT_ROOT/tools/lib/cs-dependency-graph.bash"
}

teardown() {
    cd "$PROJECT_ROOT"
    test_helper_teardown
}

# ---------------------------------------------------------------------------
# Syntax check
# ---------------------------------------------------------------------------

@test "cs-dependency-graph.bash has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/lib/cs-dependency-graph.bash"
    [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# get_topological_generations — basic cases
# ---------------------------------------------------------------------------

@test "get_topological_generations - empty cache returns nothing" {
    run get_topological_generations
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "get_topological_generations - single repo with no org deps is generation 0" {
    create_repo "repo-a"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" == "0"$'\t'"repo-a" ]]
}

@test "get_topological_generations - repo with no csproj is excluded" {
    # This dir has no csproj files so should not appear in output
    mkdir -p "$REPO_CACHE_DIR/not-a-cs-repo"
    create_repo "repo-a"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" == "0"$'\t'"repo-a" ]]
    [[ "$output" != *"not-a-cs-repo"* ]]
}

# ---------------------------------------------------------------------------
# Linear chain
# ---------------------------------------------------------------------------

@test "get_topological_generations - linear chain A->B->C produces three generations" {
    create_repo "repo-a"   # gen 0: produces WorkInProgress.A, no org deps
    create_repo "repo-b"   # gen 1: produces WorkInProgress.B, depends on WorkInProgress.A
    create_repo "repo-c"   # gen 2: no org packages, depends on WorkInProgress.B

    add_pkg      "WorkInProgress.A" "repo-a"
    add_repo_pkg "repo-a"           "WorkInProgress.A"
    add_pkg      "WorkInProgress.B" "repo-b"
    add_repo_pkg "repo-b"           "WorkInProgress.B"
    add_dep      "repo-b"           "WorkInProgress.A"
    add_dep      "repo-c"           "WorkInProgress.B"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" =~ "0"$'\t'"repo-a" ]]
    [[ "$output" =~ "1"$'\t'"repo-b" ]]
    [[ "$output" =~ "2"$'\t'"repo-c" ]]
}

@test "get_topological_generations - linear chain preserves order across lines" {
    create_repo "repo-a"
    create_repo "repo-b"
    create_repo "repo-c"

    add_pkg      "WorkInProgress.A" "repo-a"
    add_repo_pkg "repo-a"           "WorkInProgress.A"
    add_pkg      "WorkInProgress.B" "repo-b"
    add_repo_pkg "repo-b"           "WorkInProgress.B"
    add_dep      "repo-b"           "WorkInProgress.A"
    add_dep      "repo-c"           "WorkInProgress.B"

    run get_topological_generations
    [ "$status" -eq 0 ]

    # Extract generations for each repo from output
    gen_a=$(echo "$output" | awk -F'\t' '$2=="repo-a"{print $1}')
    gen_b=$(echo "$output" | awk -F'\t' '$2=="repo-b"{print $1}')
    gen_c=$(echo "$output" | awk -F'\t' '$2=="repo-c"{print $1}')

    [ "$gen_a" -lt "$gen_b" ]
    [ "$gen_b" -lt "$gen_c" ]
}

# ---------------------------------------------------------------------------
# Diamond graph
# ---------------------------------------------------------------------------

@test "get_topological_generations - diamond A->(B,C)->D places B and C in same generation" {
    create_repo "repo-a"
    create_repo "repo-b"
    create_repo "repo-c"
    create_repo "repo-d"

    add_pkg      "WorkInProgress.A" "repo-a"
    add_repo_pkg "repo-a"           "WorkInProgress.A"
    add_pkg      "WorkInProgress.B" "repo-b"
    add_repo_pkg "repo-b"           "WorkInProgress.B"
    add_pkg      "WorkInProgress.C" "repo-c"
    add_repo_pkg "repo-c"           "WorkInProgress.C"

    add_dep "repo-b" "WorkInProgress.A"
    add_dep "repo-c" "WorkInProgress.A"
    add_dep "repo-d" "WorkInProgress.B"
    add_dep "repo-d" "WorkInProgress.C"

    run get_topological_generations
    [ "$status" -eq 0 ]

    gen_a=$(echo "$output" | awk -F'\t' '$2=="repo-a"{print $1}')
    gen_b=$(echo "$output" | awk -F'\t' '$2=="repo-b"{print $1}')
    gen_c=$(echo "$output" | awk -F'\t' '$2=="repo-c"{print $1}')
    gen_d=$(echo "$output" | awk -F'\t' '$2=="repo-d"{print $1}')

    [ "$gen_a" -eq 0 ]
    [ "$gen_b" -eq "$gen_c" ]    # same generation — both depend only on repo-a
    [ "$gen_d" -gt "$gen_b" ]
}

# ---------------------------------------------------------------------------
# Repos with no org packages (only external deps)
# ---------------------------------------------------------------------------

@test "get_topological_generations - repo with only external deps is generation 0" {
    create_repo "repo-lib"      # produces WorkInProgress.Lib
    create_repo "repo-service"  # has csproj but only Microsoft.* deps — no org packages

    add_pkg      "WorkInProgress.Lib" "repo-lib"
    add_repo_pkg "repo-lib"           "WorkInProgress.Lib"
    # repo-service has no entries in any index file

    run get_topological_generations
    [ "$status" -eq 0 ]

    gen_lib=$(echo "$output" | awk -F'\t' '$2=="repo-lib"{print $1}')
    gen_svc=$(echo "$output" | awk -F'\t' '$2=="repo-service"{print $1}')

    [ "$gen_lib" -eq 0 ]
    [ "$gen_svc" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Alphabetical ordering within a generation
# ---------------------------------------------------------------------------

@test "get_topological_generations - repos within a generation are sorted alphabetically" {
    create_repo "repo-z"
    create_repo "repo-a"
    create_repo "repo-m"
    # No org-internal deps → all land in generation 0

    run get_topological_generations
    [ "$status" -eq 0 ]

    gen0_repos=$(echo "$output" | awk -F'\t' '$1==0{print $2}')
    expected=$'repo-a\nrepo-m\nrepo-z'
    [ "$gen0_repos" = "$expected" ]
}

# ---------------------------------------------------------------------------
# Cycle detection
# ---------------------------------------------------------------------------

@test "get_topological_generations - cycle emits warning and exits 0" {
    create_repo "repo-x"
    create_repo "repo-y"

    add_pkg      "WorkInProgress.X" "repo-x"
    add_repo_pkg "repo-x"           "WorkInProgress.X"
    add_pkg      "WorkInProgress.Y" "repo-y"
    add_repo_pkg "repo-y"           "WorkInProgress.Y"

    # Create a cycle: x depends on y, y depends on x
    add_dep "repo-x" "WorkInProgress.Y"
    add_dep "repo-y" "WorkInProgress.X"

    run get_topological_generations
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Cycle detected" ]]
}

@test "get_topological_generations - cycle does not hang or loop forever" {
    create_repo "repo-x"
    create_repo "repo-y"

    add_pkg      "WorkInProgress.X" "repo-x"
    add_repo_pkg "repo-x"           "WorkInProgress.X"
    add_pkg      "WorkInProgress.Y" "repo-y"
    add_repo_pkg "repo-y"           "WorkInProgress.Y"

    add_dep "repo-x" "WorkInProgress.Y"
    add_dep "repo-y" "WorkInProgress.X"

    # Should complete within 5 seconds
    run timeout 5 bash -c "
        export REPO_CACHE_DIR=\"$REPO_CACHE_DIR\"
        export DEVENV_TOOLS=\"$DEVENV_TOOLS\"
        source \"\$DEVENV_TOOLS/lib/error-handling.bash\"
        source \"\$DEVENV_TOOLS/lib/repo-cache.bash\"
        source \"\$DEVENV_TOOLS/lib/cs-dependency-graph.bash\"
        get_topological_generations
    "
    [ "$status" -ne 124 ]  # 124 = timeout
}
