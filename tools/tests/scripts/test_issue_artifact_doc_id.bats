#!/usr/bin/env bats
# Tests for scripts/issue-artifact-doc-id.sh

bats_require_minimum_version 1.5.0

load ../test_helper

@test "issue-artifact-doc-id.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-artifact-doc-id.sh"
  [ "$status" -eq 0 ]
}

@test "issue-artifact-doc-id.sh generates expected doc_id from slug" {
  run "$PROJECT_ROOT/tools/scripts/issue-artifact-doc-id.sh" \
    --issue 123 \
    --artifact-type spike \
    --slug "Retry Strategy" \
    --repo workinprogress-ai/devenv

  [ "$status" -eq 0 ]
  [ "$output" = "dv1:workinprogress-ai-devenv:issue-123:spike:retry-strategy" ]
}

@test "issue-artifact-doc-id.sh generates expected doc_id from source file" {
  run "$PROJECT_ROOT/tools/scripts/issue-artifact-doc-id.sh" \
    --issue 77 \
    --artifact-type redesign \
    --source-file Redesign--003-Auth-Flow.md \
    --repo workinprogress-ai/devenv

  [ "$status" -eq 0 ]
  [ "$output" = "dv1:workinprogress-ai-devenv:issue-77:redesign:redesign-003-auth-flow" ]
}

@test "issue-artifact-doc-id.sh fails when both slug and source-file are passed" {
  run "$PROJECT_ROOT/tools/scripts/issue-artifact-doc-id.sh" \
    --issue 123 \
    --artifact-type spike \
    --slug "one" \
    --source-file two.md \
    --repo workinprogress-ai/devenv

  [ "$status" -eq 2 ]
  [[ "$output" =~ "Only one of --slug or --source-file" ]]
}

@test "issue-artifact-doc-id.sh fails on invalid artifact type" {
  run "$PROJECT_ROOT/tools/scripts/issue-artifact-doc-id.sh" \
    --issue 123 \
    --artifact-type invalid \
    --slug "thing" \
    --repo workinprogress-ai/devenv

  [ "$status" -eq 2 ]
}
