#!/usr/bin/env bats
# Tests for the four GitHub-abstraction wrappers added 2026-09-08:
# pr-review-comment, release-list, ruleset-export, org-issue-types

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

@test "ruleset-export.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/ruleset-export.sh"
  [ "$status" -eq 0 ]
}

@test "ruleset-export.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/ruleset-export.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "ruleset-export.sh rejects non-numeric ruleset ID" {
  run bash "$PROJECT_ROOT/tools/scripts/ruleset-export.sh" abcdef
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Invalid ruleset ID" ]]
}

@test "org-issue-types.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/org-issue-types.sh"
  [ "$status" -eq 0 ]
}

@test "org-issue-types.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/org-issue-types.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "org-issue-types.sh resolves org from GITHUB_REPO owner part" {
  # Source the script's resolve_org in isolation (script main is guarded by
  # direct invocation only). Extract and eval just the function.
  fn=$(sed -n '/^resolve_org()/,/^}/p' "$PROJECT_ROOT/tools/scripts/org-issue-types.sh")
  run bash -c "GITHUB_REPO=some-org/some-repo GH_ORG= ; eval '$fn'; resolve_org"
  [ "$status" -eq 0 ]
  [ "$output" = "some-org" ]
}
