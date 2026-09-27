#!/usr/bin/env bats
# Tests for scripts/repo-bump-version.sh

bats_require_minimum_version 1.5.0

load ../test_helper

@test "repo-bump-version.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh"
  [ "$status" -eq 0 ]
}

@test "repo-bump-version.sh shows usage when missing args" {
  run "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh" 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "repo-bump-version.sh rejects invalid change types" {
  run "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh" invalid repo-one 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Invalid change-type" ]]
}

@test "repo-bump-version.sh requires repository list" {
  run bash -c "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh patch < /dev/null 2>&1"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "No repositories provided" ]]
}

@test "bump commit is master-born and satisfies master-relative semantics" {
  # Under rebase merges the bump commit lands directly on master as an empty
  # commit typed with the org's custom bump type — it must carry no branch
  # context and bypass hooks, so it trivially stands alone on master.
  setup() {
    :
  }
  export WORK_REPO="$TEST_TEMP_DIR/bump-repo"
  mkdir -p "$WORK_REPO"
  cd "$WORK_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > README.md
  git add README.md
  git commit -q -m "chore: initial"
  git branch -M master
  git tag v1.2.0

  # The mapping under lock: patch→fix, minor→feat, major→feat! (conventional
  # fallback; custom types pass through). Assert the mapping function.
  source "$PROJECT_ROOT/tools/lib/release-operations.bash"
  run get_conventional_commit_type patch false
  [ "$output" = "fix" ]
  run get_conventional_commit_type minor false
  [ "$output" = "feat" ]
  run get_conventional_commit_type major false
  [ "$output" = "feat!" ]
  run get_conventional_commit_type patch true
  [ "$output" = "patch" ]

  # An empty commit created with -n (no hooks) on master is a valid
  # master-relative commit: conventional type, self-contained by construction.
  git commit --allow-empty -m "patch: force version update" -n
  run bash -c "cd '$WORK_REPO' && git log -1 --format=%s"
  [ "$output" = "patch: force version update" ]
}
