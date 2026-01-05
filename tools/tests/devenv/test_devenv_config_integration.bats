#!/usr/bin/env bats
# Tests for devenv.config integration with setup and bootstrap scripts

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    # Create a valid test config file
    export TEST_CONFIG_FILE="$TEST_TEMP_DIR/devenv.config"
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[organization]
name=Test Organization
github_org=test-org
email_domain=test.example.com

[nuget]
feed_url=https://nuget.pkg.github.com/${GH_ORG}/index.json

[workflows]
status_workflow=TBD,Ready,In Progress,Done
issue_types=story,bug
EOF
}

@test "devenv.config: file exists in repo root" {
    [ -f "$PROJECT_ROOT/devenv.config" ]
}

@test "devenv.config: contains required sections" {
    run grep -E '^\[organization\]|^\[nuget\]|^\[workflows\]' "$PROJECT_ROOT/devenv.config"
    [ "$status" -eq 0 ]
}

@test "devenv.config: organization section has required keys" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $PROJECT_ROOT/devenv.config && config_validate_required organization name github_org email_domain"
    [ "$status" -eq 0 ]
}

@test "devenv.config: nuget section has feed_url configured" {
    run bash -c "source \$PROJECT_ROOT/tools/lib/config-reader.bash && config_init \$PROJECT_ROOT/devenv.config && config_read_value nuget feed_url | grep -q 'nuget.pkg.github.com'"
    [ "$status" -eq 0 ]
}

@test "devenv.config: workflows section has status_workflow" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $PROJECT_ROOT/devenv.config && config_read_array workflows status_workflow"
    [ "$status" -eq 0 ]
    [[ "$output" =~ Backlog ]]
    [[ "$output" =~ Ready ]]
    [[ "$output" =~ Done ]]
}

@test "devenv.config: workflows section has issue_types" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $PROJECT_ROOT/devenv.config && config_read_array workflows issue_types"
    [ "$status" -eq 0 ]
    [[ "$output" =~ story ]]
    [[ "$output" =~ bug ]]
}

@test "config-reader.bash: library exists" {
    [ -f "$PROJECT_ROOT/tools/lib/config-reader.bash" ]
}

@test "config-reader.bash: has config_init function" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && declare -f config_init"
    [ "$status" -eq 0 ]
}

@test "config-reader.bash: has config_read_value function" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && declare -f config_read_value"
    [ "$status" -eq 0 ]
}

@test "config-reader.bash: has config_read_array function" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && declare -f config_read_array"
    [ "$status" -eq 0 ]
}

@test "issue-helper.bash: library exists" {
    [ -f "$PROJECT_ROOT/tools/lib/issue-helper.bash" ]
}

@test "issue-helper.bash: has load_issue_types_from_config function" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-helper.bash && declare -f load_issue_types_from_config"
    [ "$status" -eq 0 ]
}

@test "issue-helper.bash: has build_type_menu function" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-helper.bash && declare -f build_type_menu"
    [ "$status" -eq 0 ]
}

@test "bootstrap.bash: has load_config function" {
    run grep -n "^load_config()" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    [ "$status" -eq 0 ]
}

@test "bootstrap.bash: load_config called in default_tasks" {
    run grep "load_config" "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    [ "$status" -eq 0 ]
}

@test "bootstrap.bash: sources config-reader library" {
    run grep 'source.*config-reader.bash' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    [ "$status" -eq 0 ]
}

@test "project-update-issue.sh: sources config-reader library" {
    run grep 'source.*config-reader.bash' "$PROJECT_ROOT/tools/scripts/project-update-issue.sh"
    [ "$status" -eq 0 ]
}

@test "project-update-issue.sh: has load_status_workflow function" {
    run grep "^load_status_workflow()" "$PROJECT_ROOT/tools/scripts/project-update-issue.sh"
    [ "$status" -eq 0 ]
}

@test "project-update-issue.sh: calls load_status_workflow in main" {
    run bash -c "grep -A 10 '^main()' $PROJECT_ROOT/tools/scripts/project-update-issue.sh | grep -q 'load_status_workflow'"
    [ "$status" -eq 0 ]
}

@test "issue-groom.sh: sources config-reader library" {
    run grep 'source.*config-reader.bash' "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
    [ "$status" -eq 0 ]
}

@test "issue-groom.sh: sources issue-helper library" {
    run grep 'source.*issue-helper.bash' "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
    [ "$status" -eq 0 ]
}

@test "issue-groom.sh: has initialize_issue_types function" {
    run grep "^initialize_issue_types()" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
    [ "$status" -eq 0 ]
}

@test "issue-groom.sh: calls initialize_issue_types in main" {
    run bash -c "grep -A 5 '^main()' $PROJECT_ROOT/tools/scripts/issue-groom.sh | grep -q 'initialize_issue_types'"
    [ "$status" -eq 0 ]
}

@test "setup script: loads email_domain from config" {
    run grep "email_domain" "$PROJECT_ROOT/setup"
    [ "$status" -eq 0 ]
}

@test "setup script: validates email against configured domain" {
    run grep "email_domain" "$PROJECT_ROOT/setup"
    [ "$status" -eq 0 ]
}

@test "test_helper.bash: uses generic test email" {
    run grep 'USER_EMAIL="test@example.com"' "$PROJECT_ROOT/tools/tests/test_helper.bash"
    [ "$status" -eq 0 ]
}

@test "test_helper.bash: does not use hardcoded organization email" {
    run grep '@workinprogress.ai' "$PROJECT_ROOT/tools/tests/test_helper.bash"
    [ "$status" -ne 0 ]
}
