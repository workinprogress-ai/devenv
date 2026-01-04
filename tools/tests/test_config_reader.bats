#!/usr/bin/env bats
# Tests for config-reader.bash library
# Tests reading INI-style devenv.config files

bats_require_minimum_version 1.5.0

setup() {
    export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../.."
    export TEST_TEMP_DIR="$(mktemp -d)"
    export TEST_CONFIG_FILE="$TEST_TEMP_DIR/test.config"
}

teardown() {
    if [ -d "$TEST_TEMP_DIR" ]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
}

# Helper to create a test config file
create_test_config() {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
# Test configuration file

[organization]
name=Test Organization
github_org=test-org
email_domain=test.example.com

[container]
registry=docker.io

[nuget]
feed_url=https://nuget.pkg.github.com/${GH_ORG}/index.json

[workflows]
status_workflow=TBD,Ready,In Progress,Done
issue_types=story,bug,enhancement
EOF
}

@test "config-reader: library can be sourced" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && echo loaded"
    [ "$status" -eq 0 ]
    [[ "$output" =~ loaded ]]
}

@test "config-reader: config_init fails with missing file" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init /nonexistent/file.config"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not found" ]]
}

@test "config-reader: config_init succeeds with valid file" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && echo success"
    [ "$status" -eq 0 ]
    [[ "$output" =~ success ]]
}

@test "config-reader: config_read_value retrieves simple value" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization name"
    [ "$status" -eq 0 ]
    [ "$output" = "Test Organization" ]
}

@test "config-reader: config_read_value returns default when key missing" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization missing_key fallback_value"
    [ "$status" -eq 0 ]
    [ "$output" = "fallback_value" ]
}

@test "config-reader: config_read_value returns empty string when key missing and no default" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value organization missing_key"
    [ "$status" -eq 0 ]
    [ "$output" = "" ]
}

@test "config-reader: config_read_array parses comma-separated values" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_array workflows issue_types"
    [ "$status" -eq 0 ]
    [[ "$output" =~ story ]]
    [[ "$output" =~ bug ]]
    [[ "$output" =~ enhancement ]]
}

@test "config-reader: config_read_array trims whitespace from elements" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
items=one, two , three  , four
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_array test items"
    [ "$status" -eq 0 ]
    # Verify all items are present without extra whitespace
    [[ "$output" =~ ^one ]]
    [[ "$output" =~ two ]]
    [[ "$output" =~ three ]]
    [[ "$output" =~ four$ ]]
}

@test "config-reader: config_read_array fails when key missing" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_array workflows missing_key"
    [ "$status" -ne 0 ]
}

@test "config-reader: config_validate_required succeeds when keys exist" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_validate_required organization name github_org email_domain"
    [ "$status" -eq 0 ]
}

@test "config-reader: config_validate_required fails when key missing" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_validate_required organization name missing_key"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "Required configuration missing" ]]
}

@test "config-reader: config_validate_required reports all missing keys" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_validate_required organization missing1 missing2 missing3 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ missing1 ]]
    [[ "$output" =~ missing2 ]]
    [[ "$output" =~ missing3 ]]
}

@test "config-reader: environment variables are expanded in values" {
    create_test_config
    run bash -c "export GH_ORG=myorg && source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value nuget feed_url"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "https://nuget.pkg.github.com/myorg/index.json" ]]
}

@test "config-reader: config_list_section returns all keys in section" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_list_section organization"
    [ "$status" -eq 0 ]
    [[ "$output" =~ name ]]
    [[ "$output" =~ github_org ]]
    [[ "$output" =~ email_domain ]]
}

@test "config-reader: config_dump outputs all key=value pairs in section" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_dump organization"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "name=Test Organization" ]]
    [[ "$output" =~ "github_org=test-org" ]]
    [[ "$output" =~ "email_domain=test.example.com" ]]
}

@test "config-reader: config_get_issue_types fails when issue_types missing" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
status_workflow=Backlog,Done
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_get_issue_types"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not configured" ]]
}

@test "config-reader: config_get_issue_types succeeds and returns types" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_get_issue_types"
    [ "$status" -eq 0 ]
    [[ "$output" =~ story ]]
    [[ "$output" =~ bug ]]
    [[ "$output" =~ enhancement ]]
}

@test "config-reader: config_get_status_workflow fails when status_workflow missing" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=story,bug
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_get_status_workflow"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not configured" ]]
}

@test "config-reader: config_get_status_workflow succeeds and returns workflow" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_get_status_workflow"
    [ "$status" -eq 0 ]
    [[ "$output" =~ TBD ]]
    [[ "$output" =~ Ready ]]
    [[ "$output" =~ Done ]]
}

@test "config-reader: handles comments correctly" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
# This is a comment
key1=value1
# Another comment
key2=value2
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value test key1"
    [ "$status" -eq 0 ]
    [ "$output" = "value1" ]
}

@test "config-reader: handles empty values" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
empty_key=
nonempty_key=value
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value test empty_key default"
    [ "$status" -eq 0 ]
    [ "$output" = "default" ]
}

@test "config-reader: handles values with spaces" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[test]
key=value with spaces in it
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && config_init $TEST_CONFIG_FILE && config_read_value test key"
    [ "$status" -eq 0 ]
    [ "$output" = "value with spaces in it" ]
}
