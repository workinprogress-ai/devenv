#!/usr/bin/env bats
# Tests for repo-types.bash

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  mkdir -p "$TEST_TEMP_DIR/bin"
}

teardown() {
  test_helper_teardown
}

# Helper to create a stub gh that records calls
create_stub_gh() {
  local response="$1"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "api" ]; then
  # Simulate API call
  shift
  echo "$GH_STUB_RESPONSE"
  exit 0
fi
# Default success
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"
  export GH_STUB_RESPONSE="$response"
}

create_repo_types_config() {
  local path="$1"
  cat > "$path" <<'EOF'
types:
  service:
    naming_pattern: "^service\\.[a-z0-9-]+\\.[a-z0-9-]+$"
    naming_example: "service.platform.identity"
    applyRuleset: true
    rulesets:
      - name: "Require PR"
        enforcement: "active"
        rules: [{"type":"pull_request"}]
  none:
    naming_pattern: ".*"
    naming_example: "anything"
    applyRuleset: false
EOF
}

@test "repo_types_config_path honors override and env" {
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; repo_types_config_path /tmp/override"
  [ "$status" -eq 0 ]
  [ "$output" = "/tmp/override" ]

  run bash -c "export REPO_TYPES_CONFIG=/tmp/from_env; source $PROJECT_ROOT/tools/lib/repo-types.bash; repo_types_config_path"
  [ "$status" -eq 0 ]
  [ "$output" = "/tmp/from_env" ]
}

@test "load_repo_types_config fails when file missing" {
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; load_repo_types_config /tmp/does-not-exist"
  [ "$status" -ne 0 ]
}

@test "validate_repo_type enforces naming pattern" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; validate_repo_type service.platform.identity service $cfg"
  [ "$status" -eq 0 ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; validate_repo_type invalid service $cfg"
  [ "$status" -ne 0 ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; validate_repo_type anything unknown $cfg"
  [ "$status" -ne 0 ]
}

@test "validate_repo_type extracts repo name from owner/repo format" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"

  # Should extract "service.platform.identity" from "workinprogress-ai/service.platform.identity"
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; validate_repo_type workinprogress-ai/service.platform.identity service $cfg"
  [ "$status" -eq 0 ]

  # Should extract "invalid" from "workinprogress-ai/invalid" and fail pattern match
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; validate_repo_type workinprogress-ai/invalid service $cfg"
  [ "$status" -ne 0 ]
}

@test "configure_rulesets_for_type applies configured rulesets" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"
  create_stub_gh '{"id":123}'

  run bash -c "PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_rulesets_for_type test-org/test-repo service $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Ruleset 'Require PR' configured" ]]
}

@test "configure_rulesets_for_type returns success on 403 guidance" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "api" ]; then
  echo "403 Forbidden"
  exit 1
fi
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"

  run bash -c "PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_rulesets_for_type test-org/test-repo service $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Rulesets require GitHub Pro" ]]
}
@test "detect_repo_type matches service pattern" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type service.platform.identity $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "service" ]
}

@test "detect_repo_type extracts repo name from full name" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type workinprogress-ai/service.platform.identity $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "service" ]
}

@test "detect_repo_type matches none pattern for any name" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type anything-goes $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]
}

@test "detect_repo_type returns first matching pattern" {
  local cfg="$TEST_TEMP_DIR/repo-types-multi.yaml"
  cat > "$cfg" <<'EOF'
types:
  docs:
    naming_pattern: "^docs\\.[a-z0-9-]+$"
    naming_example: "docs.something"
  all:
    naming_pattern: ".*"
    naming_example: "anything"
EOF

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type docs.api $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "docs" ]
}

@test "detect_repo_type returns failure in silent mode with no match" {
  local cfg="$TEST_TEMP_DIR/repo-types-strict.yaml"
  cat > "$cfg" <<'EOF'
types:
  service:
    naming_pattern: "^service\\.[a-z0-9-]+\\.[a-z0-9-]+$"
    naming_example: "service.platform.identity"
EOF

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type invalid-name $cfg silent"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "detect_repo_type handles multiple types correctly" {
  local cfg="$TEST_TEMP_DIR/repo-types-complex.yaml"
  cat > "$cfg" <<'EOF'
types:
  planning:
    naming_pattern: "^planning(\\.[a-z0-9-]+)+$"
    naming_example: "planning.roadmap"
  docs:
    naming_pattern: "^docs\\.[a-z0-9-]+$"
    naming_example: "docs.api"
  service:
    naming_pattern: "^service\\.[a-z0-9-]+\\.[a-z0-9-]+$"
    naming_example: "service.platform.identity"
EOF

  # Test planning type
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type planning.roadmap $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "planning" ]

  # Test docs type
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type docs.api $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "docs" ]

  # Test service type
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type service.platform.auth $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "service" ]
}

@test "detect_repo_type handles edge cases" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"

  # Test with just owner/ (empty repo name)
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type workinprogress-ai/ $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]  # Empty string matches .* pattern

  # Test with no slash (just repo name)
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; detect_repo_type service.platform.test $cfg silent"
  [ "$status" -eq 0 ]
  [ "$output" = "service" ]
}

@test "configure_merge_types_for_type handles missing allowedMergeTypes" {
  local cfg="$TEST_TEMP_DIR/repo-types-no-merge.yaml"
  cat > "$cfg" <<'EOF'
types:
  custom:
    naming_pattern: "^custom.*"
    naming_example: "custom.repo"
    applyRuleset: false
EOF
  
  # Create stub gh that expects calls with default merge settings
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "api" ] && [ "$2" = "-X" ] && [ "$3" = "PATCH" ]; then
  # Should default to merge: true, squash: false, rebase: false
  if [[ "$@" == *'allow_merge_commit=true'* ]]; then
    echo '{"allow_merge_commit": true}'
    exit 0
  fi
fi
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"

  run bash -c "PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_merge_types_for_type test-org/test-repo custom $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "merge: true" ]]
  [[ "$output" =~ "squash: false" ]]
  [[ "$output" =~ "rebase: false" ]]
}

@test "configure_merge_types_for_type reads allowedMergeTypes from config" {
  local cfg="$TEST_TEMP_DIR/repo-types-squash.yaml"
  cat > "$cfg" <<'EOF'
types:
  docs:
    naming_pattern: "^docs.*"
    naming_example: "docs.something"
    allowedMergeTypes:
      - squash
    applyRuleset: false
EOF
  
  # Create stub gh that expects squash only
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "api" ] && [ "$2" = "-X" ] && [ "$3" = "PATCH" ]; then
  if [[ "$@" == *'allow_merge_commit=false'* ]] && [[ "$@" == *'allow_squash_merge=true'* ]]; then
    echo '{"allow_squash_merge": true}'
    exit 0
  fi
fi
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"

  run bash -c "PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_merge_types_for_type test-org/test-repo docs $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "merge: false" ]]
  [[ "$output" =~ "squash: true" ]]
  [[ "$output" =~ "rebase: false" ]]
}

# Getter default tests

@test "getters return sensible defaults when properties missing" {
  local cfg="$TEST_TEMP_DIR/repo-types-min.yaml"
  cat > "$cfg" <<'EOF'
types:
  custom:
    naming_pattern: "^custom.*"
    naming_example: "custom.repo"
EOF

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_main_branch custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "master" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_template custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_apply_ruleset custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_allowed_merge_types custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "[\"merge\"]" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_is_template custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_post_creation_script custom $cfg"
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_delete_post_creation_script custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_post_creation_commit_handling custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_description custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "No description" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "^custom.*" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_example custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "custom.repo" ]
}

@test "getters return real values from full config (documentation)" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_main_branch documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "master" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_template documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "template.docs" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_apply_ruleset documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_allowed_merge_types documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "[\"squash\"]" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_is_template template $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_post_creation_script documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = ".repo/post-create.sh" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_delete_post_creation_script documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_post_creation_commit_handling documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "amend" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_description documentation $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Documentation repositories" ]]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern documentation $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "^docs(\.[a-z0-9-]+)+$" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_example documentation $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "docs.api.reference" ]]
}