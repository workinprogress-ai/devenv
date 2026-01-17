#!/usr/bin/env bats
# Tests for issues-config.bash

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
}

teardown() {
    test_helper_teardown
}

create_issues_config() {
    local path="$1"
    cat > "$path" <<'EOF'
types:
  - name: Bug
    description: "A bug or defect that needs fixing"
    id: "IT_kwDOCk-E0c4BWVJJ"
  
  - name: Feature
    description: "A new feature or enhancement"
    id: "IT_kwDOCk-E0c4BWVJK"
  
  - name: Task
    description: "A task or work item"
    id: "IT_kwDOCk-E0c4BWVJI"
EOF
}

@test "issues_config_path returns default path" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; issues_config_path"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "issues-config.yml" ]]
}

@test "issues_config_path honors override parameter" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; issues_config_path /tmp/custom-config.yml"
    [ "$status" -eq 0 ]
    [ "$output" = "/tmp/custom-config.yml" ]
}

@test "issues_config_path honors ISSUES_CONFIG environment variable" {
    run bash -c "export ISSUES_CONFIG=/tmp/env-config.yml; source $PROJECT_ROOT/tools/lib/issues-config.bash; issues_config_path"
    [ "$status" -eq 0 ]
    [ "$output" = "/tmp/env-config.yml" ]
}

@test "load_issues_config validates file exists" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; load_issues_config /tmp/does-not-exist"
    [ "$status" -ne 0 ]
}

@test "load_issues_config returns path when file exists" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; load_issues_config $cfg"
    [ "$status" -eq 0 ]
    [ "$output" = "$cfg" ]
}

@test "get_issue_types returns all type names" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; get_issue_types $cfg"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Bug" ]]
    [[ "$output" =~ "Feature" ]]
    [[ "$output" =~ "Task" ]]
}

@test "get_issue_type_description returns type description" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; get_issue_type_description Bug $cfg"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "bug or defect" ]]
}

@test "get_issue_type_id returns correct ID for type" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; get_issue_type_id Bug $cfg"
    [ "$status" -eq 0 ]
    [ "$output" = "IT_kwDOCk-E0c4BWVJJ" ]

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; get_issue_type_id Feature $cfg"
    [ "$status" -eq 0 ]
    [ "$output" = "IT_kwDOCk-E0c4BWVJK" ]

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; get_issue_type_id Task $cfg"
    [ "$status" -eq 0 ]
    [ "$output" = "IT_kwDOCk-E0c4BWVJI" ]
}

@test "validate_issue_type succeeds for valid types" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; validate_issue_type Bug $cfg"
    [ "$status" -eq 0 ]

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; validate_issue_type Feature $cfg"
    [ "$status" -eq 0 ]

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; validate_issue_type Task $cfg"
    [ "$status" -eq 0 ]
}

@test "validate_issue_type fails for invalid types" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; validate_issue_type InvalidType $cfg"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "Invalid issue type" ]]
}

@test "get_issue_types_array returns space-separated types" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; get_issue_types_array $cfg"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Bug" ]]
    [[ "$output" =~ "Feature" ]]
    [[ "$output" =~ "Task" ]]
    # Should not have newlines
    [[ ! "$output" =~ $'\n' ]]
}

@test "issues config functions work with env variable override" {
    local cfg="$TEST_TEMP_DIR/issues-config.yml"
    create_issues_config "$cfg"

    run bash -c "export ISSUES_CONFIG=$cfg; source $PROJECT_ROOT/tools/lib/issues-config.bash; get_issue_types"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Bug" ]]
}

@test "library guards against multiple sourcing" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issues-config.bash; source $PROJECT_ROOT/tools/lib/issues-config.bash; echo 'OK'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "OK" ]]
}

# =========================================================================
# Org issue type IDs sync tests (mocked gh)
# =========================================================================

create_mock_gh_issue_types() {
    mkdir -p "$TEST_TEMP_DIR/bin"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    local response='{"data":{"organization":{"issueTypes":{"edges":[{"node":{"id":"IT_kwDOCk-E0c4BWVJJ","name":"Bug"}},{"node":{"id":"IT_kwDOCk-E0c4BWVJK","name":"Feature"}},{"node":{"id":"IT_kwDOCk-E0c4BWVJI","name":"Task"}}]}}}}'
    cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  echo "$GH_STUB_RESPONSE"
  exit 0
fi
exit 0
EOF
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export GH_STUB_RESPONSE="$response"
}

@test "fetch_org_issue_type_ids returns expected mapping" {
    create_mock_gh_issue_types
    run bash -c "export GH_ORG=test-org; source $PROJECT_ROOT/tools/lib/issues-config.bash; fetch_org_issue_type_ids"
    [ "$status" -eq 0 ]
    [[ "$output" =~ $'Bug\tIT_kwDOCk-E0c4BWVJJ' ]]
    [[ "$output" =~ $'Feature\tIT_kwDOCk-E0c4BWVJK' ]]
    [[ "$output" =~ $'Task\tIT_kwDOCk-E0c4BWVJI' ]]
}

