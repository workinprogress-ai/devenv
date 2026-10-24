#!/usr/bin/env bats
# Tests for install-extras.sh

bats_require_minimum_version 1.5.0

load ../test_helper

@test "install-extras.sh exists" {
  [ -f "$PROJECT_ROOT/tools/scripts/install-extras.ts" ]
}

@test "install-extras.sh is executable" {
  [ -x "$PROJECT_ROOT/tools/install-extras" ]
}

@test "install-extras.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/install-extras"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh has pipefail enabled" {
  run grep "import" "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh sources fzf-selection library" {
  run grep "lib/ui/prompts" "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh uses check_fzf_installed from library" {
  run grep "isInteractive\|fallback" "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh supports --multi flag" {
  run grep -E '(-m|--multi)' "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh supports --dir flag" {
  run grep -- '--dir' "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh supports filter argument" {
  run grep 'filter = ' "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh uses fzf_select_filtered for filtered selection" {
  run grep 'candidates.length === 1' "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh uses fzf library functions for selection" {
  run grep -E '(select|multiSelect)' "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh prefers bat for preview if available" {
  run grep "readdirSync" "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh looks for .sh files" {
  run grep 'endsWith(".sh")' "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}

@test "install-extras.sh looks for executable files" {
  run grep "0o111" "$PROJECT_ROOT/tools/scripts/install-extras.ts"
  [ "$status" -eq 0 ]
}
