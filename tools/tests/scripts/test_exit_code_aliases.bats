#!/usr/bin/env bats
# The deprecated exit-code aliases (EXIT_INVALID_ARGUMENT=3, EXIT_NOT_FOUND=4,
# EXIT_PERMISSION_DENIED=5) collide with canonical meanings: 3 is "ambiguous
# match", not "invalid argument". Nothing outside their definition may use them.

bats_require_minimum_version 1.5.0

load ../test_helper

# A throwaway checkout of just what these scripts need: the libraries
# self-locate, so the only way to give them a config without an organization
# is to run copies from inside a tree that has one.
make_unconfigured_tree() {
    TREE="$TEST_TEMP_DIR/tree"
    mkdir -p "$TREE/tools/scripts" "$TREE/tools/lib" "$TREE/tools/config" "$TREE/.setup" "$TREE/.runtime"
    cp -r "$PROJECT_ROOT/tools/lib/." "$TREE/tools/lib/"
    cp "$PROJECT_ROOT/tools/scripts/$1" "$TREE/tools/scripts/"
    cp "$PROJECT_ROOT/tools/config/repo-types.yaml" "$TREE/tools/config/"
    printf '[workflows]\nstatus_workflow=A,B\n' > "$TREE/devenv.config"
}

run_unconfigured() {
    ( cd "$TREE" && env -u GH_ORG -u PROVIDER_ORG -u DEVENV_REPO -u DEVENV_ROOT -u DEVENV_ROOT_SET -u DEVENV_TOOLS \
        bash "$TREE/tools/scripts/$1" svc.x.y --type service )
}

@test "repo-update-config: an unresolved organization exits 2 (missing required input), not 3" {
    make_unconfigured_tree repo-update-config.sh
    run run_unconfigured repo-update-config.sh
    [ "$status" -eq 2 ]
    [[ "$output" == *"Organization identity unresolved"* ]]
}

@test "repo-create: an unresolved organization exits 2 (missing required input), not 3" {
    make_unconfigured_tree repo-create.sh
    run run_unconfigured repo-create.sh
    [ "$status" -eq 2 ]
    [[ "$output" == *"Organization identity unresolved"* ]]
}

@test "no script, library or template uses the deprecated exit-code aliases" {
    run grep -rnE 'EXIT_INVALID_ARGUMENT|EXIT_NOT_FOUND|EXIT_PERMISSION_DENIED' \
        "$PROJECT_ROOT/tools/scripts" "$PROJECT_ROOT/tools/lib" "$PROJECT_ROOT/tools/templates" \
        "$PROJECT_ROOT/.devcontainer" "$PROJECT_ROOT/setup" \
        --exclude=error-handling.bash
    # grep exits 1 when it finds nothing: that is the passing outcome.
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
}
