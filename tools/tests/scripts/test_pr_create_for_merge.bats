#!/usr/bin/env bats
# Tests for scripts/pr-create-for-merge.sh

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

@test "pr-create-for-merge requires --issue or --no-issue" {
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "feat: new feature" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Either --issue <number> or --no-issue must be specified" ]]
}

@test "pr-create-for-merge rejects both --issue and --no-issue" {
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "feat: new feature" --issue 123 --no-issue --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Cannot specify both --issue and --no-issue" ]]
}

@test "pr-create-for-merge validates issue number is numeric" {
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "feat: new feature" --issue abc --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Issue number must be numeric" ]]
}

@test "pr-create-for-merge accepts valid issue number" {
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "feat: new feature" --issue 456 --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "https://github.com/mock-owner/mock-repo/pull/123" ]]
}

@test "pr-create-for-merge accepts --no-issue flag" {
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "fix: minor typo" --no-issue --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "https://github.com/mock-owner/mock-repo/pull/123" ]]
}

@test "pr-create-for-merge enforces Conventional Commits" {
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "invalid message" --issue 123 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Conventional Commits" ]]
}

@test "pr-create-for-merge shows usage with --help" {
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" --help
  [ "$status" -eq 1 ]
  [[ "$output" =~ "Usage:" ]]
  [[ "$output" =~ "--issue" ]]
  [[ "$output" =~ "--no-issue" ]]
}

@test "pr-create-for-merge has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh"
  [ "$status" -eq 0 ]
}

@test "pr-create-for-merge fails on dirty working tree" {
  cd "$REPO_DIR"
  echo "uncommitted change" >> README.md
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "uncommitted or staged changes" ]]
}

@test "pr-create-for-merge rejects review branch" {
  git checkout -b review/test-123 >/dev/null 2>&1
  run "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "cannot be run on a review" ]]
}
