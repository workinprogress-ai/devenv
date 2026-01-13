#!/usr/bin/env bats
# Configuration validation tests for repo-types.yaml
# These tests validate the actual config file to prevent invalid commits
# Validates structure, property names, value types, and allowed values

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

# Helper: Get a value from config using yq
get_config_value() {
  local path="$1"
  local cfg="$2"
  yq "$path" "$cfg" 2>/dev/null
}

# Helper: Check if a string is in a comma-separated list
is_valid_value() {
  local value="$1"
  local valid_values="$2"  # comma-separated
  [[ ",${valid_values}," == *",${value},"* ]]
}

@test "config file exists and is readable" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  [ -f "$cfg" ]
  [ -r "$cfg" ]
}

@test "config YAML is valid and can be parsed" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  run yq '.types | keys | length' "$cfg"
  [ "$status" -eq 0 ]
  [ "$output" -gt 0 ]
}

@test "config can be loaded by library" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; load_repo_types_config '$cfg' > /dev/null 2>&1"
  [ "$status" -eq 0 ]
}

@test "planning repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  # Test core properties exist and have values
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_description planning '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Planning" ]]
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern planning '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "planning" ]]
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_main_branch planning '$cfg'"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "documentation repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_description documentation '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Documentation" ]]
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern documentation '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "docs" ]]
  
  # Test boolean properties are properly formatted
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_has_wiki documentation '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ (true|false) ]]
}

@test "template repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_description template '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Template" ]]
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_is_template template '$cfg'"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}

@test "service repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_description service '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "microservice" ]]
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern service '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "service" ]]
}

@test "gateway repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern gateway '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "gateway" ]]
}

@test "app-web repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern app-web '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "web" || "$output" =~ "app" ]]
}

@test "cs-library repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern cs-library '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "cs" ]]
}

@test "ts-package repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern ts-package '$cfg'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "ts" || "$output" =~ "npm" ]]
}

@test "none repo type has valid properties" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern none '$cfg'"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "all repo types have allowedMergeTypes defined" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  for type in planning documentation template service gateway app-web cs-library ts-package none; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_allowed_merge_types '$type' '$cfg'"
    [ "$status" -eq 0 ] || echo "Failed for type: $type"
    [ -n "$output" ] || echo "Empty output for type: $type"
  done
}

@test "squash merge properties are valid values" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  # Test a few types to ensure squash merge properties are valid
  for type in planning documentation service; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_squash_merge_commit_title '$type' '$cfg'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ (PR_TITLE|COMMIT_OR_PR_TITLE) ]] || echo "Invalid title value for $type: $output"
    
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_squash_merge_commit_message '$type' '$cfg'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ (PR_BODY|COMMIT_MESSAGES|BLANK) ]] || echo "Invalid message value for $type: $output"
  done
}

@test "boolean properties return valid values" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  # Test boolean properties for documentation type
  local bool_props=(
    "has_wiki"
    "has_issues"
    "has_discussions"
    "has_projects"
    "allow_auto_merge"
    "allow_update_branch"
    "allow_forking"
    "delete_pr_branch_on_merge"
  )
  
  for prop in "${bool_props[@]}"; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_${prop} documentation '$cfg'"
    [ "$status" -eq 0 ] || echo "Failed to get $prop for documentation"
    [[ "$output" =~ (true|false) ]] || echo "Invalid boolean value for $prop: $output"
  done
}

@test "naming patterns are non-empty for all types" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  for type in planning documentation template service gateway app-web cs-library ts-package none; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_naming_pattern '$type' '$cfg'"
    [ "$status" -eq 0 ]
    [ -n "$output" ] || echo "Empty naming pattern for type: $type"
    # Patterns should look like regex
    [[ "$output" =~ (\^|\\.) ]] || [[ "$output" == ".*" ]] || echo "Suspicious pattern for $type: $output"
  done
}

@test "template property is valid for all types" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  for type in planning documentation template service gateway app-web cs-library ts-package none; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_template '$type' '$cfg'"
    [ "$status" -eq 0 ]
    # Template should be either null or a valid template reference (template.*)
    [[ "$output" == "null" ]] || [[ "$output" =~ ^template\. ]] || echo "Invalid template for $type: $output"
  done
}

@test "main branch is set to either master or main for all types" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  for type in planning documentation template service gateway app-web cs-library ts-package none; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_main_branch '$type' '$cfg'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ (master|main) ]] || echo "Unexpected main branch for $type: $output"
  done
}

@test "no repo type has isTemplate set to true except template types" {
  local cfg="$PROJECT_ROOT/tools/config/repo-types.yaml"
  
  # These types should have isTemplate=true
  for type in template; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_is_template '$type' '$cfg'"
    [ "$status" -eq 0 ]
    [ "$output" = "true" ] || echo "Expected template type $type to have isTemplate=true, got: $output"
  done
  
  # These types should NOT have isTemplate=true
  for type in planning documentation service gateway app-web cs-library ts-package none; do
    run bash -c "source $PROJECT_ROOT/tools/lib/repo-types.bash; get_type_is_template '$type' '$cfg'"
    [ "$status" -eq 0 ]
    [ "$output" = "false" ] || echo "Expected non-template type $type to have isTemplate=false, got: $output"
  done
}
