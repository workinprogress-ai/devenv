#!/usr/bin/env bats
# Tests for actions-* management scripts
#
# GH CLI Actions API field inventory (from 'gh run list --json'):
#   attempt, conclusion, createdAt, databaseId, displayTitle, event,
#   headBranch, headSha, name, number, startedAt, status, updatedAt, url,
#   workflowDatabaseId, workflowName
#
# 'gh run list --status' values:
#   queued, completed, in_progress, requested, waiting, pending,
#   action_required, cancelled, failure, neutral, skipped, stale,
#   startup_failure, success, timed_out
#
# 'gh workflow list --json' fields: id, name, path, state
# 'gh workflow run' flags: -F/--field (inputs), -r/--ref
# 'gh run rerun' flags: --failed (failed jobs only), -d (debug)
# 'gh run watch' flags: --exit-status, --compact, -i/--interval
# 'gh run download' flags: -D/--dir, -n/--name, -p/--pattern
# 'gh repo list ORG' pagination: --limit up to 1000

bats_require_minimum_version 1.5.0

load ../test_helper

# ============================================================================
# actions-status
# ============================================================================

@test "actions-status.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/actions-status.sh"
  [ "$status" -eq 0 ]
}

@test "actions-status.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/actions-status.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "actions-status.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/actions-status.sh"
  [ "$status" -eq 0 ]
}

@test "actions-status.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/actions-status.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# actions-list
# ============================================================================

@test "actions-list.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/actions-list.sh"
  [ "$status" -eq 0 ]
}

@test "actions-list.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/actions-list.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "actions-list.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/actions-list.sh"
  [ "$status" -eq 0 ]
}

@test "actions-list.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/actions-list.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# actions-run
# ============================================================================

@test "actions-run.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/actions-run.sh"
  [ "$status" -eq 0 ]
}

@test "actions-run.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/actions-run.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "actions-run.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/actions-run.sh"
  [ "$status" -eq 0 ]
}

@test "actions-run.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/actions-run.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# actions-rerun
# ============================================================================

@test "actions-rerun.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/actions-rerun.sh"
  [ "$status" -eq 0 ]
}

@test "actions-rerun.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/actions-rerun.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "actions-rerun.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/actions-rerun.sh"
  [ "$status" -eq 0 ]
}

@test "actions-rerun.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/actions-rerun.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# actions-watch
# ============================================================================

@test "actions-watch.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/actions-watch.sh"
  [ "$status" -eq 0 ]
}

@test "actions-watch.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/actions-watch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "actions-watch.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/actions-watch.sh"
  [ "$status" -eq 0 ]
}

@test "actions-watch.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/actions-watch.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# actions-artifacts
# ============================================================================

@test "actions-artifacts.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/actions-artifacts.sh"
  [ "$status" -eq 0 ]
}

@test "actions-artifacts.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/actions-artifacts.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "actions-artifacts.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/actions-artifacts.sh"
  [ "$status" -eq 0 ]
}

@test "actions-artifacts.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/actions-artifacts.sh"
  [ "$status" -eq 0 ]
}


