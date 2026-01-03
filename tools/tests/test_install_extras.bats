#!/usr/bin/env bats
# Tests for install-extras.sh

bats_require_minimum_version 1.5.0

load test_helper

@test "install-extras.sh exists" {
  [ -f "$PROJECT_ROOT/tools/scripts/install-extras.sh" ]
}

@test "install-extras.sh is executable" {
  [ -x "$PROJECT_ROOT/tools/scripts/install-extras.sh" ]
}

@test "install-extras.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh has pipefail enabled" {
  run grep "set -o pipefail" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh defines cleanup function" {
  run grep "^cleanup()" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh registers EXIT trap" {
  run grep "trap cleanup EXIT" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh cleanup removes MENU_TMP" {
  run bash -c "grep -A 3 '^cleanup()' $PROJECT_ROOT/tools/scripts/install-extras.sh | grep -q 'rm -f.*MENU_TMP'"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh cleanup checks if MENU_TMP exists" {
  run bash -c "grep -A 3 '^cleanup()' $PROJECT_ROOT/tools/scripts/install-extras.sh | grep -q 'MENU_TMP'"
  [ "$status" -eq 0 ]
  run bash -c "grep -A 3 '^cleanup()' $PROJECT_ROOT/tools/scripts/install-extras.sh | grep -q 'rm -f'"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh creates MENU_TMP with mktemp" {
  run grep 'MENU_TMP.*mktemp' "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh requires fzf" {
  run grep "command -v fzf" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh supports --multi flag" {
  run grep -E '(-m|--multi)' "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh supports --dir flag" {
  run grep -- '--dir' "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh supports filter argument" {
  run grep 'FILTER=' "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh auto-runs single match" {
  run bash -c "grep -A 10 'If exactly one match' $PROJECT_ROOT/tools/scripts/install-extras.sh | grep -q 'exit \$?'"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh uses fzf for selection" {
  run grep 'fzf.*FZF_OPTS' "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh prefers bat for preview if available" {
  run grep "command -v bat" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh looks for .sh files" {
  run grep "\-name '\*\.sh'" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh looks for executable files" {
  run grep "\-perm.*\+x" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}
