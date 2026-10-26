#!/usr/bin/env bats
# Each exit-code value has one name. The former aliases (EXIT_INVALID_ARGUMENT=3,
# EXIT_NOT_FOUND=4, EXIT_PERMISSION_DENIED=5) collided with canonical meanings (3 is
# "ambiguous match", not "invalid argument") and are gone: nothing defines or uses them.

bats_require_minimum_version 1.5.0

load ../test_helper

# A throwaway checkout of just what these scripts need: the libraries
# self-locate, so the only way to give them a config without an organization
# is to run copies from inside a tree that has one. Migrated tools are .ts
# behind a stub: the stub + TS + lib all ride into the sandbox tree.
make_unconfigured_tree() {
    TREE="$TEST_TEMP_DIR/tree"
    mkdir -p "$TREE/tools/scripts" "$TREE/tools/ts" "$TREE/tools/lib" "$TREE/tools/config" "$TREE/.setup" "$TREE/.runtime"
    cp -r "$PROJECT_ROOT/tools/lib/." "$TREE/tools/lib/"
    local base="${1%.sh}"; base="${base%.ts}"
    if [ -f "$PROJECT_ROOT/tools/ts/$base.ts" ]; then
        cp "$PROJECT_ROOT/tools/$base" "$TREE/tools/"
        cp "$PROJECT_ROOT/tools/ts/$base.ts" "$TREE/tools/ts/"
    else
        cp "$PROJECT_ROOT/tools/scripts/$1" "$TREE/tools/scripts/"
    fi
    cp "$PROJECT_ROOT/tools/config/repo-types.yaml" "$TREE/tools/config/"
    ln -s "$PROJECT_ROOT/node_modules" "$TREE/node_modules"
    printf '[workflows]\nstatus_workflow=A,B\n' > "$TREE/devenv.config"
}

run_unconfigured() {
    local base="${1%.sh}"; base="${base%.ts}"
    ( cd "$TREE" && env -u GH_ORG -u PROVIDER_ORG -u DEVENV_REPO -u DEVENV_ROOT -u DEVENV_ROOT_SET -u DEVENV_TOOLS \
        bash "$TREE/tools/$base" svc.x.y --type service )
}

@test "repo-update-config: an unresolved organization exits 2 (missing required input), not 3" {
    make_unconfigured_tree repo-update-config.ts
    run run_unconfigured repo-update-config.ts
    [ "$status" -eq 2 ]
    [[ "$output" == *"Organization identity unresolved"* ]]
}

@test "repo-create: an unresolved organization exits 2 (missing required input), not 3" {
    make_unconfigured_tree repo-create.ts
    run run_unconfigured repo-create.ts
    [ "$status" -eq 2 ]
    [[ "$output" == *"Organization identity unresolved"* ]]
}

@test "no script, library or template defines or uses the retired exit-code aliases" {
    run grep -rnE 'EXIT_INVALID_ARGUMENT|EXIT_NOT_FOUND|EXIT_PERMISSION_DENIED' \
        "$PROJECT_ROOT/tools/scripts" "$PROJECT_ROOT/tools/lib" "$PROJECT_ROOT/tools/templates" \
        "$PROJECT_ROOT/.devcontainer" "$PROJECT_ROOT/setup"
    # grep exits 1 when it finds nothing: that is the passing outcome.
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
}

@test "every exit-code name has its own value (no two names share one)" {
    run bash -c "source '$PROJECT_ROOT/tools/lib/error-handling.bash'; env | grep '^EXIT_' | sort -t= -k2 | awk -F= '{print \$2}' | uniq -d"
    [ -z "$output" ]
}

@test "issue-label-create does not redefine the library's ensure_label" {
    run grep -n '^ensure_label()' "$PROJECT_ROOT/tools/scripts/issue-label-create.sh"
    [ "$status" -ne 0 ]
}
