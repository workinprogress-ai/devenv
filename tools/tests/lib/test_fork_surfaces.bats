#!/usr/bin/env bats
# Tests for lib/fork-surfaces.bash — the machine-readable fork-stable
# surfaces contract: path resolution, validation, classification, listing.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    source "$DEVENV_TOOLS/lib/fork-surfaces.bash"
    # A minimal valid declaration for parser tests; the in-tree default is
    # exercised separately so contract changes cannot break parser tests.
    cat > "$TEST_TEMP_DIR/surfaces.yml" <<'YML'
version: 1
classes:
  fork-stable:
    - description: data policy
      paths:
        - devenv.config
        - tools/config/issues-config.yml
    - description: provider modules
      paths:
        - tools/lib/providers/*
  fork-replaced:
    - description: bootstrap
      paths:
        - setup
  upstream-stable: []
YML
}

teardown() {
    test_helper_teardown
}

@test "fork-surfaces: config path resolves override, env, then default" {
    run fork_surfaces_config_path "/custom/path.yml"
    [ "$status" -eq 0 ]
    [ "$output" = "/custom/path.yml" ]

    FORK_SURFACES_CONFIG="/env/path.yml" run fork_surfaces_config_path
    [ "$status" -eq 0 ]
    [ "$output" = "/env/path.yml" ]

    run fork_surfaces_config_path
    [ "$status" -eq 0 ]
    [[ "$output" == *"config/fork-surfaces.yml" ]]
}

@test "fork-surfaces: validate accepts the in-tree declaration" {
    run fork_surfaces_validate
    [ "$status" -eq 0 ]
}

@test "fork-surfaces: validate rejects a malformed declaration" {
    printf 'version: 1\nclasses:\n  fork-stable:\n    - paths: []\n' > "$TEST_TEMP_DIR/bad.yml"
    run fork_surfaces_validate "$TEST_TEMP_DIR/bad.yml"
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing description"* ]]

    printf 'classes: {}\n' > "$TEST_TEMP_DIR/worse.yml"
    run fork_surfaces_validate "$TEST_TEMP_DIR/worse.yml"
    [ "$status" -ne 0 ]
    [[ "$output" == *"missing version"* ]]
}

@test "fork-surfaces: classify — fork-stable exact path and glob" {
    run fork_surfaces_classify "devenv.config" "$TEST_TEMP_DIR/surfaces.yml"
    [ "$status" -eq 0 ]
    [ "$output" = "fork-stable" ]

    run fork_surfaces_classify "tools/lib/providers/github/issues.bash" "$TEST_TEMP_DIR/surfaces.yml"
    [ "$status" -eq 0 ]
    [ "$output" = "fork-stable" ]
}

@test "fork-surfaces: classify — fork-replaced setup" {
    run fork_surfaces_classify "setup" "$TEST_TEMP_DIR/surfaces.yml"
    [ "$status" -eq 0 ]
    [ "$output" = "fork-replaced" ]
}

@test "fork-surfaces: classify — undeclared paths default to upstream-stable" {
    run fork_surfaces_classify "tools/scripts/fork-sync.sh" "$TEST_TEMP_DIR/surfaces.yml"
    [ "$status" -eq 0 ]
    [ "$output" = "upstream-stable" ]

    run fork_surfaces_classify "docs/Forking.md" "$TEST_TEMP_DIR/surfaces.yml"
    [ "$status" -eq 0 ]
    [ "$output" = "upstream-stable" ]
}

@test "fork-surfaces: list emits every declared glob with its class" {
    run fork_surfaces_list "$TEST_TEMP_DIR/surfaces.yml"
    [ "$status" -eq 0 ]
    [[ "$output" == *"fork-stable devenv.config"* ]]
    [[ "$output" == *"fork-stable tools/lib/providers/*"* ]]
    [[ "$output" == *"fork-replaced setup"* ]]
    # The default class is undeclared and never listed.
    ! grep -q "upstream-stable" <<< "$output"
}
