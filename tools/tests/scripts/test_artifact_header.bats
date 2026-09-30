#!/usr/bin/env bats
# Tests for lib/artifact-header.bash — artifact_file_upsertable

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
}

teardown() {
  test_helper_teardown
}

artifact_header_status() {
  bash -c 'source "$1"; artifact_file_upsertable "$2"' _ \
    "$PROJECT_ROOT/tools/lib/artifact-header.bash" "$1"
}

@test "artifact-header.bash has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/lib/artifact-header.bash"
  [ "$status" -eq 0 ]
}

@test "headered plan file is upsertable" {
  printf '<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:plan:x\nissue_number: 42\n-->\n\nbody\n' > "$TEST_TEMP_DIR/plan.md"

  run artifact_header_status "$TEST_TEMP_DIR/plan.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"upsertable"* ]]
}

@test "doc_id containing issue-42 satisfies resolution without issue_number line" {
  printf '<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:spike:x\n-->\n\nbody\n' > "$TEST_TEMP_DIR/spike.md"

  run artifact_header_status "$TEST_TEMP_DIR/spike.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"upsertable"* ]]
}

@test "headerless research notes are not upsertable" {
  printf '# Spike\n\nplain research notes\n' > "$TEST_TEMP_DIR/research.md"

  run artifact_header_status "$TEST_TEMP_DIR/research.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no DEVENV_ARTIFACT_V1 header"* ]]
}

@test "header with doc_id but no resolvable issue is not upsertable" {
  printf '<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:local:plan:x\n-->\n\nbody\n' > "$TEST_TEMP_DIR/local-plan.md"

  run artifact_header_status "$TEST_TEMP_DIR/local-plan.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no resolvable issue number"* ]]
}

@test "issue_number: none is treated as absent" {
  printf '<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:local:plan:x\nissue_number: none\n-->\n\nbody\n' > "$TEST_TEMP_DIR/none-plan.md"

  run artifact_header_status "$TEST_TEMP_DIR/none-plan.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no resolvable issue number"* ]]
}
