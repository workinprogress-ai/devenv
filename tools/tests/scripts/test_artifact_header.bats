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

# The picker advertises what artifact_file_upsertable accepts, and the upsert
# then rejects any issue_number that is not all digits (exit 2) — so a value
# like "abc" used to be offered and then fail after selection.

make_header_file() {
  # make_header_file NAME DOC_ID ISSUE_NUMBER_LINE
  printf '<!-- DEVENV_ARTIFACT_V1\ndoc_id: %s\n%s\n-->\n\nbody\n' "$2" "$3" > "$TEST_TEMP_DIR/$1"
}

@test "a non-numeric issue_number is not upsertable, even when the doc_id names an issue" {
  make_header_file bad.md 'dv1:org/repo:issue-42:plan:x' 'issue_number: abc'
  run artifact_header_status "$TEST_TEMP_DIR/bad.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"issue_number"* ]]
  [[ "$output" == *"'abc'"* ]]
  [[ "$output" == *"not a number"* ]]
}

@test "numeric-looking but malformed issue_number values are rejected" {
  local value
  for value in '42x' '-3' '4 2' '#42' '4.2' '0x2A'; do
    make_header_file odd.md 'dv1:org/repo:local:plan:x' "issue_number: $value"
    run artifact_header_status "$TEST_TEMP_DIR/odd.md"
    [ "$status" -eq 1 ] || { echo "accepted: '$value'"; return 1; }
  done
}

@test "a malformed issue_number is rejected even with no doc_id fallback" {
  make_header_file bad2.md 'dv1:org/repo:local:plan:x' 'issue_number: twelve'
  run artifact_header_status "$TEST_TEMP_DIR/bad2.md"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not a number"* ]]
}

@test "digits-only issue_number values still resolve (including a leading zero)" {
  local value
  for value in '42' '7' '007'; do
    make_header_file ok.md 'dv1:org/repo:local:plan:x' "issue_number: $value"
    run artifact_header_status "$TEST_TEMP_DIR/ok.md"
    [ "$status" -eq 0 ] || { echo "rejected: '$value'"; return 1; }
    [[ "$output" == *"upsertable"* ]]
  done
}

@test "issue_number none still counts as absent and falls back to the doc_id" {
  make_header_file none.md 'dv1:org/repo:issue-42:plan:x' 'issue_number: none'
  run artifact_header_status "$TEST_TEMP_DIR/none.md"
  [ "$status" -eq 0 ]
}
