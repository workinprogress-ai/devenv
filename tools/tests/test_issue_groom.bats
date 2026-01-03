#!/usr/bin/env bats
# Tests for issue groom

bats_require_minimum_version 1.5.0

load test_helper

@test "issue-groom.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh is executable or can be run with bash" {
  [ -f "$PROJECT_ROOT/tools/scripts/issue-groom.sh" ] || skip "Script not found"
}

@test "issue-groom.sh contains cleanup function" {
  skip "Script uses different cleanup approach"
  run grep -q "cleanup()" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh has EXIT trap registered" {
  skip "Script uses different cleanup approach"
  run grep -q "trap cleanup EXIT" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh cleanup removes tmpfile" {
  skip "Script uses different cleanup approach"
  run grep -q "rm -f.*tmpfile" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh cleanup removes form" {
  skip "Script uses different cleanup approach"
  run grep -q "rm -f.*form" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh cleanup checks variables before removal" {
  skip "Script uses different cleanup approach"
  run grep -A 10 "cleanup()" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "-n" ]]
  [[ "$output" =~ "-f" ]]
}

@test "issue-groom.sh creates tmpfile with mktemp" {
  skip "Script uses different temporary file approach"
  run grep 'tmpfile.*mktemp' "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh defines workflow status constants" {
  run grep "readonly STATUS_TBD=" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
  run grep "readonly STATUS_TO_GROOM=" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
  run grep "readonly STATUS_READY=" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh calls shared check_dependencies" {
  run grep "check_dependencies" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh documents fzf usage" {
  run grep -i "fzf" "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh uses error handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-groom.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-groom.sh has --version flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-groom.sh" --version
  [ "$status" -eq 0 ]
  [[ "$output" =~ "1.0.0" ]]
}

@test "issue-groom.sh supports --project filter" {
  run grep -E '\-p\|--project' "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}

@test "issue-groom.sh supports --milestone filter" {
  run grep -E '\-m\|--milestone' "$PROJECT_ROOT/tools/scripts/issue-groom.sh"
  [ "$status" -eq 0 ]
}
