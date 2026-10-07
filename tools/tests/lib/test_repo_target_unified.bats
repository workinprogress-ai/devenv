#!/usr/bin/env bats
# Repo targeting: one resolver for every wrapper, and a devenv-repo safety gate that
# actually fires. get_repo_spec delegates to provider_repo_target; on Azure the
# canonical spec is the two-part project/repo (the organization comes from config).
# resolve_target_repo exempts an explicit target (argument or DEVENV_REPO, or the
# --devenv override) from the gate and refuses an implicit one made from inside the
# devenv repo itself.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_ROOT="$TEST_TEMP_DIR"
    export DEVENV_ROOT_SET=1
    unset DEVENV_REPO GH_REPO GH_ORG POLICY_ORG ALLOW_DEVENV_REPO
}

teardown() {
    test_helper_teardown
}

write_config() {   # write_config <provider>
    if [ "$1" = "azure" ]; then
        printf '[provider]\nname=azure\nazure_org=my-org\nazure_project=my-proj\n[organization]\nname=t\norg=my-org\n' > "$TEST_TEMP_DIR/devenv.config"
    else
        printf '[provider]\nname=github\n[organization]\nname=t\norg=my-org\n' > "$TEST_TEMP_DIR/devenv.config"
    fi
}

# in_repo <dir> <script>: run <script> inside <dir> with the tool libraries sourced
in_repo() {
    local dir="$1" script="$2"
    run bash -c "
        export PROJECT_ROOT='$PROJECT_ROOT' DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1
        export DEVENV_TOOLS='$PROJECT_ROOT/tools'
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
        cd '$dir'
        $script
    "
}

# ---------------------------------------------------------------------------
# One resolver: get_repo_spec == provider_repo_target
# ---------------------------------------------------------------------------

@test "get_repo_spec honors DEVENV_REPO" {
    write_config github
    create_mock_git_repo "$TEST_TEMP_DIR/work/proj-a"
    in_repo "$TEST_TEMP_DIR/work/proj-a" 'DEVENV_REPO=other-org/other-repo get_repo_spec'
    [ "$status" -eq 0 ]
    [ "$output" = "other-org/other-repo" ]
}

@test "get_repo_spec equals provider_repo_target from a working directory (github)" {
    write_config github
    create_mock_git_repo "$TEST_TEMP_DIR/work/proj-a"
    in_repo "$TEST_TEMP_DIR/work/proj-a" 'echo "$(get_repo_spec)|$(provider_repo_target)"'
    [ "$status" -eq 0 ]
    [ "$output" = "my-org/proj-a|my-org/proj-a" ]
}

@test "azure: get_repo_spec and provider_repo_target both emit the two-part project/repo" {
    write_config azure
    create_mock_git_repo "$TEST_TEMP_DIR/work/proj-a"
    in_repo "$TEST_TEMP_DIR/work/proj-a" 'echo "$(get_repo_spec)|$(provider_repo_target)"'
    [ "$status" -eq 0 ]
    [ "$output" = "my-proj/proj-a|my-proj/proj-a" ]
}

@test "azure: the cwd spec is never the org plus repo (which Azure would read as project/repo)" {
    write_config azure
    create_mock_git_repo "$TEST_TEMP_DIR/work/proj-a"
    in_repo "$TEST_TEMP_DIR/work/proj-a" 'get_repo_spec'
    [ "$status" -eq 0 ]
    [ "$output" != "my-org/proj-a" ]
}

# ---------------------------------------------------------------------------
# The devenv-repo safety gate
# ---------------------------------------------------------------------------

make_devenv_repo() {   # a repo that is_devenv_repo recognises (bootstrap.sh marker)
    create_mock_git_repo "$TEST_TEMP_DIR/work/the-devenv"
    mkdir -p "$TEST_TEMP_DIR/work/the-devenv/.devcontainer"
    touch "$TEST_TEMP_DIR/work/the-devenv/.devcontainer/bootstrap.sh"
}

@test "gate: an implicit target from inside the devenv repo is refused" {
    write_config github
    make_devenv_repo
    in_repo "$TEST_TEMP_DIR/work/the-devenv" 'resolve_target_repo'
    [ "$status" -ne 0 ]
    [[ "$output" == *"devenv repository itself"* ]]
}

@test "gate: an explicit repo argument from inside the devenv repo is allowed" {
    write_config github
    make_devenv_repo
    in_repo "$TEST_TEMP_DIR/work/the-devenv" 'resolve_target_repo other-org/other-repo'
    [ "$status" -eq 0 ]
    [ "$output" = "other-org/other-repo" ]
}

@test "gate: DEVENV_REPO from inside the devenv repo is allowed" {
    write_config github
    make_devenv_repo
    in_repo "$TEST_TEMP_DIR/work/the-devenv" 'DEVENV_REPO=other-org/other-repo resolve_target_repo'
    [ "$status" -eq 0 ]
    [ "$output" = "other-org/other-repo" ]
}

@test "gate: the --devenv override (ALLOW_DEVENV_REPO=1) allows an implicit target with a warning" {
    write_config github
    make_devenv_repo
    in_repo "$TEST_TEMP_DIR/work/the-devenv" 'ALLOW_DEVENV_REPO=1 resolve_target_repo'
    [ "$status" -eq 0 ]
    [[ "$output" == *"my-org/the-devenv"* ]]
}

@test "gate: an implicit target from a non-devenv repo is allowed" {
    write_config github
    create_mock_git_repo "$TEST_TEMP_DIR/work/proj-a"
    in_repo "$TEST_TEMP_DIR/work/proj-a" 'resolve_target_repo'
    [ "$status" -eq 0 ]
    [ "$output" = "my-org/proj-a" ]
}

@test "gate: resolve_target_repo does not leak a DEVENV_REPO into the caller's shell" {
    write_config github
    create_mock_git_repo "$TEST_TEMP_DIR/work/proj-a"
    in_repo "$TEST_TEMP_DIR/work/proj-a" 'resolve_target_repo >/dev/null; echo "after=[${DEVENV_REPO:-}]"'
    [ "$status" -eq 0 ]
    [[ "$output" == *"after=[]"* ]]
}
