#!/usr/bin/env bats
# Tests for logging framework documentation

bats_require_minimum_version 1.5.0

load ../test_helper

@test "Logging framework documentation exists" {
  [ -f "$PROJECT_ROOT/docs/Logging-Framework.md" ]
}

@test "Documentation covers log levels" {
  run grep -c "log_debug\|log_info\|log_warn\|log_error" "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
  [ "$output" -gt 5 ]
}

@test "Documentation includes usage examples" {
  run grep -q "## Usage\|## Examples" "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
}

@test "Documentation explains DEBUG environment variable" {
  run grep -q "DEBUG=1\|DEBUG environment" "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
}

@test "Documentation includes code examples" {
  run grep -c '```bash\|```sh' "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
  [ "$output" -gt 2 ]
}

@test "Documentation references error-handling.sh" {
  run grep -q "lib/error-handling.bash\|error-handling" "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
}

@test "Documentation includes best practices or guidelines" {
  run grep -qi "best practice\|guidelines\|when to use" "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
}

@test "Documentation explains log output streams" {
  run grep -qi "stderr\|stdout" "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
}

@test "Documentation shows how to source the library" {
  run grep -q "source.*error-handling.bash" "$PROJECT_ROOT/docs/Logging-Framework.md"
  [ "$status" -eq 0 ]
}

@test "error-handling.sh library exists" {
  [ -f "$PROJECT_ROOT/tools/lib/error-handling.bash" ]
}

@test "error-handling.sh defines log functions" {
  run grep -c "^log_info\|^log_warn\|^log_error\|^log_debug" "$PROJECT_ROOT/tools/lib/error-handling.bash"
  [ "$status" -eq 0 ]
  [ "$output" -gt 2 ]
}
