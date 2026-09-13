#!/usr/bin/env bats
# Tests for artifact-clean.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  SCRIPT="$DEVENV_ROOT/tools/scripts/artifact-clean.sh"
  WORK_DIR=$(mktemp -d)
  mkdir -p "$WORK_DIR/repo/.local-artifacts"
  FOLDER="$WORK_DIR/repo/.local-artifacts"
  touch "$FOLDER/tmp1.md" "$FOLDER/tmp2.md" \
        "$FOLDER/session_memory-design.md" \
        "$FOLDER/Plan-issue-33-001.md" "$FOLDER/Roadmap-22.md" \
        "$FOLDER/random-notes.md"
}

teardown() {
  rm -rf "$WORK_DIR"
}

@test "--list reports all four families and deletes nothing" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null -l
  [ "$status" -eq 0 ]
  [[ "$output" == *"[ephemeral] would clean 2"* ]]
  [[ "$output" == *"[session] would clean 1"* ]]
  [[ "$output" == *"[working] would clean 2"* ]]
  [[ "$output" == *"[other] would clean 1"* ]]
  [ -f "$FOLDER/tmp1.md" ]
}

@test "--tmp deletes ephemeral files without confirmation, nothing else" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --tmp
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/tmp1.md" ]
  [ ! -f "$FOLDER/tmp2.md" ]
  [ -f "$FOLDER/session_memory-design.md" ]
  [ -f "$FOLDER/Plan-issue-33-001.md" ]
}

@test "--working -y deletes working copies only" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --working -y
  [ "$status" -eq 0 ]
  [ ! -f "$FOLDER/Plan-issue-33-001.md" ]
  [ ! -f "$FOLDER/Roadmap-22.md" ]
  [ -f "$FOLDER/tmp1.md" ]
  [ -f "$FOLDER/random-notes.md" ]
}

@test "--working without -y and without TTY refuses to delete" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --working
  [ "$status" -eq 0 ]
  [[ "$output" == *"need confirmation"* ]]
  [ -f "$FOLDER/Plan-issue-33-001.md" ]
}

@test "--all -y clears every family including other" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null --all -y
  [ "$status" -eq 0 ]
  [ -z "$(ls -A "$FOLDER")" ]
}

@test "no flags with no TTY defaults to list-only (never prompts, never deletes)" {
  run bash "$SCRIPT" "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"list-only"* ]]
  [ -f "$FOLDER/tmp1.md" ]
  [ -f "$FOLDER/random-notes.md" ]
}

@test "path without an artifact folder exits 2" {
  mkdir -p "$WORK_DIR/plain"
  run bash "$SCRIPT" "$WORK_DIR/plain"
  [ "$status" -eq 2 ]
}

@test "accepts the .local-artifacts folder itself as target" {
  run bash "$SCRIPT" "$FOLDER" -l < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"[ephemeral] would clean 2"* ]]
}

@test "unknown option exits 1" {
  run bash "$SCRIPT" --bogus "$WORK_DIR/repo" < /dev/null
  [ "$status" -eq 1 ]
}

@test "--version prints version" {
  run bash "$SCRIPT" --version < /dev/null
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}
