#!/usr/bin/env bats
# Tests for logging framework documentation
#
# The logging documentation lives in the "Logging & error handling" section of
# docs/Tooling-Standards.md — the framework's single home; the standalone
# Logging-Framework.md page was folded in there.

bats_require_minimum_version 1.5.0

load ../test_helper

# Resolve lazily: PROJECT_ROOT is set by test_helper_setup in setup(), which
# runs after this file's top-level code, so LOGGING_DOC cannot be assigned here.
logging_doc() {
  echo "$PROJECT_ROOT/docs/Tooling-Standards.md"
}

@test "Logging framework documentation exists" {
  grep -q "^## Logging & error handling" "$(logging_doc)"
}

@test "Documentation covers log levels" {
  run grep -c "log_debug\|log_info\|log_warn\|log_error" "$(logging_doc)"
  [ "$status" -eq 0 ]
  [ "$output" -gt 5 ]
}

@test "Documentation includes usage guidance" {
  run grep -q "### Logging functions\|### Usage conventions" "$(logging_doc)"
  [ "$status" -eq 0 ]
}

@test "Documentation explains DEBUG environment variable" {
  run grep -q "DEBUG=1\|DEBUG environment" "$(logging_doc)"
  [ "$status" -eq 0 ]
}

@test "Documentation includes code examples" {
  run grep -c '```bash\|```sh' "$(logging_doc)"
  [ "$status" -eq 0 ]
  [ "$output" -gt 2 ]
}

@test "Documentation references error-handling.bash" {
  run grep -q "error-handling" "$(logging_doc)"
  [ "$status" -eq 0 ]
}

@test "Documentation includes best practices or guidelines" {
  run grep -qi "best practice\|guidelines\|when to use\|usage conventions" "$(logging_doc)"
  [ "$status" -eq 0 ]
}

@test "Documentation explains log output streams" {
  run grep -qi "stderr\|stdout" "$(logging_doc)"
  [ "$status" -eq 0 ]
}

@test "Documentation shows how to source the library" {
  run grep -q "source.*error-handling.bash" "$(logging_doc)"
  [ "$status" -eq 0 ]
}

@test "error-handling.bash library exists" {
  [ -f "$PROJECT_ROOT/tools/lib/error-handling.bash" ]
}

@test "error-handling.sh defines log functions" {
  run grep -c "^log_info\|^log_warn\|^log_error\|^log_debug" "$PROJECT_ROOT/tools/lib/error-handling.bash"
  [ "$status" -eq 0 ]
  [ "$output" -gt 2 ]
}
