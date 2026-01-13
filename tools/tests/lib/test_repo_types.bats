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
    rulesetConfigFile: ruleset-default.json
  none:
    naming_pattern: ".*"
    naming_example: "anything"
    rulesetConfigFile: null
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
  
  # Create test ruleset JSON file
  mkdir -p "$TEST_TEMP_DIR/config"
  cat > "$TEST_TEMP_DIR/config/ruleset-default.json" <<'EOJSON'
{
  "name": "Require PR",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [{"type": "pull_request", "parameters": {"required_approving_review_count": 1}}],
  "bypass_actors": [],
  "source_type": "Repository",
  "source": "{{owner}}/{{repo_name}}"
}
EOJSON
  
  run bash -c "export DEVENV_TOOLS=$TEST_TEMP_DIR; source $PROJECT_ROOT/tools/lib/error-handling.bash; source $PROJECT_ROOT/tools/lib/validation.bash; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_rulesets_for_type test-org/test-repo service $cfg"
  [ "$status" -eq 0 ]
}

@test "configure_rulesets_for_type updates existing ruleset via PUT" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"

  # Create test ruleset JSON file
  mkdir -p "$TEST_TEMP_DIR/config"
  cat > "$TEST_TEMP_DIR/config/ruleset-default.json" <<'EOJSON'
{
  "name": "Require PR",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [{"type": "pull_request", "parameters": {"required_approving_review_count": 1}}],
  "bypass_actors": [],
  "source_type": "Repository",
  "source": "{{owner}}/{{repo_name}}"
}
EOJSON

  # Stub gh to simulate existing ruleset and capture calls
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# Resolve log path next to the bin directory
script_dir="$(cd "$(dirname "$0")" && pwd)"
log_file="${script_dir%/bin}/gh_calls.log"
echo "$@" >> "$log_file"
if [ "$1" = "api" ] && [[ "$2" == repos/*/*/rulesets ]]; then
  # List rulesets: return one with matching name and id 999
  echo '[{"id":999,"name":"Require PR"}]'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "--input" ] && [ "$4" = "-X" ] && [ "$5" = "PUT" ]; then
  # PUT update call
  echo '{"id":999}'
  exit 0
fi
# Default: succeed quietly
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"

  run bash -c "echo cfg=$cfg; ls -la $cfg; PATH=$TEST_TEMP_DIR/bin:$PATH; export DEVENV_TOOLS=$TEST_TEMP_DIR; source $PROJECT_ROOT/tools/lib/error-handling.bash; source $PROJECT_ROOT/tools/lib/validation.bash; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_rulesets_for_type test-org/test-repo service $cfg"
  echo "=== OUTPUT START ==="
  echo "$output"
  echo "=== OUTPUT END ==="
  [ "$status" -eq 0 ]
  # Verify PUT was called
  run bash -lc "grep -q 'PUT repos/test-org/test-repo/rulesets/999' $TEST_TEMP_DIR/gh_calls.log"
  [ "$status" -eq 0 ]
}

@test "configure_rulesets_for_type returns success on 403 guidance" {
  local cfg="$TEST_TEMP_DIR/repo-types.yaml"
  create_repo_types_config "$cfg"
  
  # Create test ruleset JSON file
  mkdir -p "$TEST_TEMP_DIR/config"
  cat > "$TEST_TEMP_DIR/config/ruleset-default.json" <<'EOJSON'
{
  "name": "Require PR",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [{"type": "pull_request"}],
  "bypass_actors": [],
  "source_type": "Repository",
  "source": "{{owner}}/{{repo_name}}"
}
EOJSON

  run bash -c "export DEVENV_TOOLS=$TEST_TEMP_DIR; source $PROJECT_ROOT/tools/lib/error-handling.bash; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_rulesets_for_type test-org/test-repo service $cfg"
  [ "$status" -eq 0 ]
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
    rulesetConfigFile: null
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
    rulesetConfigFile: null
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

@test "configure_pr_branch_deletion_for_type applies setting via API" {
  create_stub_gh '{"success": true}'
  local cfg
  cfg=$(mktemp)
  cat > "$cfg" <<'EOF'
types:
  service:
    naming_pattern: "^service\\.[a-z0-9-]+\\.[a-z0-9-]+$"
    naming_example: "service.platform.identity"
    deletePRBranchOnMerge: true
EOF

  run bash -c "export DEVENV_TOOLS=$TEST_TEMP_DIR; PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/error-handling.bash; source $PROJECT_ROOT/tools/lib/validation.bash; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_pr_branch_deletion_for_type test-org/test-repo service $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "PR branch deletion on merge configured" ]]
  [[ "$output" =~ "enabled: true" ]]
  rm -f "$cfg"
}

@test "configure_pr_branch_deletion_for_type respects config setting false" {
  create_stub_gh '{"success": true}'
  local cfg
  cfg=$(mktemp)
  cat > "$cfg" <<'EOF'
types:
  none:
    naming_pattern: ".*"
    naming_example: "anything"
    deletePRBranchOnMerge: false
EOF

  run bash -c "export DEVENV_TOOLS=$TEST_TEMP_DIR; PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/error-handling.bash; source $PROJECT_ROOT/tools/lib/validation.bash; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_pr_branch_deletion_for_type test-org/test-repo none $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Configuring PR branch deletion" ]]
  [[ "$output" =~ "false" ]]
  rm -f "$cfg"
}

@test "configure_repository_features_for_type applies all settings via API" {
  create_stub_gh '{"success": true}'
  local cfg
  cfg=$(mktemp)
  cat > "$cfg" <<'EOF'
types:
  service:
    naming_pattern: "^service\\.[a-z0-9-]+\\.[a-z0-9-]+$"
    naming_example: "service.platform.identity"
    hasWiki: false
    hasIssues: true
    hasDiscussions: false
    hasProjects: false
    allowAutoMerge: true
    allowUpdateBranch: true
    allowForking: false
    squashMergeCommitTitle: PR_TITLE
    squashMergeCommitMessage: COMMIT_MESSAGES
EOF

  run bash -c "export DEVENV_TOOLS=$TEST_TEMP_DIR; PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/error-handling.bash; source $PROJECT_ROOT/tools/lib/validation.bash; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_repository_features_for_type test-org/test-repo service $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Repository features configured" ]]
  [[ "$output" =~ "Wiki: false" ]]
  [[ "$output" =~ "Issues: true" ]]
  [[ "$output" =~ "Discussions: false" ]]
  [[ "$output" =~ "Projects: false" ]]
  [[ "$output" =~ "Auto-merge: true" ]]
  [[ "$output" =~ "Update branch: true" ]]
  [[ "$output" =~ "Forking: false" ]]
  [[ "$output" =~ "title=PR_TITLE" ]]
  [[ "$output" =~ "message=COMMIT_MESSAGES" ]]
  rm -f "$cfg"
}

@test "configure_repository_features_for_type respects all config settings" {
  create_stub_gh '{"success": true}'
  local cfg
  cfg=$(mktemp)
  cat > "$cfg" <<'EOF'
types:
  template:
    naming_pattern: "^template\\..*"
    naming_example: "template.service"
    hasWiki: true
    hasIssues: false
    hasDiscussions: true
    hasProjects: true
    allowAutoMerge: false
    allowUpdateBranch: false
    allowForking: true
    squashMergeCommitTitle: COMMIT_OR_PR_TITLE
    squashMergeCommitMessage: PR_BODY
EOF

  run bash -c "export DEVENV_TOOLS=$TEST_TEMP_DIR; PATH=$TEST_TEMP_DIR/bin:$PATH; source $PROJECT_ROOT/tools/lib/error-handling.bash; source $PROJECT_ROOT/tools/lib/validation.bash; source $PROJECT_ROOT/tools/lib/repo-types.bash; configure_repository_features_for_type test-org/test-repo template $cfg"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Repository features configured" ]]
  [[ "$output" =~ "Wiki: true" ]]
  [[ "$output" =~ "Issues: false" ]]
  [[ "$output" =~ "Discussions: true" ]]
  [[ "$output" =~ "Projects: true" ]]
  [[ "$output" =~ "Auto-merge: false" ]]
  [[ "$output" =~ "Update branch: false" ]]
  [[ "$output" =~ "Forking: true" ]]
  [[ "$output" =~ "title=COMMIT_OR_PR_TITLE" ]]
  [[ "$output" =~ "message=PR_BODY" ]]
  rm -f "$cfg"
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

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_ruleset_config_file custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "null" ]

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

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_delete_pr_branch_on_merge custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_has_wiki custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_has_issues custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_has_discussions custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_has_projects custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_allow_auto_merge custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_allow_update_branch custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_allow_forking custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_squash_merge_commit_title custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "PR_TITLE" ]

  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_squash_merge_commit_message custom $cfg"
  [ "$status" -eq 0 ]
  [ "$output" = "COMMIT_MESSAGES" ]
}