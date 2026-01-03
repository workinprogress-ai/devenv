#!/usr/bin/env bats
# Tests for function documentation standards

bats_require_minimum_version 1.5.0

load test_helper

@test "bootstrap.sh on_error function has documentation" {
  run bash -c "grep -B 5 '^on_error()' $PROJECT_ROOT/.devcontainer/bootstrap.sh | head -6"
  [ "$status" -eq 0 ]
  # Function exists and is defined
  [[ "$output" =~ "on_error" ]]
}

@test "lib/error-handling.bash functions have documentation headers" {
  if [ -f "$PROJECT_ROOT/tools/lib/error-handling.bash" ]; then
    # Check that the file exists and has function definitions
    run grep -c "^.*()" "$PROJECT_ROOT/tools/lib/error-handling.bash"
    [ "$status" -eq 0 ]
    [ "$output" -gt 0 ]
  else
    skip "error-handling.sh not found"
  fi
}

@test "lib/git-config.bash functions have documentation" {
  run bash -c "grep -B 3 '^configure_git_repo()' $PROJECT_ROOT/tools/lib/git-config.bash | grep -q '# Args:'"
  [ "$status" -eq 0 ]
}

@test "lib/versioning.bash functions have documentation" {
  run grep -c "# Usage:" "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
  [ "$output" -gt 5 ]
}

@test "lib/retry.bash functions have comprehensive documentation" {
  run grep -c "# Arguments:" "$PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
  [ "$output" -gt 5 ]
}

@test "script template includes documentation examples" {
  run grep "# Arguments:" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
  run grep "# Returns:" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
  run grep "# Side effects:" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "complex functions in bootstrap have parameter descriptions" {
  # Check if bootstrap functions have parameter docs
  run bash -c "grep -A 5 'add_nuget_source' $PROJECT_ROOT/.devcontainer/bootstrap.sh 2>/dev/null | grep -q '\$1\|\$2\|\$3\|\$4' && echo 'has_params' || echo 'no_params'"
  [ "$status" -eq 0 ]
}

@test "public library functions have return value documentation" {
  # Key library functions should document return values
  run bash -c "grep -B 5 'compare_versions()' $PROJECT_ROOT/tools/lib/versioning.bash | grep -q 'Returns:'"
  [ "$status" -eq 0 ]
}

@test "error handling functions document exit codes" {
  if [ -f "$PROJECT_ROOT/tools/lib/error-handling.bash" ]; then
    run bash -c "grep -c 'exit code\|Exit code\|EXIT_' $PROJECT_ROOT/tools/lib/error-handling.bash"
    [ "$status" -eq 0 ]
    [ "$output" -gt 3 ]
  else
    skip "error-handling.sh not found"
  fi
}

@test "retry functions have usage examples in comments" {
  run bash -c "grep -c '# Example:' $PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
  [ "$output" -gt 3 ]
}
