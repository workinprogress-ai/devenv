#!/usr/bin/env bats
# Tests for repo-create.sh

bats_require_minimum_version 1.5.0

load ../test_helper

@test "repo-create.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/repo-create.sh"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh passes shellcheck" {
  run shellcheck -S warning "$PROJECT_ROOT/tools/scripts/repo-create.sh"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh requires --type parameter" {
  run "$PROJECT_ROOT/tools/scripts/repo-create.sh" test-repo
  [ "$status" -ne 0 ]
  [[ "$output" =~ "--type is required" || "$output" =~ "--interactive" ]]
}

@test "repo-create.sh shows help with --help" {
  run "$PROJECT_ROOT/tools/scripts/repo-create.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
  [[ "$output" =~ "Repository Types:" ]]
  [[ "$output" =~ "--interactive" ]]
}

@test "repo-types.yaml exists and is valid YAML" {
  [ -f "$PROJECT_ROOT/tools/config/repo-types.yaml" ]
  run yq eval 'keys' "$PROJECT_ROOT/tools/config/repo-types.yaml"
  [ "$status" -eq 0 ]
}

@test "repo-types.yaml defines expected types" {
  run yq eval '.types | keys[]' "$PROJECT_ROOT/tools/config/repo-types.yaml"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "planning" ]]
  [[ "$output" =~ "service" ]]
  [[ "$output" =~ "gateway" ]]
  [[ "$output" =~ "app-web" ]]
  [[ "$output" =~ "cs-library" ]]
  [[ "$output" =~ "ts-package" ]]
  [[ "$output" =~ "none" ]]
}

@test "repo-types.yaml: all types have required fields" {
  run bash -c "
    yq eval '.types | keys[]' '$PROJECT_ROOT/tools/config/repo-types.yaml' | while read type; do
      [ -n \"\$(yq eval \".types.\\\$type.naming_pattern\" '$PROJECT_ROOT/tools/config/repo-types.yaml')\" ] || exit 1
      [ -n \"\$(yq eval \".types.\\\$type.naming_example\" '$PROJECT_ROOT/tools/config/repo-types.yaml')\" ] || exit 1
      [ -n \"\$(yq eval \".types.\\\$type.branch_protection\" '$PROJECT_ROOT/tools/config/repo-types.yaml')\" ] || exit 1
      [ -n \"\$(yq eval \".types.\\\$type.post_creation_script\" '$PROJECT_ROOT/tools/config/repo-types.yaml')\" ] || exit 1
      [ -n \"\$(yq eval \".types.\\\$type.post_creation_commit_handling\" '$PROJECT_ROOT/tools/config/repo-types.yaml')\" ] || exit 1
    done
  "
  [ "$status" -eq 0 ]
}

@test "service naming pattern validation" {
  # Valid service name
  run bash -c "echo 'service.platform.identity' | grep -qE '^service\\.[a-z0-9-]+\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
  
  # Valid service name with hyphens
  run bash -c "echo 'service.stargate.resident-profile' | grep -qE '^service\\.[a-z0-9-]+\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
  
  # Invalid - missing category
  run bash -c "echo 'service.identity' | grep -qE '^service\\.[a-z0-9-]+\\.[a-z0-9-]+$'"
  [ "$status" -ne 0 ]
}

@test "cs-library naming pattern validation" {
  # Valid cs-library with 2 parts
  run bash -c "echo 'lib.cs.common.utilities' | grep -qE '^lib\\.cs\\.[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
  
  # Valid cs-library with 3+ parts
  run bash -c "echo 'lib.cs.platform.auth.core' | grep -qE '^lib\\.cs\\.[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
  
  # Invalid - missing name
  run bash -c "echo 'lib.cs.common' | grep -qE '^lib\\.cs\\.[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z0-9-]+$'"
  [ "$status" -ne 0 ]
}

@test "planning naming pattern validation" {
  # Valid with optional category
  run bash -c "echo 'planning.development.main' | grep -qE '^planning(\\.[a-z0-9-]+)?\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
  
  # Valid without category
  run bash -c "echo 'planning.roadmap' | grep -qE '^planning(\\.[a-z0-9-]+)?\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
}

@test "ts-package naming pattern validation" {
  # Valid ts-package
  run bash -c "echo 'pkg.ts.ui-components' | grep -qE '^pkg\\.ts\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
  
  # Invalid - too many parts
  run bash -c "echo 'pkg.ts.ui.components' | grep -qE '^pkg\\.ts\\.[a-z0-9-]+$'"
  [ "$status" -ne 0 ]
}

@test "app-web naming pattern validation" {
  # Valid app-web
  run bash -c "echo 'app.web.admin-portal' | grep -qE '^app\\.web\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
  
  # Invalid - wrong prefix
  run bash -c "echo 'app.mobile.admin' | grep -qE '^app\\.web\\.[a-z0-9-]+$'"
  [ "$status" -ne 0 ]
}

@test "gateway naming pattern validation" {
  # Valid gateway
  run bash -c "echo 'gateway.platform.main' | grep -qE '^gateway\\.[a-z0-9-]+\\.[a-z0-9-]+$'"
  [ "$status" -eq 0 ]
}

@test "repo-types.yaml: branch protection settings exist for all types" {
  run bash -c "
    yq eval '.types | keys[]' '$PROJECT_ROOT/tools/config/repo-types.yaml' | while read type; do
      require_pr=\$(yq eval \".types.\\\$type.branch_protection.require_pull_request\" '$PROJECT_ROOT/tools/config/repo-types.yaml')
      review_count=\$(yq eval \".types.\\\$type.branch_protection.required_approving_review_count\" '$PROJECT_ROOT/tools/config/repo-types.yaml')
      [ -n \"\$require_pr\" ] && [ -n \"\$review_count\" ] || exit 1
    done
  "
  [ "$status" -eq 0 ]
}

@test "repo-create.sh requires yq command" {
  run grep "require_cmd yq" "$PROJECT_ROOT/tools/scripts/repo-create.sh"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh contains validate_repo_type function" {
  run grep "^validate_repo_type()" "$PROJECT_ROOT/tools/scripts/repo-create.sh"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh sources git-operations library" {
  run grep "source.*git-operations.bash" "$PROJECT_ROOT/tools/scripts/repo-create.sh"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh contains post-creation script handling" {
  run grep "run_post_creation_script" "$PROJECT_ROOT/tools/scripts/repo-create.sh"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh contains interactive mode" {
  run grep "select_repo_type_interactive" "$PROJECT_ROOT/tools/scripts/repo-create.sh"
  [ "$status" -eq 0 ]
}
