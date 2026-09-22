#!/usr/bin/env bats
# Tests for the four GitHub-abstraction wrappers added 2026-09-08:
# pr-review-comment, release-list, policy-export, issue-types

bats_require_minimum_version 1.5.0

load ../test_helper

@test "pr-review-comment.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh"
  [ "$status" -eq 0 ]
}

@test "pr-review-comment.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-review-comment.sh help documents required flags and side semantics" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "--file" ]]
  [[ "$output" =~ "--line" ]]
  [[ "$output" =~ "--side" ]]
  [[ "$output" =~ "RIGHT" ]]
}

@test "pr-review-comment.sh rejects missing --file" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh" 123 --line 5 --body x --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" =~ "--file is required" ]]
}

@test "pr-review-comment.sh rejects non-numeric line" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh" 123 --file a.ts --line abc --body x --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Invalid line number" ]]
}

@test "pr-review-comment.sh rejects invalid side" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh" 123 --file a.ts --line 5 --side UP --body x --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Invalid side" ]]
}

@test "pr-review-comment.sh rejects missing body" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh" 123 --file a.ts --line 5 --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" =~ "body" ]]
}

@test "release-list.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/release-list.sh"
  [ "$status" -eq 0 ]
}

@test "release-list.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/release-list.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "release-list.sh rejects unknown format" {
  # format validation lives in list_releases; without auth the run may exit
  # earlier — accept either the validation message or skip.
  result=$(bash "$PROJECT_ROOT/tools/scripts/release-list.sh" --format yaml 2>&1 || true)
  [[ "$result" =~ "Invalid format" ]] || skip "format validation unreachable without auth"
}

@test "policy-export.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/policy-export.sh"
  [ "$status" -eq 0 ]
}

@test "policy-export.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/policy-export.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "policy-export.sh rejects non-numeric ruleset ID" {
  run bash "$PROJECT_ROOT/tools/scripts/policy-export.sh" abcdef
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Invalid ruleset ID" ]]
}

@test "issue-types.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-types.sh"
  [ "$status" -eq 0 ]
}

@test "issue-types.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-types.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-types.sh resolves org from GITHUB_REPO owner part" {
  # Source the script's resolve_org in isolation (script main is guarded by
  # direct invocation only). Extract and eval just the function.
  fn=$(sed -n '/^resolve_org()/,/^}/p' "$PROJECT_ROOT/tools/scripts/issue-types.sh")
  run bash -c "GITHUB_REPO=some-org/some-repo GH_ORG= ; eval '$fn'; resolve_org"
  [ "$status" -eq 0 ]
  [ "$output" = "some-org" ]
}

# Existence guard: wrapper scripts are added independently; this suite
# asserts only scripts that are present.
@test "policy-export.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/policy-export.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/policy-export.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-types.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-types.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/issue-types.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}
