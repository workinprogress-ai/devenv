#!/usr/bin/env bats
# Tests for scripts/pr-complete-merge.sh

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
    echo "123"
    ;;
  "pr view")
    cat <<'JSON'
{"title":"Test PR","body":"Implements change #456","isDraft":false,"state":"OPEN"}
JSON
    ;;
  "pr merge")
    echo "merged"
    ;;
  "repo view")
    cat <<'JSON'
{"owner":{"login":"mock-owner"},"name":"mock-repo"}
JSON
    ;;
  *)
    echo "gh mock received unexpected command: $cmd $sub (all args: $@)" >&2
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

@test "pr-complete-merge enforces Conventional Commits" {
  run "$PROJECT_ROOT/tools/scripts/pr-complete-merge.sh" 456 "invalid message" "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ Conventional ]]
}

@test "pr-complete-merge completes PR with mock gh" {
  run "$PROJECT_ROOT/tools/scripts/pr-complete-merge.sh" 456 "feat: ready" "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Pull request 123 completed successfully" ]]
}
