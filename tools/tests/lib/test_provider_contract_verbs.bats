#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

# ============================================================================
# Contract verbs present on BOTH providers (github backfill verification —
# the no-regression net for the call-site rewrites).
# ============================================================================

# Source github provider libs with a stubbed gh on PATH.
gh_libs_source() {
    stub_gh
    export PATH="$STUB_BIN_DIR:$PATH"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    source "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    source "$DEVENV_TOOLS/lib/providers/github/prs.bash"
    source "$DEVENV_TOOLS/lib/providers/github/org.bash"
}

gh_run() {
    gh_libs_source
    "$@"
}

@test "github provider_issues_comment_get fetches the comment REST resource" {
    printf '{"id":911,"html_url":"https://github.o/r/issues/1#issuecomment-911","body":"x"}' > "$TEST_TEMP_DIR/c.json"
    STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/c.json" \
        run gh_run provider_issues_comment_get o/r 911
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.id')" = "911" ]
}

@test "github provider_issues_comment_edit PATCHes the body" {
    # The mutation stub answers -X PATCH with its fixed mutation shape.
    STUB_GH_MUTATIONS="$TEST_TEMP_DIR/muts.log" \
        run gh_run provider_issues_comment_edit o/r 911 --body "new"
    [ "$status" -eq 0 ]
    grep -q "PATCH repos/o/r/issues/comments/911" "$TEST_TEMP_DIR/muts.log"
    grep -q "body=new" "$TEST_TEMP_DIR/muts.log"
}

@test "github provider_issues_comment_add POSTs to the issue comments endpoint" {
    STUB_GH_MUTATIONS="$TEST_TEMP_DIR/muts2.log" \
        run gh_run provider_issues_comment_add o/r 1 --body "created"
    [ "$status" -eq 0 ]
    grep -q "POST repos/o/r/issues/1/comments" "$TEST_TEMP_DIR/muts2.log"
}

@test "github provider_issues_label_create passes name/color/description" {
    run gh_run provider_issues_label_create o/r mylabel 1d76db "desc"
    [ "$status" -eq 0 ]
    grep -q "label create mylabel" "$TEST_TEMP_DIR/stub-calls.log"
}

@test "github provider_issues_label_update edits color" {
    run gh_run provider_issues_label_update o/r mylabel ff0000
    [ "$status" -eq 0 ]
    grep -q "label edit mylabel" "$TEST_TEMP_DIR/stub-calls.log"
}

@test "github provider_repos_commits_count succeeds on non-empty" {
    printf '[{"sha":"abc"}]' > "$TEST_TEMP_DIR/commits.json"
    STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/commits.json" \
        run gh_run provider_repos_commits_count o/r
    [ "$status" -eq 0 ]
}

@test "github provider_repos_commits_count fails on empty array" {
    printf '[]' > "$TEST_TEMP_DIR/nocommits.json"
    STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/nocommits.json" \
        run gh_run provider_repos_commits_count o/r
    [ "$status" -ne 0 ]
}

@test "github provider_prs_thread_create general form emits thread url" {
    printf '{"data":{"repository":{"id":"R_1"}}}' > "$TEST_TEMP_DIR/node.json"
    printf '{"data":{"addPullRequestReviewThread":{"thread":{"url":"https://github.o/r/pull/1#discussion_r1"}}}}' > "$TEST_TEMP_DIR/thread.json"
    # Two graphql calls: pr id lookup, then the mutation. Queue them.
    printf '%s\n%s\n' "$TEST_TEMP_DIR/node.json" "$TEST_TEMP_DIR/thread.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_GH_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run gh_run provider_prs_thread_create o/r 1 --body "note"
    [ "$status" -eq 0 ]
    [[ "$(printf '%s' "$output" | jq -r '.thread.url')" =~ discussion_r1 ]]
}

@test "azure provider_prs_thread_create mirrors the same interface" {
    stub_curl
    export PATH="$STUB_BIN_DIR:$PATH"
    export AZURE_PAT="test-pat"
    # Never touch the real repo config: point DEVENV_ROOT at a per-test dir
    # (test_helper_setup defaults it to PROJECT_ROOT) BEFORE any config write.
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/prs.bash"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"
    printf '{"id":777,"status":1}' > "$TEST_TEMP_DIR/azthread.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/azthread.json" \
        run provider_prs_thread_create o1/p1/r1 12 --body "note"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.thread.id')" = "12/777" ]
}

# ============================================================================
# Contract verbs implemented on both providers
# ============================================================================

@test "github provider_org_releases_list passes the gh dialect through" {
    run gh_run provider_org_releases_list o/r --limit 10 --json tagName
    [ "$status" -eq 0 ]
    grep -q "release list -R o/r" "$TEST_TEMP_DIR/stub-calls.log"
}

@test "azure provider_org_releases_list maps tags to the gh release shape" {
    stub_curl
    export STUB_CALL_LOG AZURE_PAT="test-pat"
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/releases.bash"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"
    cat > "$TEST_TEMP_DIR/tags.json" << 'JSONEOF'
{"value":[{"name":"refs/tags/v1.2.3","creator":{"date":"2026-02-02T00:00:00Z"}},{"name":"refs/tags/v2.0.0-beta.1","creator":{"date":"2026-03-03T00:00:00Z"}}]}
JSONEOF
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/tags.json" \
        run provider_org_releases_list o1/p1/r1 --limit 10
    [ "$status" -eq 0 ]
    # One JSON array of gh-shaped release records.
    jq -e 'length == 2 and .[0].tagName == "v1.2.3" and .[1].isPrerelease == true and .[0].isDraft == false' \
        <<< "$output" >/dev/null
}

@test "azure provider_org_feeds_list emits the packaging surface" {
    stub_curl
    export STUB_CALL_LOG AZURE_PAT="test-pat"
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/releases.bash"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"
    printf '{"value":[{"name":"main-feed","id":"f1","url":"https://feeds/x"}]}' > "$TEST_TEMP_DIR/feeds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/feeds.json" \
        run provider_org_feeds_list
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.[0].name')" = "main-feed" ]
}

@test "azure provider_issues_set_type patches System.WorkItemType" {
    stub_curl
    export STUB_CALL_LOG AZURE_PAT="test-pat"
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"
    printf '{"id":42,"fields":{}}' > "$TEST_TEMP_DIR/typed.json"
    : > "$TEST_TEMP_DIR/typebody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/typed.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/typebody.log" \
        run provider_issues_set_type o p 42 Task
    [ "$status" -eq 0 ]
    jq -e '.[0].value == "Task"' < <(cat "$TEST_TEMP_DIR/typebody.log") >/dev/null
}

@test "merge_pr deletes by default and keeps the branch on request" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/git-operations.bash"
    # Stub AFTER sourcing: git-operations loads the provider layer, whose
    # real verbs would otherwise override these stubs.
    provider_prs_merge() {
        printf '%s\n' "$*"
    }
    provider_prs_view() { echo '{}'; }
    merge_method_allowed() { return 0; }
    local msg="subject line"
    out=$(merge_pr 42 "$msg" rebase "" false false 2>/dev/null)
    printf '%s' "$out" | grep -q -- "--delete-branch"
    out2=$(merge_pr 42 "$msg" rebase "" false true 2>/dev/null)
    if printf '%s' "$out2" | grep -q -- "--delete-branch"; then
        echo "keep_branch did not suppress --delete-branch: $out2" >&2
        return 1
    fi
}
