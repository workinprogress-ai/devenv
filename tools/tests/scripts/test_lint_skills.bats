#!/usr/bin/env bats
# Tests for lint-skills.sh — each defect class must FAIL the checker (negative
# controls); a golden tree must PASS.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  WORK_DIR=$(mktemp -d)
  TREE="$WORK_DIR/copilot/skills"
  SCRIPT="$DEVENV_ROOT/tools/scripts/lint-skills.sh"
  # Golden minimal tree: two skills, registry, catalog.
  mkdir -p "$TREE/devenv-alpha" "$TREE/devenv-beta" "$TREE/devenv-help/references" "$TREE/common/references"
  write_skill() { # $1=name
    printf -- '---\nname: %s\ndescription: x\nuser-invocable: true\n---\n# %s\n' "$1" "$1" > "$TREE/$1/SKILL.md"
  }
  write_skill devenv-alpha; write_skill devenv-beta; write_skill devenv-help
  printf '| `/devenv-alpha` | x | x | x |\n| `/devenv-beta` | x | x | x |\n| `/devenv-help` | x | x | x |\n' > "$TREE/devenv-help/references/skills-registry.md"
  printf 'devenv-alpha devenv-beta devenv-help\n' > "$TREE/common/references/skills-catalog.md"
}

teardown() { rm -rf "$WORK_DIR"; }

@test "golden tree passes" {
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 0 ]
}

@test "SK001: missing description fails" {
  printf -- '---\nname: devenv-alpha\nuser-invocable: true\n---\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK001"* ]]
}

@test "SK002: name mismatch fails" {
  printf -- '---\nname: devenv-something-else\ndescription: x\nuser-invocable: true\n---\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK002"* ]]
}

@test "SK003: over-length description fails" {
  local long; long=$(printf 'y%.0s' $(seq 1 2100))
  printf -- '---\nname: devenv-alpha\ndescription: %s\nuser-invocable: true\n---\n' "$long" > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK003"* ]]
}

@test "SK004: registry ghost (reference with no directory) fails" {
  printf '| `/devenv-ghost` | x | x | x |\n' >> "$TREE/devenv-help/references/skills-registry.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK004"*"ghost"* ]]
}

@test "SK004: orphan skill directory (not in registry) fails" {
  mkdir -p "$TREE/devenv-orphan"
  printf -- '---\nname: devenv-orphan\ndescription: x\nuser-invocable: true\n---\n' > "$TREE/devenv-orphan/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK004"*"orphan"* ]]
}

@test "SK005: broken relative link fails" {
  printf -- '---\nname: devenv-alpha\ndescription: x\nuser-invocable: true\n---\n# A\n[bad](../devenv-nonexistent/SKILL.md)\n' > "$TREE/devenv-alpha/SKILL.md"
  run bash "$SCRIPT" "$TREE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SK005"* ]]
}
