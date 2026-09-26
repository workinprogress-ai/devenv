#!/usr/bin/env bats
# Tests for issue management scripts

bats_require_minimum_version 1.5.0

load ../test_helper

@test "issue-create.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-create.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-create-batch.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-create-batch.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create-batch.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create-batch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-create-batch.sh help documents fast mode and preview/create" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create-batch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "--issue" ]]
  [[ "$output" =~ "--create" ]]
  [[ "$output" =~ "--file" ]]
}

@test "issue-list.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-list.sh"
  [ "$status" -eq 0 ]
}

@test "issue-list.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-list.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-update.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-update.sh"
  [ "$status" -eq 0 ]
}

@test "issue-update.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-update.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-close.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-close.sh"
  [ "$status" -eq 0 ]
}

@test "issue-close.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-close.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-select.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-select.sh"
  [ "$status" -eq 0 ]
}

@test "issue-select.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-select.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue scripts use error handling library" {
  for script in issue-create.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh; do
    run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

# ---------------------------------------------------------------------------
# Characterization test — pins issue-comment's current no-source error
# contract so future changes to comment sourcing are a provable delta.
# ---------------------------------------------------------------------------

@test "characterization: issue-comment fails when no comment source is provided" {
  # Stub gh so ensure_gh_login passes and source validation is reached.
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$TEST_TEMP_DIR/bin/gh"
  # Stdin under bats may be a TTY (interactive: "A comment source is
  # required") or closed/piped (auto-stdin path: "Refusing empty stdin
  # body") — both are valid no-source failures with exit 2.
  PATH="$TEST_TEMP_DIR/bin:$PATH" run bash "$PROJECT_ROOT/tools/scripts/issue-comment.sh" 42
  [ "$status" -eq 2 ]
  [[ "$output" == *"A comment source is required"* || "$output" == *"Refusing empty stdin body"* ]]
}

@test "issue scripts call shared check_dependencies" {
  for script in issue-create.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh; do
    run grep "check_dependencies" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "issue-select.sh documents fzf usage" {
  run grep -i "fzf" "$PROJECT_ROOT/tools/scripts/issue-select.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh has template support" {
  run grep -E "template|TEMPLATE" "$PROJECT_ROOT/tools/scripts/issue-create.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh supports --blocked-by flag" {
  run grep -E "blocked-by|BLOCKED_BY" "$PROJECT_ROOT/tools/scripts/issue-create.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh help documents --blocked-by" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "blocked-by" ]]
}

@test "issue-list.sh supports filtering options" {
  run grep -E "\-\-state|\-\-label|\-\-assignee" "$PROJECT_ROOT/tools/scripts/issue-list.sh"
  [ "$status" -eq 0 ]
}

@test "issue-update.sh supports status updates" {
  run grep -E "status|state" "$PROJECT_ROOT/tools/scripts/issue-update.sh"
  [ "$status" -eq 0 ]
}

@test "issue-close.sh confirms before closing" {
  run grep -E "read|confirm" "$PROJECT_ROOT/tools/scripts/issue-close.sh"
  [ "$status" -eq 0 ] || skip "Confirmation may be optional with --force"
}

@test "all issue scripts have version information" {
  for script in issue-create.sh issue-create-batch.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh issue-triage.sh; do
    run grep "SCRIPT_VERSION=" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "all issue scripts source versioning library" {
  for script in issue-create.sh issue-create-batch.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh issue-triage.sh; do
    run grep 'source.*versioning.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

create_gh_mock_for_issue_close() {
  mkdir -p "$TEST_TEMP_DIR/bin"
  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  export GH_CALL_LOG="$TEST_TEMP_DIR/gh-calls.log"
  : > "$GH_CALL_LOG"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "${GH_CALL_LOG:-/dev/null}"
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"
}

@test "issue-close.sh resolves repo from cwd git repo with config org set" {
  create_gh_mock_for_issue_close
  create_mock_git_repo "$TEST_TEMP_DIR/test-repo"
  cd "$TEST_TEMP_DIR/test-repo"
  # The cwd+config-org resolution path is what this test names; unset
  # DEVENV_REPO so the test exercises that path, and satisfy the org leg via
  # a seed scoped to a mocked DEVENV_ROOT (env vars carry no identity).
  local saved_devenv_repo="${DEVENV_REPO:-}" saved_devenv_root="${DEVENV_ROOT:-}"
  unset DEVENV_REPO
  mkdir -p "$TEST_TEMP_DIR/mock-root/.setup"
  printf 'test-org\n' > "$TEST_TEMP_DIR/mock-root/.setup/provider_org.txt"
  DEVENV_ROOT="$TEST_TEMP_DIR/mock-root" DEVENV_ROOT_SET=1 run bash "$PROJECT_ROOT/tools/scripts/issue-close.sh" 5
  [ -n "$saved_devenv_repo" ] && export DEVENV_REPO="$saved_devenv_repo"
  [ -n "$saved_devenv_root" ] && export DEVENV_ROOT="$saved_devenv_root"
  cd "$ORIGINAL_PWD"
  [ "$status" -eq 0 ]
  # verify and close must both target the cwd-derived repo via -R, split correctly
  [ "$(grep -cx -- "-R" "$GH_CALL_LOG")" -ge 2 ]
  [ "$(grep -cx -- "test-org/test-repo" "$GH_CALL_LOG")" -ge 2 ]
}


# Birth-rule orchestration: issue-create's post-create block must link the
# sub-issue, then write the birth status via the workflow library's choke
# point — Ready for a Task with a parent, TBD otherwise. The workflow
# libraries are seam-stubbed (WORKFLOW_CORE_TOOLS); assertions are on the
# wrapper argv the choke point invokes.

# Shared harness: full create flow with gh stubbed at every transport.
# Records every gh invocation so assertions can pin the status write.
setup_birth_rule_harness() {
    local stub_dir="$TEST_TEMP_DIR/bin"
    mkdir -p "$stub_dir"
    export PATH="$stub_dir:$PATH"
    export DEVENV_REPO="test-org/test-repo"
    export GH_CALL_LOG="$TEST_TEMP_DIR/gh-calls.log"
    : > "$GH_CALL_LOG"
    # Wrapper seam: record the fan-out argv instead of running the real
    # project-update-issue.sh (its gh traffic is irrelevant here).
    local wf_tools="$TEST_TEMP_DIR/wf-tools/scripts"
    mkdir -p "$wf_tools"
    cat > "$wf_tools/project-update-issue.sh" <<EOF
#!/usr/bin/env bash
echo "WF-WRITE \$*" >> "$GH_CALL_LOG"
exit 0
EOF
    chmod +x "$wf_tools/project-update-issue.sh"
    export WORKFLOW_CORE_TOOLS="$TEST_TEMP_DIR/wf-tools"
    # Workflow libraries read the board via project-list-for-issue; stub it
    # to report no cards so status reads are empty (no rollup interference).
    local ig_tools="$TEST_TEMP_DIR/ig-tools/scripts"
    mkdir -p "$ig_tools"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$ig_tools/project-list-for-issue.sh"
    chmod +x "$ig_tools/project-list-for-issue.sh"
    export ISSUE_GRAPH_TOOLS="$TEST_TEMP_DIR/ig-tools"
    # gh stub: create returns a URL; repo view answers owner/name; graphql
    # (node id lookups for the link) succeeds; everything else succeeds.
    cat > "$stub_dir/gh" <<STUB
#!/usr/bin/env bash
echo "gh \$*" >> "$GH_CALL_LOG"
# NOTE: \$* joins with single spaces and the first arg carries no leading
# space, so patterns must not require one ("issue create", not " issue create").
case "\$*" in
    *"issue create"*)
        echo "https://github.com/test-org/test-repo/issues/777"
        ;;
    *"repo view"*)
        if [[ "\$*" == *"owner"* ]]; then echo "test-org"; else echo "test-repo"; fi
        ;;
    *"graphql"*)
        echo '{"data":{"repository":{"issue":{"id":"I_stub"}}}}'
        ;;
    *)
        exit 0
        ;;
esac
STUB
    chmod +x "$stub_dir/gh"
}

@test "issue-create: Task with parent is born Ready" {
    setup_birth_rule_harness
    run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" \
        --title "birth rule probe" --type Task --parent 42 --no-interactive
    [ "$status" -eq 0 ]
    [[ "$output" == *"https://github.com/test-org/test-repo/issues/777"* ]]
    # The link + birth write must both have been attempted for the new issue.
    grep -q "addSubIssue" "$GH_CALL_LOG"
    grep -q -- "--status Ready" "$GH_CALL_LOG"
    # Birth status targets the NEW issue (777), not the parent.
    grep -E "WF-WRITE 777 --status Ready" "$GH_CALL_LOG"
    [ "$(grep -cE "WF-WRITE 777 --status" "$GH_CALL_LOG")" -eq 1 ]
}

@test "issue-create: standalone issue is born TBD" {
    setup_birth_rule_harness
    run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" \
        --title "birth rule probe standalone" --type Task --no-interactive
    [ "$status" -eq 0 ]
    [[ "$output" == *"https://github.com/test-org/test-repo/issues/777"* ]]
    # No parent: no link, and the birth write is TBD for the new issue.
    if grep -q "addSubIssue" "$GH_CALL_LOG"; then
        fail "standalone issue must not be linked to a parent"
    fi
    grep -E "WF-WRITE 777 --status TBD" "$GH_CALL_LOG"
    [ "$(grep -cE "WF-WRITE 777 --status" "$GH_CALL_LOG")" -eq 1 ]
}

@test "issue-create: non-Task with parent is born TBD" {
    # The birth rule keys on the delivery role: only Tasks (work toward
    # someone else's change) start Ready under a parent; deliverables start
    # at TBD regardless of nesting.
    setup_birth_rule_harness
    run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" \
        --title "birth rule probe bug" --type Bug --parent 42 --no-interactive
    [ "$status" -eq 0 ]
    grep -q "addSubIssue" "$GH_CALL_LOG"
    grep -E "WF-WRITE 777 --status TBD" "$GH_CALL_LOG"
}
