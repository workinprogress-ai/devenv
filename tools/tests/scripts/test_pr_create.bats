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
printf 'gh %s\n' "$*" >> "${GH_CALL_LOG:-/dev/null}"

# Handle -R flag if present (skip repo specification)
if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then
  shift  # skip -R
  shift  # skip org/repo
fi

sub="$1"; shift || true
case "$cmd $sub" in
  "pr list")
    echo "${EXISTING_PR_URL:-}"  # empty = no existing PR
    ;;
  "pr create")
    if [ -n "${PR_CREATE_FAIL:-}" ]; then
      # A failing create whose error text happens to contain a URL.
      echo "error: could not create the PR; see https://github.com/mock-owner/mock-repo/issues/9" >&2
      exit 1
    fi
    if [ -n "${PR_CREATE_WARN:-}" ]; then
      # A successful create that also warns on stderr, with a URL in the warning.
      echo "warning: see https://github.com/mock-owner/mock-repo/wiki/rate-limits" >&2
    fi
    echo "https://github.com/mock-owner/mock-repo/pull/123"
    ;;
  "repo view")
    # allowSquashMerge is driven by the test via SQUASH_MODE; default non-squash.
    # Emulate real gh: -q extracts the field instead of dumping raw JSON.
    if [ "${2:-}" = "--json" ] && [ "${3:-}" = "allowSquashMerge" ] && [ "${4:-}" = "-q" ]; then
      echo "${SQUASH_MODE:-false}"
    else
      cat <<JSON
{"owner":{"login":"mock-owner"},"name":"mock-repo","allowSquashMerge":${SQUASH_MODE:-false}}
JSON
    fi
    ;;
  "issue view")
    # Emulate real gh: -q .title extracts the title.
    if [ "${2:-}" = "--json" ] && [ "${3:-}" = "title" ] && [ "${4:-}" = "-q" ]; then
      echo "Fix the frobnicator alignment"
    else
      cat <<'JSON'
{"title":"Fix the frobnicator alignment"}
JSON
    fi
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

@test "pr-create requires --issue or --no-issue (un-inferable branch errors with guidance)" {
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: new feature" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "pass --issue <number> or --no-issue" ]]
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

@test "pr-create enforces Conventional Commits only on squash repos" {
  # Squash repo: CC required (title becomes the commit subject).
  export SQUASH_MODE=true
  GH_CALL_LOG="$TEST_TEMP_DIR/calls.log"
  export GH_CALL_LOG
  : > "$GH_CALL_LOG"
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "invalid message" --issue 123 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Conventional Commits" ]]
  [ "$(grep -c 'pr create' "$GH_CALL_LOG" || true)" -eq 0 ]
  # Non-squash repo: any non-empty title passes the gate.
  export SQUASH_MODE=false
  : > "$GH_CALL_LOG"
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "invalid message" --issue 123 --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
}

@test "pr-create defaults PR title to the issue title when omitted on a non-squash repo" {
  export SQUASH_MODE=false
  GH_CALL_LOG="$TEST_TEMP_DIR/calls.log"
  export GH_CALL_LOG
  : > "$GH_CALL_LOG"
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" --issue 123 --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  grep -q -- '--title Fix the frobnicator alignment' "$GH_CALL_LOG"
}

@test "pr-create requires a title on a squash repo even without a message" {
  export SQUASH_MODE=true
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" --issue 123 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "squash" ]]
}

@test "pr-create infers the issue number from the branch name" {
  git checkout -b 42-fix-thing >/dev/null 2>&1
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "some title" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Inferred issue #42" ]]
}

@test "pr-create inference skips a type folder prefix" {
  git checkout -b feat/77-add-widget >/dev/null 2>&1
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "some title" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Inferred issue #77" ]]
}

@test "pr-create errors when inference finds no numeric segment" {
  git checkout -b hotfix-desc-only >/dev/null 2>&1
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "some title" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "none inferable from branch name" ]]
  [[ "$output" =~ "--no-issue" ]]
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
  # A real (local) remote: the merge branch is pushed before the PR opens.
  at_fixture

  # --at picks the ready prefix; the merge branch skips the WIP tip, so the
  # feature-branch WIP never enters the PR.
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: ready prefix" --issue 789 --at "$READY_HASH" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "mock-owner/mock-repo/pull/123" ]]
  git show-ref --verify --quiet "refs/heads/merge/${READY_HASH}-feature/partial"
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


# ---------------------------------------------------------------------------
# --at against a real (local) remote: the merge branch must be pushed, and the
# user must be put back on their branch on EVERY exit path.
# ---------------------------------------------------------------------------

# at_fixture: a feature branch with a ready commit and a WIP tip, plus a local
# bare remote standing in for the https origin. Sets READY_HASH and REMOTE.
at_fixture() {
  REMOTE="$TEST_TEMP_DIR/remote.git"
  git init -q --bare -b main "$REMOTE"
  git config url."$REMOTE".insteadOf "https://github.com/mock-owner/mock-repo.git"
  git push -q origin main 2>/dev/null
  git checkout -b feature/partial >/dev/null 2>&1
  echo "one" >> README.md; git add README.md; git commit -q -m "feat: ready prefix"
  READY_HASH="$(git rev-parse --short HEAD)"
  echo "two" >> README.md; git add README.md; git commit -q -m "WIP: continues"
}

@test "pr-create --at pushes the merge branch to the remote before opening the PR" {
  at_fixture
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: ready prefix" --issue 789 --at "$READY_HASH" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  git -C "$REMOTE" show-ref --verify --quiet "refs/heads/merge/${READY_HASH}-feature/partial"
}

@test "pr-create --at: a failed push stops before creating the PR and restores the branch" {
  at_fixture
  rm -rf "$REMOTE"   # remote vanishes: the push cannot succeed
  export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: ready prefix" --issue 789 --at "$READY_HASH" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [ "$(grep -c '^gh pr create' "$GH_CALL_LOG" || true)" -eq 0 ]
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feature/partial" ]
}

@test "pr-create --at restores the original branch when the merge-branch WIP guard rejects" {
  at_fixture
  wip_hash="$(git rev-parse --short HEAD)"   # the WIP tip itself
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: x" --issue 789 --at "$wip_hash" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feature/partial" ]
}

@test "pr-create --at restores the original branch when an open PR already exists" {
  at_fixture
  export EXISTING_PR_URL="https://github.com/mock-owner/mock-repo/pull/55"
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: ready prefix" --issue 789 --at "$READY_HASH" --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pull/55"* ]]
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feature/partial" ]
}

@test "pr-create --at restores the original branch when PR creation fails" {
  at_fixture
  export PR_CREATE_FAIL=1
  run "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: ready prefix" --issue 789 --at "$READY_HASH" --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feature/partial" ]
}

@test "pr-create reports the creator's failure, not the URL extractor's, and keeps stderr out of the URL" {
  # The error text contains a URL; folded into the extractor's input it used to
  # masquerade as the created PR's URL with exit 0.
  export PR_CREATE_FAIL=1
  run --separate-stderr "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" != *"issues/9"* ]]
  [[ "$stderr" == *"Failed to create PR"* ]]
}

@test "pr-create returns the PR URL from stdout even when stderr carries an earlier URL" {
  export PR_CREATE_WARN=1
  run --separate-stderr "$PROJECT_ROOT/tools/scripts/pr-create.sh" "feat: something" --issue 789 --repo-dir "$REPO_DIR"
  [ "$status" -eq 0 ]
  [ "$output" = "https://github.com/mock-owner/mock-repo/pull/123" ]
}
