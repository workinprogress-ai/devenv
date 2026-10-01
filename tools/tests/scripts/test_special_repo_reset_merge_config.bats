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
    printf 'repo-alpha\nrepo-beta\n'
    ;;
  "pr list")
    # Real gh applies --jq before printing; emulate that contract.
    # repo-alpha: 2 open PRs; repo-beta: none.
    if [[ "$*" == *"--jq length"* ]]; then
      if [[ "$*" == *"repo-alpha"* ]]; then printf '2\n'; else printf '0\n'; fi
    elif [[ "$*" == *"repo-alpha"* ]]; then
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
  DEVENV_ROOT="$PROJECT_ROOT" run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh"
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

@test "repo-reset-merge-config --repo restricts the scan" {
  DEVENV_ROOT="$PROJECT_ROOT" run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --repo repo-beta
  [ "$status" -eq 0 ]
  [[ "$output" =~ "repo-beta" ]]
  ! [[ "$output" =~ "repo-alpha" ]]
}

@test "repo-reset-merge-config --apply configures repos" {
  DEVENV_ROOT="$PROJECT_ROOT" run bash "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh" --apply --repo repo-beta
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Applied rebase-only config" ]]
}

@test "repo-reset-merge-config has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/special/repo-reset-merge-config.sh"
  [ "$status" -eq 0 ]
}
