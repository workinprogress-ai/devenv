#!/usr/bin/env bats
# repo-cache-update: the dependency index needs an organization package prefix
# ([nuget] package_prefix); a fork without C# packages sets none and must not be
# broken by that.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export REPO_CACHE_DIR="$TEST_TEMP_DIR/cache"
    mkdir -p "$REPO_CACHE_DIR"
    SCRIPT="$PROJECT_ROOT/tools/scripts/repo-cache-update.sh"
}

teardown() {
    test_helper_teardown
}

@test "no package prefix: the index is skipped with a warning naming the key, and the run succeeds" {
    printf '[organization]\nname=x\n' > "$DEVENV_ROOT/devenv.config"
    run --separate-stderr env -u CS_DEP_ORG_PREFIX bash "$SCRIPT" --no-refresh
    [ "$status" -eq 0 ]
    [[ "$stderr" == *"[nuget] package_prefix"* ]]
    # stdout is exactly the cache directory; the warning never reaches it
    [ "$output" = "$REPO_CACHE_DIR" ]
    [ ! -d "$REPO_CACHE_DIR/.index" ]
}

@test "a configured package prefix: the index is built" {
    printf '[nuget]\npackage_prefix=Acme.\n' > "$DEVENV_ROOT/devenv.config"
    run env -u CS_DEP_ORG_PREFIX bash "$SCRIPT" --no-refresh
    [ "$status" -eq 0 ]
    [[ "$output" == *"Building dependency index"* ]]
    [ -d "$REPO_CACHE_DIR/.index" ]
}

@test "the CS_DEP_ORG_PREFIX override also enables the index" {
    printf '[organization]\nname=x\n' > "$DEVENV_ROOT/devenv.config"
    run env CS_DEP_ORG_PREFIX="Other." bash "$SCRIPT" --no-refresh
    [ "$status" -eq 0 ]
    [[ "$output" == *"Building dependency index"* ]]
}
