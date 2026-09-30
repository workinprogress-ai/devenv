#!/usr/bin/env bats
# Tests for scripts/pr-create.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  export REPO_DIR="$TEST_TEMP_DIR/pr-repo"
  mkdir -p "$REPO_DIR"
  cd "$REPO_DIR"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > README.md
  git add README.md
  git commit -q -m "chore: initial"
  git branch -M main
  # Add origin remote and create remote tracking branch references
  git remote add origin "https://github.com/mock-owner/mock-repo.git"
  git update-ref refs/remotes/origin/main HEAD
  git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
  git checkout -b feature/test >/dev/null 2>&1

  # Mock gh CLI
  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
cmd="$1"; shift

# Handle -R flag if present (skip repo specification)
if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then
  shift  # skip -R
  shift  # skip org/repo
fi

sub="$1"; shift || true
case "$cmd $sub" in
  "pr list")
    echo ""  # No existing PRs
    ;;
  "pr create")
    # Echo back the arguments for verification
    echo "https://github.com/mock-owner/mock-repo/pull/123"
    ;;
  "repo view")
    cat <<'JSON'
{"owner":{"login":"mock-owner"},"name":"mock-repo"}
JSON
    ;;
  *)
    echo "gh mock received unexpected command: $cmd $sub" >&2
    exit 1
    ;;
 esac
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"

  cd "$REPO_DIR"
}

teardown() {
  cd "$PROJECT_ROOT"
  test_helper_teardown
}

@test "pr-create requires --issue or --no-issue" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: new feature" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Either --issue <number> or --no-issue must be specified" ]]
}

@test "pr-create rejects both --issue and --no-issue" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: new feature" --issue 123 --no-issue --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Cannot specify both --issue and --no-issue" ]]
}

@test "pr-create validates issue number is numeric" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: new feature" --issue abc --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Issue number must be numeric" ]]
}

@test "pr-create accepts valid issue number" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: new feature" --issue 456 --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "https://github.com/mock-owner/mock-repo/pull/123" ]]
}

@test "pr-create accepts --no-issue flag" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "fix: minor typo" --no-issue --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "https://github.com/mock-owner/mock-repo/pull/123" ]]
}

@test "pr-create enforces Conventional Commits" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "invalid message" --issue 123 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Conventional Commits" ]]
}

@test "pr-create shows usage with --help" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" --help
  [ "$status" -eq 1 ]
  [[ "$output" =~ "Usage:" ]]
  [[ "$output" =~ "--issue" ]]
  [[ "$output" =~ "--no-issue" ]]
}

@test "pr-create has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-create.sh"
  [ "$status" -eq 0 ]
}

@test "pr-create fails on dirty working tree" {
  cd "$REPO_DIR"
  echo "uncommitted change" >> README.md
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "uncommitted or staged changes" ]]
}

@test "pr-create fails when a plan file sits in the repo root" {
  cd "$REPO_DIR"
  echo "plan content" > Plan-issue-789-001.md
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Implementation plan file(s) found in the repo root" ]]
}

@test "pr-create warns but proceeds when a plan file is only in .local-artifacts" {
  cd "$REPO_DIR"
  mkdir -p .local-artifacts
  echo "working copy" > .local-artifacts/Plan-issue-789-001.md
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [[ "$output" =~ "Warning: Implementation plan file(s) found in .local-artifacts/" ]]
  [[ "$output" =~ "mock-owner/mock-repo/pull/123" ]]
}

@test "pr-create root plan file blocks even when .local-artifacts also has one" {
  cd "$REPO_DIR"
  mkdir -p .local-artifacts
  echo "working copy" > .local-artifacts/Plan-issue-789-001.md
  echo "plan content" > Plan-issue-789-002.md
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Implementation plan file(s) found in the repo root" ]]
}

@test "pr-create rejects review branch" {
  git checkout -b review/test-123 >/dev/null 2>&1
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "cannot be run on a review" ]]
}

@test "pr-create rejects a branch whose range carries WIP commits" {
  git checkout -b feature/wip-range >/dev/null 2>&1
  echo "scratch" >> README.md
  git add README.md
  git commit -q -m "WIP: mid-work save"
  echo "done" >> README.md
  git add README.md
  git commit -q -m "feat: finished change"
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "WIP: commits present in PR creation range" ]]
  [[ "$output" =~ "WIP: mid-work save" ]]
}

@test "pr-create accepts a clean range without WIP commits" {
  git checkout -b feature/clean-range >/dev/null 2>&1
  echo "clean" >> README.md
  git add README.md
  git commit -q -m "feat: clean change"
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "mock-owner/mock-repo/pull/123" ]]
}

@test "pr-create --at creates a merge branch and opens the PR from it" {
  git checkout -b feature/partial >/dev/null 2>&1
  echo "one" >> README.md
  git add README.md
  git commit -q -m "feat: ready prefix"
  local ready_hash
  ready_hash="$(git rev-parse --short HEAD)"
  echo "two" >> README.md
  git add README.md
  git commit -q -m "WIP: continues"

  # --at picks the ready prefix; the merge branch skips the WIP tip, so the
  # feature-branch WIP never enters the PR.
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: ready prefix" --issue 789 --at "$ready_hash" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "mock-owner/mock-repo/pull/123" ]]
  git show-ref --verify --quiet "refs/heads/merge/${ready_hash}-feature/partial"
  # Success path returns the user to the feature branch: the merge
  # branch is a PR vehicle, not a place to keep working.
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feature/partial" ]
}

@test "pr-create --at rejects an unresolvable commit" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --at "no-such-hash" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "does not resolve to a commit" ]]
}

@test "pr-create --at pick lists commits non-interactively without consuming input" {
  git checkout -b feature/pick >/dev/null 2>&1
  echo "x" >> README.md
  git add README.md
  git commit -q -m "feat: pickable"
  # </dev/null severs stdin so the script cannot see a TTY — it must fall
  # back to the numbered list and exit rather than launching fzf.
  run bash -c '"$0" "$@" </dev/null' "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --at pick --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Non-interactive mode" ]]
  [[ "$output" =~ "feat: pickable" ]]
}
