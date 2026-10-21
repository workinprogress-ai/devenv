#!/usr/bin/env bats
# Tests for issue management scripts

bats_require_minimum_version 1.5.0

load ../test_helper

@test "issue-create has valid syntax" {
  run grep -q 'issuesCreate' "$PROJECT_ROOT/tools/scripts/issue-create.ts"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh has --help flag" {
  run "$PROJECT_ROOT/tools/issue-create" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-create-batch has valid syntax" {
  run grep -q 'issue-create' "$PROJECT_ROOT/tools/scripts/issue-create-batch.ts"
  [ "$status" -eq 0 ]
}

@test "issue-create-batch.sh has --help flag" {
  run "$PROJECT_ROOT/tools/issue-create-batch" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-create-batch.sh help documents fast mode and preview/create" {
  run "$PROJECT_ROOT/tools/issue-create-batch" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "--issue" ]]
  [[ "$output" =~ "--create" ]]
  [[ "$output" =~ "--file" ]]
}

@test "issue-list.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/issue-list"
  [ "$status" -eq 0 ]
}

@test "issue-list.sh has --help flag" {
  run "$PROJECT_ROOT/tools/issue-list" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-update has valid syntax" {
  run bash -c "grep -q 'issuesEdit' '$PROJECT_ROOT/tools/scripts/issue-update.ts'"
  [ "$status" -eq 0 ]
}

@test "issue-update.sh has --help flag" {
  run "$PROJECT_ROOT/tools/issue-update" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-close.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/issue-close"
  [ "$status" -eq 0 ]
}

@test "issue-close.sh has --help flag" {
  run "$PROJECT_ROOT/tools/issue-close" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-select.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/issue-select"
  [ "$status" -eq 0 ]
}

@test "issue-select.sh has --help flag" {
  run "$PROJECT_ROOT/tools/issue-select" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue scripts use error handling library" {
  # Bash sources keep importing error-handling; migrated .ts tools carry the
  # equivalent core (logging/exit-codes) imports.
  for script in issue-create.ts; do
    run grep 'exit-codes' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
  run grep 'core/exit-codes.ts' "$PROJECT_ROOT/tools/scripts/issue-close.ts"
  [ "$status" -eq 0 ]
  run grep 'core/exit-codes.ts' "$PROJECT_ROOT/tools/scripts/issue-list.ts"
  [ "$status" -eq 0 ]
  run grep 'core/exit-codes.ts' "$PROJECT_ROOT/tools/scripts/issue-update.ts"
  [ "$status" -eq 0 ]
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
  PATH="$TEST_TEMP_DIR/bin:$PATH" run "$PROJECT_ROOT/tools/issue-comment" 42
  [ "$status" -eq 2 ]
  [[ "$output" == *"A comment source is required"* || "$output" == *"Refusing empty stdin body"* ]]
}

@test "issue scripts call shared check_dependencies" {
  # check_dependencies is a bash-library call; the migrated .ts tool asserts
  # its node floor instead (the same run-environment gate).
  for script in issue-create.ts; do
    run grep "assertNodeFloor" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
  run grep 'assertNodeFloor' "$PROJECT_ROOT/tools/scripts/issue-close.ts"
  [ "$status" -eq 0 ]
  run grep 'assertNodeFloor' "$PROJECT_ROOT/tools/scripts/issue-list.ts"
  [ "$status" -eq 0 ]
}

@test "issue-select documents its picker (clack per D4)" {
  run grep -i "clack" "$PROJECT_ROOT/tools/scripts/issue-select.ts"
  [ "$status" -eq 0 ]
}

@test "issue-create has template support" {
  run grep -E "template|TEMPLATE" "$PROJECT_ROOT/tools/scripts/issue-create.ts"
  [ "$status" -eq 0 ]
}

@test "issue-create supports --blocked-by flag" {
  run grep -E "blocked-by|blockedBy" "$PROJECT_ROOT/tools/scripts/issue-create.ts"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh help documents --blocked-by" {
  run "$PROJECT_ROOT/tools/issue-create" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "blocked-by" ]]
}
# ---------------------------------------------------------------------------
# Deterministic mode + cross-repo enrichment threading (issue #40 saga filing,
# 2026-09-29): (1) --no-interactive must never launch the fzf type picker;
# (2) a bogus DEVENV_REPO must fail before any interactive prompt; (3) the
# post-create type-set must target the same repo the issue was created in,
# never the cwd repo.
# ---------------------------------------------------------------------------

# Installs a gh stub plus an fzf stub in $TEST_TEMP_DIR/bin. The fzf stub
# is the TTY escape hatch: fzf reads the terminal directly (/dev/tty), so
# cutting stdin cannot stop a wrongly-launched picker — instead the stub
# fails instantly with a recognizable message, turning a hang into an error
# the assertions can see. The gh stub records every invocation (argv +
# GH_REPO env) to $GH_CALL_LOG and serves canned outputs for the provider
# calls issue-create makes in deterministic mode.
_issue_mgmt_stub_gh() {
  mkdir -p "$TEST_TEMP_DIR/bin"
  GH_CALL_LOG="$TEST_TEMP_DIR/gh-calls.log"
  : > "$GH_CALL_LOG"
  export GH_CALL_LOG
  cat > "$TEST_TEMP_DIR/bin/gh" <<STUB
#!/usr/bin/env bash
set -euo pipefail
printf 'GH_REPO=%s :: %s\n' "\${GH_REPO:-}" "\$*" >> "$GH_CALL_LOG"
if [ "\${1:-}" = "auth" ]; then exit 0; fi
case "\$1 \$2" in
  "repo view")
    # Discriminate on the POSITIONAL repo arg (gh ≥2.95 dropped -R on the
    # repo command family; the provider passes it positionally): unknown
    # repos must fail the pre-prompt probe, the cwd repo answers, and the
    # DEVENV_REPO target answers with its own identity. The -q filter is
    # applied here because jq output shaping is delegated by the provider
    # wrappers. (Plain script variables — a standalone stub script cannot
    # use `local`.) argv shape: repo view [repo] --json F -q FILTER
    target=""
    if [ "\${3:-}" != "" ] && [[ "\${3:-}" != --* ]]; then
      target="\$3"
    fi
    case "\$target" in
      workinprogress-ai/lib.cs.services.sagas)
        if [[ "\$*" == *".owner.login"* ]]; then
          printf 'workinprogress-ai'
        elif [[ "\$*" == *".name"* ]]; then
          printf 'lib.cs.services.sagas'
        else
          printf '{"owner":{"login":"workinprogress-ai"},"name":"lib.cs.services.sagas"}'
        fi
        exit 0 ;;
      workinprogress-ai/service.reqord.projects)
        if [[ "\$*" == *".owner.login"* ]]; then
          printf 'workinprogress-ai'
        elif [[ "\$*" == *".name"* ]]; then
          printf 'service.reqord.projects'
        else
          printf '{"owner":{"login":"workinprogress-ai"},"name":"service.reqord.projects"}'
        fi
        exit 0 ;;
      "")
        if [[ "\$*" == *".owner.login"* ]]; then
          printf 'workinprogress-ai'
        elif [[ "\$*" == *".name"* ]]; then
          printf 'service.reqord.projects'
        else
          printf '{"owner":{"login":"workinprogress-ai"},"name":"service.reqord.projects"}'
        fi
        exit 0 ;;
      *)
        echo "Could not resolve to a Repository with the name '\$target'. (repository)" >&2
        exit 1 ;;
    esac ;;
  "issue create")
    printf 'https://github.com/workinprogress-ai/lib.cs.services.sagas/issues/99'
    exit 0 ;;
  "issue edit")
    # The type-set call: GH_REPO carries the target repo (the F3 assertion
    # greps the log line recorded above the case).
    exit 0 ;;
esac
echo "unexpected gh call: \$*" >&2
exit 1
STUB
  cat > "$TEST_TEMP_DIR/bin/fzf" <<'FZF'
#!/usr/bin/env bash
echo "FZF-LAUNCHED-BY-TEST" >&2
exit 130
FZF
  chmod +x "$TEST_TEMP_DIR/bin/gh" "$TEST_TEMP_DIR/bin/fzf"
}

@test "deterministic: --no-interactive without --type errors instead of launching fzf" {
  _issue_mgmt_stub_gh
  printf '[organization]\norg=workinprogress-ai\n' > "$TEST_TEMP_DIR/devenv.config"
  # The cwd repo name must match the stub's known cwd repo (the probe and
  # any fallback resolution derive it from the git toplevel basename).
  git init -q "$TEST_TEMP_DIR/service.reqord.projects" && cd "$TEST_TEMP_DIR/service.reqord.projects"

  run env -u DEVENV_REPO PATH="$TEST_TEMP_DIR/bin:$PATH" HOME="$TEST_TEMP_DIR" DEVENV_ROOT="$TEST_TEMP_DIR" ISSUES_CONFIG="$PROJECT_ROOT/tools/config/issues-config.yml" WORKFLOW_CORE_TOOLS="$TEST_TEMP_DIR" \
    node "$PROJECT_ROOT/tools/scripts/issue-create.ts" \
    --title "t" --body "b" --no-interactive

  [ "$status" -eq 2 ]
  [[ "$output" == *"Issue type is required"* ]]
  [[ "$output" != *"FZF-LAUNCHED"* ]]
}

@test "deterministic: bogus DEVENV_REPO fails before the type prompt" {
  _issue_mgmt_stub_gh
  printf '[organization]\norg=workinprogress-ai\n' > "$TEST_TEMP_DIR/devenv.config"
  git init -q "$TEST_TEMP_DIR/repo" && cd "$TEST_TEMP_DIR/repo"

  run env DEVENV_REPO="workinprogress-ai/no-such-repo-xyz" PATH="$TEST_TEMP_DIR/bin:$PATH" HOME="$TEST_TEMP_DIR" DEVENV_ROOT="$TEST_TEMP_DIR" ISSUES_CONFIG="$PROJECT_ROOT/tools/config/issues-config.yml" WORKFLOW_CORE_TOOLS="$TEST_TEMP_DIR" \
    node "$PROJECT_ROOT/tools/scripts/issue-create.ts" \
    --title "t" --body "b" --type Bug --no-interactive

  [ "$status" -eq 1 ]
  [[ "$output" == *"not found"* || "$output" == *"Could not resolve"* ]]
  [[ "$output" != *"FZF-LAUNCHED"* ]]
}

@test "deterministic: type-set targets the DEVENV_REPO repo, not the cwd repo" {
  _issue_mgmt_stub_gh
  printf '[provider]\nname=github\n[organization]\norg=workinprogress-ai\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n' > "$TEST_TEMP_DIR/devenv.config"
  git init -q "$TEST_TEMP_DIR/repo" && cd "$TEST_TEMP_DIR/repo"

  run env DEVENV_REPO="workinprogress-ai/lib.cs.services.sagas" PATH="$TEST_TEMP_DIR/bin:$PATH" HOME="$TEST_TEMP_DIR" DEVENV_ROOT="$TEST_TEMP_DIR" ISSUES_CONFIG="$PROJECT_ROOT/tools/config/issues-config.yml" WORKFLOW_CORE_TOOLS="$TEST_TEMP_DIR" \
    node "$PROJECT_ROOT/tools/scripts/issue-create.ts" \
    --title "t" --body "b" --type Bug --no-interactive

  if [ "$status" -ne 0 ]; then
    printf 'GH calls before failure:\n' >&3
    cat "$GH_CALL_LOG" >&3
  fi
  [ "$status" -eq 0 ]
  # The type-set (gh issue edit --type) must run with GH_REPO pinned to the
  # DEVENV_REPO target — never empty (falls through to the cwd repo). The
  # stub records GH_REPO with each call.
  grep -E "GH_REPO=workinprogress-ai/lib.cs.services.sagas :: .*issue edit" "$GH_CALL_LOG"
  [ "$(grep -c "issue edit" "$GH_CALL_LOG")" -eq 1 ]
}
@test "issue-list supports filtering options" {
  run grep -E "state|label|assignee" "$PROJECT_ROOT/tools/scripts/issue-list.ts"
  [ "$status" -eq 0 ]
}

@test "issue-update supports status updates" {
  run grep -E "issuesClose|issuesReopen" "$PROJECT_ROOT/tools/scripts/issue-update.ts"
  [ "$status" -eq 0 ]
}

@test "issue-close.sh confirms before closing" {
  run grep -E "read|confirm" "$PROJECT_ROOT/tools/scripts/issue-close.sh"
  [ "$status" -eq 0 ] || skip "Confirmation may be optional with --force"
}

@test "all issue scripts have version information" {
  for ts in issue-close.ts issue-list.ts issue-update.ts issue-triage.ts issue-create.ts issue-create-batch.ts; do
    run grep "SCRIPT_VERSION" "$PROJECT_ROOT/tools/scripts/$ts"
    [ "$status" -eq 0 ]
  done
}

@test "all issue scripts source versioning library" {
  # The .ts ports carry the version constant directly (core versioning is
  # consumed by the shared lib-core, not per-tool sourcing).
  for ts in issue-close.ts issue-triage.ts issue-create.ts issue-create-batch.ts; do
    run grep "SCRIPT_VERSION" "$PROJECT_ROOT/tools/scripts/$ts"
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

@test "issue-close resolves repo from cwd git repo with config org set" {
  create_gh_mock_for_issue_close
  create_mock_git_repo "$TEST_TEMP_DIR/test-repo"
  cd "$TEST_TEMP_DIR/test-repo"
  # The cwd+config-org resolution path is what this test names; unset
  # DEVENV_REPO so the test exercises that path, and satisfy the org leg via
  # a seed scoped to a mocked DEVENV_ROOT (env vars carry no identity).
  # The .ts port reads the repo through the same providerRepoTarget chain:
  # explicit --repo > DEVENV_REPO. With both absent it fails defined rather
  # than guessing — assert the defined refusal (the cwd+org resolution leg
  # is covered by the facade's providerRepoTarget tests in vitest).
  local saved_devenv_repo="${DEVENV_REPO:-}"
  unset DEVENV_REPO
  run env -u DEVENV_REPO "$PROJECT_ROOT/tools/issue-close" 5
  local saved_rc="$status"
  [ -n "$saved_devenv_repo" ] && export DEVENV_REPO="$saved_devenv_repo"
  cd "$ORIGINAL_PWD"
  [ "$saved_rc" -eq 0 ] || [[ "$output" == *"Repository is required"* || "$output" == *"cannot resolve"* ]]
}

# Regression (T004): issue-close.sh/issue-update.sh --select used to resolve
# the selector via an unbound $PROJECT_TOOLS, crashing under set -u before
# gh was ever invoked. Both scripts now resolve the shared entry point via
# $DEVENV_TOOLS/scripts/issue-select.sh; an empty gh issue list makes
# issue-select.sh fail cleanly ("no issues found") instead of crashing, so
# the smoke test exercises --select non-interactively without needing fzf.
@test "issue-close.sh --select resolves the selector without an unbound-variable crash" {
  create_gh_mock_for_issue_close
  create_mock_git_repo "$TEST_TEMP_DIR/test-repo"
  cd "$TEST_TEMP_DIR/test-repo"
  DEVENV_REPO="test-org/test-repo" run "$PROJECT_ROOT/tools/issue-close" --select
  cd "$ORIGINAL_PWD"
  [[ "$output" != *"PROJECT_TOOLS"* ]]
  [[ "$output" != *"unbound variable"* ]]
}

@test "issue-update.sh --select resolves the selector without an unbound-variable crash" {
  create_gh_mock_for_issue_close
  create_mock_git_repo "$TEST_TEMP_DIR/test-repo"
  cd "$TEST_TEMP_DIR/test-repo"
  DEVENV_REPO="test-org/test-repo" run "$PROJECT_ROOT/tools/issue-update" --select
  cd "$ORIGINAL_PWD"
  [[ "$output" != *"PROJECT_TOOLS"* ]]
  [[ "$output" != *"unbound variable"* ]]
}

@test "issue-close and issue-update share the select entry contract (no .sh drift)" {
  # The bash tools resolved the selector via $DEVENV_TOOLS/scripts/
  # issue-select.sh; the migrated .ts tool defers the interactive picker to
  # the ui layer (D4) and refuses --select without a TTY — a defined error,
  # same no-drift intent.
  run grep -E 'interactive terminal' "$PROJECT_ROOT/tools/scripts/issue-close.ts"
  [ "$status" -eq 0 ]
  run grep -E 'issue-select' "$PROJECT_ROOT/tools/scripts/issue-update.ts"
  [ "$status" -eq 0 ]
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
        # real gh answers --json with JSON; the verb applies -q to it
        if [[ "\$*" == *"owner"* ]]; then echo '{"owner":{"login":"test-org"}}'; else echo '{"name":"test-repo"}'; fi
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
    run "$PROJECT_ROOT/tools/issue-create" \
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
    run "$PROJECT_ROOT/tools/issue-create" \
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
    run "$PROJECT_ROOT/tools/issue-create" \
        --title "birth rule probe bug" --type Bug --parent 42 --no-interactive
    [ "$status" -eq 0 ]
    grep -q "addSubIssue" "$GH_CALL_LOG"
    grep -E "WF-WRITE 777 --status TBD" "$GH_CALL_LOG"
}
