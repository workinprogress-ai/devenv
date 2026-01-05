#!/usr/bin/env bats
# Tests for install-extras.sh

bats_require_minimum_version 1.5.0

load ../test_helper

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

@test "install-extras.sh sources fzf-selection library" {
  run grep "source.*fzf-selection.bash" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh uses check_fzf_installed from library" {
  run grep "check_fzf_installed" "$PROJECT_ROOT/tools/scripts/install-extras.sh"
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

@test "install-extras.sh uses fzf_select_filtered for filtered selection" {
  run grep 'fzf_select_filtered' "$PROJECT_ROOT/tools/scripts/install-extras.sh"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh uses fzf library functions for selection" {
  run grep -E '(fzf_select_single|fzf_select_multi)' "$PROJECT_ROOT/tools/scripts/install-extras.sh"
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
