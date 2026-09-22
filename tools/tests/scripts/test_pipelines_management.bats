#!/usr/bin/env bats
# Tests for pipelines-* (formerly actions-*) management scripts
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
# pipelines-status
# ============================================================================

@test "pipelines-status.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-status.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-status.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-status.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-status.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/pipelines-status.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-status.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/pipelines-status.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# pipelines-list
# ============================================================================

@test "pipelines-list.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-list.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-list.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-list.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-list.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/pipelines-list.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-list.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/pipelines-list.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# pipelines-run
# ============================================================================

@test "pipelines-run.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-run.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-run.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-run.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-run.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/pipelines-run.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-run.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/pipelines-run.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# pipelines-rerun
# ============================================================================

@test "pipelines-rerun.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-rerun.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-rerun.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-rerun.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# pipelines-watch
# ============================================================================

@test "pipelines-watch.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-watch.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-watch.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-watch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-watch.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/pipelines-watch.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-watch.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/pipelines-watch.sh"
  [ "$status" -eq 0 ]
}

# ============================================================================
# pipelines-artifacts
# ============================================================================

@test "pipelines-artifacts.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-artifacts.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-artifacts.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-artifacts.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-artifacts.sh sources error-handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/pipelines-artifacts.sh"
  [ "$status" -eq 0 ]
}

@test "pipelines-artifacts.sh sources github-helpers library" {
  run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/pipelines-artifacts.sh"
  [ "$status" -eq 0 ]
}




# ============================================================================
# pipelines-* family — syntax and --help contract for every member.
# ============================================================================

@test "pipelines-status.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-status.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-status.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-list.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-list.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-list.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-run.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-run.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-run.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-rerun.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-watch.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-watch.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-watch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pipelines-artifacts.sh exists with valid syntax and --help" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pipelines-artifacts.sh"
  [ "$status" -eq 0 ]
  run bash "$PROJECT_ROOT/tools/scripts/pipelines-artifacts.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}
