#!/usr/bin/env bats
# Tests for function naming conventions

setup() {
  # Handle both test locations (tests/ and tests/lib/ or tests/scripts/ or tests/devenv/)
  if [[ "$BATS_TEST_DIRNAME" =~ /tests/(lib|scripts|devenv)$ ]]; then
    PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"
  else
    PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  fi
}

@test "Function naming conventions documentation exists" {
  [ -f "$PROJECT_ROOT/docs/Function-Naming-Conventions.md" ]
}

@test "Documentation covers snake_case standard" {
  run grep -q "snake_case" "$PROJECT_ROOT/docs/Function-Naming-Conventions.md"
  [ "$status" -eq 0 ]
}

@test "Documentation includes verb prefix table" {
  run grep -q "| Prefix | Purpose | Example |" "$PROJECT_ROOT/docs/Function-Naming-Conventions.md"
  [ "$status" -eq 0 ]
}

@test "Documentation includes good and bad examples" {
  run grep -q "Good Names" "$PROJECT_ROOT/docs/Function-Naming-Conventions.md"
  [ "$status" -eq 0 ]
  run grep -q "Bad Names" "$PROJECT_ROOT/docs/Function-Naming-Conventions.md"
  [ "$status" -eq 0 ]
}

@test "lib functions follow snake_case convention" {
  # Check that library functions don't have camelCase
  run bash -c "cd $PROJECT_ROOT && grep -hE '^[a-zA-Z_][a-zA-Z0-9_]*\\(\\)' tools/lib/*.bash | grep -E '[a-z][A-Z]'"
  [ "$status" -ne 0 ]
}

@test "lib functions use descriptive verb prefixes" {
  # Common prefixes: get_, set_, check_, validate_, require_, is_, has_, add_, etc.
  run bash -c "cd $PROJECT_ROOT && grep -hE '^(get_|set_|check_|validate_|require_|is_|has_|add_|create_|remove_|enable_|configure_|log_|parse_|compare_|on_|use_|run_|assert|success|warn|info|die|retry_|safe_|command_|config_|version_|script_)[a-z_]+\\(\\)' tools/lib/*.bash | wc -l"
  [ "$status" -eq 0 ]
  # Should find many functions with standard prefixes
  [ "$output" -gt 10 ]
}

@test "error-handling.bash functions use consistent naming" {
  run bash -c "grep -E '^(log_|require_|validate_|command_|create_|enable_|safe_)[a-z_]+\\(\\)' \"$PROJECT_ROOT/tools/lib/error-handling.bash\" || true"
  [ -n "$output" ]
}

@test "config.bash functions use config_ namespace prefix" {
  run bash -c "grep -E '^config_[a-z_]+\\(\\)' \"$PROJECT_ROOT/tools/lib/config.bash\" || true"
  [ -n "$output" ]
  # Should find multiple config_* functions
  [ "${#lines[@]}" -gt 3 ]
}

@test "versioning.bash functions use descriptive names" {
  run bash -c "grep -E '^(parse_|compare_|version_|get_|check_|require_|script_)[a-z_]+\\(\\)' \"$PROJECT_ROOT/tools/lib/versioning.bash\" || true"
  [ -n "$output" ]
}

@test "git-config.bash functions use configure_ or add_ prefix" {
  run bash -c "grep -E '^(configure_|add_)[a-z_]+\\(\\)' \"$PROJECT_ROOT/tools/lib/git-config.bash\" || true"
  [ -n "$output" ]
}

@test "no functions use camelCase in libraries" {
  # Look for patterns like someFunction() or getSomeThing()
  run bash -c "cd $PROJECT_ROOT && grep -hE '^[a-z]+[A-Z][a-zA-Z]*\\(\\)' tools/lib/*.bash"
  [ "$status" -ne 0 ]
}

@test "no functions use PascalCase in libraries" {
  # Look for patterns like SomeFunction()
  run bash -c "cd $PROJECT_ROOT && grep -hE '^[A-Z][a-zA-Z]*\\(\\)' tools/lib/*.bash"
  [ "$status" -ne 0 ]
}

@test "bootstrap.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}
