#!/usr/bin/env bats
# Tests for special/repo-reset-merge-config.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
cmd="$1"; shift
printf 'gh %s %s\n' "$cmd" "$*" >> "${GH_CALL_LOG:-/dev/null}"
if [ "$cmd" != "-R" ] && [ "${1:-}" = "-R" ]; then
  shift; shift
fi
sub="$1"; shift || true
case "$cmd $sub" in
  "auth status")
    # repo-operations' provider auth guard resolves through the github
    # provider's auth-status impl (gh auth status) — answer success.
    exit 0
    ;;
  "repo list")
    printf '[{"name":"repo-alpha"},{"name":"repo-beta"}]'
    ;;
  "pr list")
    # Real gh applies --jq before printing; emulate that contract.
    # repo-alpha: 2 open PRs; repo-beta: none.
    if [[ "$*" == *"--jq length"* ]]; then
      if [[ "$*" == *"alpha"* ]]; then printf '2\n'; else printf '0\n'; fi
    elif [[ "$*" == *"alpha"* ]]; then
      printf '[{"number":11},{"number":12}]'
    else
      printf '[]'
    fi
    ;;
  "repo view")
    cat <<'JSON'
{"owner":{"login":"mock-owner"},"name":"mock-repo"}
JSON
    ;;
  api*)
    if [ -n "${API_FAIL:-}" ]; then
      echo "gh: HTTP 403 (simulated)" >&2
      exit 1
    fi
    # Ruleset + merge-type apply endpoints report success
    echo '{}'
    ;;
  *)
    echo "gh mock received unexpected command: $cmd $sub (all args: $@)" >&2
    exit 1
    ;;
esac
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"
}

teardown() {
  cd "$PROJECT_ROOT"
  test_helper_teardown
}

@test "repo-reset-merge-config dry-run lists repos and flags attention" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --all
  [ "$status" -eq 0 ]
  [[ "$output" =~ "org:" ]]
  [[ "$output" =~ "repo-alpha" ]]
  [[ "$output" =~ "repo-beta" ]]
  # repo-alpha has open PRs → attention flag (org prefix comes from config,
  # not the mock — assert org-agnostically)
  [[ "$output" =~ "ATTENTION" ]]
  [[ "$output" =~ "repo-alpha: type=" ]]
  [[ "$output" =~ "open_prs=2" ]]
  # Dry-run must not apply
  [[ "$output" =~ "Dry-run only" ]]
  # No apply message in dry-run
  ! [[ "$output" =~ "Applied rebase-only config" ]]
}

@test "repo-reset-merge-config positional name restricts the scan" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" repo-beta
  [ "$status" -eq 0 ]
  [[ "$output" =~ "repo-beta" ]]
  ! [[ "$output" =~ "repo-alpha" ]]
}

# A typed, attention-free repo (no open PRs, no local clone) is applied.
@test "repo-reset-merge-config --apply configures a typed repo with a rebase-only PATCH" {
  export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --apply service.platform.core
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Applied rebase-only config" ]]
  grep -q 'allow_rebase_merge=true' "$GH_CALL_LOG"
  grep -q 'allow_merge_commit=false' "$GH_CALL_LOG"
  grep -q 'allow_squash_merge=false' "$GH_CALL_LOG"
}

# The policy inversion: an undetected type resolves to "none", whose config enables
# every merge method — applying it under a "rebase-only" banner did the opposite of the
# policy. It must be excluded from --apply and reported loudly.
@test "repo-reset-merge-config --apply refuses an undetected type and never enables all merge methods" {
  export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --apply repo-beta
  [ "$status" -ne 0 ]
  [[ "$output" =~ "undetected" ]]
  [[ "$output" != *"Applied rebase-only config to mock-owner/repo-beta"* ]]
  [ "$(grep -c 'allow_merge_commit=true' "$GH_CALL_LOG" || true)" -eq 0 ]
  [ "$(grep -c 'allow_squash_merge=true' "$GH_CALL_LOG" || true)" -eq 0 ]
}

@test "repo-reset-merge-config --apply skips a repo the attention report flags (open PRs)" {
  export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --apply service.alpha.core
  [ "$status" -ne 0 ]
  [[ "$output" =~ "needs attention" ]]
  [ "$(grep -c 'PATCH' "$GH_CALL_LOG" || true)" -eq 0 ]
}

@test "repo-reset-merge-config --apply reports an API failure instead of claiming success" {
  export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
  export API_FAIL=1
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --apply service.platform.core
  [ "$status" -ne 0 ]
  [[ "$output" != *"Applied rebase-only config to mock-owner/service.platform.core"* ]]
  [[ "$output" =~ "Failed to apply" ]]
}

@test "repo-reset-merge-config --apply summary counts skipped and failed repos" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --apply service.platform.core repo-beta service.alpha.core
  [ "$status" -ne 0 ]
  [[ "$output" =~ "applied: 1" ]]
  [[ "$output" =~ "not applied: 2" ]]
}

@test "repo-reset-merge-config dry-run never fails for an undetected type" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" repo-beta
  [ "$status" -eq 0 ]
}

@test "repo-reset-merge-config has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh"
  [ "$status" -eq 0 ]
}

@test "repo-reset-merge-config no target selected: usage error with guidance" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "No target selected" ]]
}

@test "repo-reset-merge-config positional list processes exactly the named repos" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" repo-alpha repo-beta
  [ "$status" -eq 0 ]
  [[ "$output" =~ "repo-alpha" ]]
  [[ "$output" =~ "repo-beta" ]]
}

@test "repo-reset-merge-config --all combined with positionals is a usage error" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --all repo-alpha
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Choose one target mode" ]]
}

@test "repo-reset-merge-config --repo is no longer a recognized flag" {
  run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --repo repo-beta
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Unknown argument: --repo" ]]
}
