#!/usr/bin/env bats
# Tests for scripts/pr-merge.sh
#
# Locks the wrapper's merge behavior: the rebase default, --method
# validation, squash-only Conventional Commits enforcement on the title,
# draft refusal ordering, and the WIP/breaking-marker merge gates.

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
  git remote add origin "https://github.com/mock-owner/mock-repo.git"
  git update-ref refs/remotes/origin/main HEAD
  git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
  git checkout -b feature/test >/dev/null 2>&1

  # Mock gh CLI. All invocations append their merge-method argument to
  # MERGE_CALLS so tests can assert which method the wrapper actually
  # sent, which is the observable contract of the flip.
  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
cmd="$1"; shift

if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then
  shift
  shift
fi

sub="$1"; shift || true
case "$cmd $sub" in
  "pr list")
    echo "123"
    ;;
  "pr view")
    cat <<'JSON'
{"title":"feat: test change","body":"Implements change #456","isDraft":false,"state":"OPEN"}
JSON
    ;;
  "pr merge")
    # Record the method flag for the caller's assertions
    for arg in "$@"; do
      case "$arg" in
        --squash|--merge|--rebase)
          echo "$arg" >> "${TEST_TEMP_DIR}/merge-calls.log"
          ;;
      esac
    done
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
  rm -f "$TEST_TEMP_DIR/merge-calls.log"

  cd "$REPO_DIR"
}

teardown() {
  cd "$PROJECT_ROOT"
  test_helper_teardown
}

@test "pr-merge defaults to rebase merge" {
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "merged successfully (rebase)" ]]
  grep -q -- "--rebase" "$TEST_TEMP_DIR/merge-calls.log"
}

@test "pr-merge accepts --method rebase" {
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --method rebase --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "merged successfully (rebase)" ]]
  grep -q -- "--rebase" "$TEST_TEMP_DIR/merge-calls.log"
}

@test "pr-merge accepts --method squash" {
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --method squash --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "merged successfully (squash)" ]]
  grep -q -- "--squash" "$TEST_TEMP_DIR/merge-calls.log"
}

@test "pr-merge accepts --method merge" {
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --method merge --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "merged successfully (merge)" ]]
  grep -q -- "--merge" "$TEST_TEMP_DIR/merge-calls.log"
}

@test "pr-merge rejects invalid merge method" {
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --method bogus --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Invalid merge method" ]]
}

@test "pr-merge enforces Conventional Commits on squash merges only" {
  # Non-conventional title blocks a squash…
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" "invalid message" --method squash --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Squash merge commit message must follow Conventional Commits" ]]
  # …but passes under rebase and merge, where individual commits control versioning
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" "invalid message" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "merged successfully" ]]
}

@test "pr-merge refuses draft PRs before title validation" {
  # The mock's pr view reports a draft via state; a draft refusal must win
  # over any message-shape complaint (the PR can't merge either way).
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
cmd="$1"; shift
if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then shift; shift; fi
sub="$1"; shift || true
case "$cmd $sub" in
  "pr list") echo "123" ;;
  "pr view")
    printf '{"title":"not conventional","body":"","isDraft":true,"state":"OPEN"}' ;;
  "pr merge") echo "merged" ;;
  "repo view")
    printf '{"owner":{"login":"mock-owner"},"name":"mock-repo"}' ;;
  *) echo "unexpected: $cmd $sub" >&2; exit 1 ;;
esac
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "is a draft" ]]
  ! [[ "$output" =~ "Conventional Commits" ]]
}

@test "pr-merge uses PR title when no message is given" {
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Using PR title as commit message" ]]
}

@test "pr-merge has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-merge.sh"
  [ "$status" -eq 0 ]
}

@test "pr-merge rejects a merge range carrying WIP commits" {
  cd "$REPO_DIR"
  git checkout -q -B feature/wip-merge main >/dev/null 2>&1
  echo "w" >> README.md
  git add README.md
  git commit -q -m "WIP: buried save"
  echo "d" >> README.md
  git add README.md
  git commit -q -m "feat: completed change"
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "WIP: commits present" ]]
  [[ "$output" =~ "WIP: buried save" ]]
}

@test "wip_range_scan catches WIP subjects at long short-hash lengths" {
  # Git auto-scales short-hash length with repo size (core.abbrev). The scan
  # must key on the subject, never on a hash-relative offset, or the gate
  # silently fails open in large repos.
  source "$PROJECT_ROOT/tools/lib/git-operations.bash"
  local scan_repo="$TEST_TEMP_DIR/scan-repo"
  mkdir -p "$scan_repo"
  git -C "$scan_repo" init -q
  git -C "$scan_repo" config user.email "test@example.com"
  git -C "$scan_repo" config user.name "Test User"
  git -C "$scan_repo" config core.abbrev 12
  echo "a" > "$scan_repo/f"
  git -C "$scan_repo" add f
  git -C "$scan_repo" commit -q -m "chore: base"
  echo "b" > "$scan_repo/f"
  git -C "$scan_repo" add f
  git -C "$scan_repo" commit -q -m "WIP: mid work"

  local hash_len
  hash_len=$(git -C "$scan_repo" rev-parse --short HEAD | wc -c)
  [ "$hash_len" -ge 9 ]  # 12 chars + newline: prove the fixture really is long-hash

  # wip_range_scan operates on the process CWD (like git itself), so run it
  # from inside the fixture.
  cd "$scan_repo"
  run wip_range_scan "HEAD~1..HEAD"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "WIP: mid work" ]]

  # Default abbrev too: the subject anchor is length-independent
  git -C "$scan_repo" config --unset core.abbrev
  run wip_range_scan "HEAD~1..HEAD"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "WIP: mid work" ]]

  # Clean range passes
  git -C "$scan_repo" checkout -q -b clean
  echo "c" > "$scan_repo/f"
  git -C "$scan_repo" add f
  git -C "$scan_repo" commit -q -m "feat: ok"
  run wip_range_scan "@{u}..clean" 2>/dev/null || run wip_range_scan "HEAD~1..clean"
  [ "$status" -eq 0 ]
}

@test "pr-merge rejects WIP even in a long-hash repo" {
  cd "$REPO_DIR"
  git config core.abbrev 12
  git checkout -q -B feature/wip-long main >/dev/null 2>&1
  echo "w" >> README.md
  git add README.md
  git commit -q -m "WIP: long-hash save"
  echo "d" >> README.md
  git add README.md
  git commit -q -m "feat: completed change"
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "WIP: commits present" ]]
  [[ "$output" =~ "WIP: long-hash save" ]]
  git config --unset core.abbrev
}

@test "pr-merge warns on breaking markers in the merge range" {
  cd "$REPO_DIR"
  git checkout -q -B feature/breaking main >/dev/null 2>&1
  git commit -q --allow-empty -m "refactor!: restructured API"
  run "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Breaking marker in range" ]]
}

@test "pr-merge passes --delete-branch by default and omits it with --keep-branch" {
    # The verb receives the flag only when deletion is wanted (default);
    # --keep-branch suppresses it. Providers map the flag to their own
    # completion semantics (azure: deleteSourceBranch).
    skip "merge_pr flag-shape asserted at the contract level (see test_provider_contract_verbs)"
}

@test "pr-merge --help states the real default method (rebase), not a policy lookup" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-merge.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"rebase"* ]]
  [[ "$output" == *"default"* ]]
  [[ "$output" != *"policy default"* ]]
}

@test "pr-merge header documents the rebase default and defers options to --help" {
  header="$(sed -n '1,60p' "$PROJECT_ROOT/tools/scripts/pr-merge.sh")"
  [[ "$header" == *"rebase"* ]]
  [[ "$header" != *"org/fork"* ]]
  [[ "$header" == *"pr-merge --help"* ]]
  # single source: the option list lives in usage(), not duplicated in the header
  [[ "$header" != *"--keep-branch"* ]]
}
