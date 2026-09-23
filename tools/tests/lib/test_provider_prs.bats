#!/usr/bin/env bats
# Contract tests for the github prs domain facade.
# Pagination coverage is mandatory per plan watch-outs (STUB_GH_PAGES queue).

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

assert_success() {
    [ "$status" -eq 0 ]
}

assert_failure() {
    [ "$status" -ne 0 ]
}

setup() {
    test_helper_setup
    export STUB_CALL_LOG
    export TEST_TEMP_DIR
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    unset _PROVIDER_CORE_LOADED
    unset PROVIDER_NAME
    unset PROVIDER_CAPABILITIES
    stub_gh
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_detect "$TEST_TEMP_DIR/absent.config"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/prs.bash"
}

# ============================================================================
# Load & idempotency
# ============================================================================

@test "prs module: loads and is idempotent under re-source" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/prs.bash"
    declare -F provider_prs_list >/dev/null
}

# ============================================================================
# Reads
# ============================================================================

@test "prs list: passes -R repo and flags" {
    run provider_prs_list org/repo --state open
    assert_success
    grep -q "^gh pr list -R org/repo --state open$" "$STUB_CALL_LOG"
}

@test "prs view: passes number and repo" {
    run provider_prs_view org/repo 33
    assert_success
    grep -q "^gh pr view 33 -R org/repo$" "$STUB_CALL_LOG"
}

@test "prs diff: passes number and repo" {
    run provider_prs_diff org/repo 33
    assert_success
    grep -q "^gh pr diff 33 -R org/repo$" "$STUB_CALL_LOG"
}


# ============================================================================
# Pagination (mandatory per plan watch-outs)
# ============================================================================

@test "prs list via api comments: paginated reads consume the page queue in order" {
    local p1="$TEST_TEMP_DIR/page1.json" p2="$TEST_TEMP_DIR/page2.json"
    printf '{"p":1}' > "$p1"
    printf '{"p":2}' > "$p2"
    printf '%s\n%s\n' "$p1" "$p2" > "$TEST_TEMP_DIR/pages.queue"
    export STUB_GH_PAGES="$TEST_TEMP_DIR/pages.queue"

    run gh api "repos/org/repo/issues/1/comments" --paginate
    assert_success
    [[ "$output" == '{"p":1}' ]]

    run gh api "repos/org/repo/issues/1/comments" --paginate
    assert_success
    [[ "$output" == '{"p":2}' ]]

    # queue exhausted -> stub fails with a defined error
    run gh api "repos/org/repo/issues/1/comments" --paginate
    assert_failure
}

# ============================================================================
# Mutations
# ============================================================================

@test "prs create: passes title/body/head/base and repo" {
    run provider_prs_create org/repo --title "T" --body "B" --head h --base main
    assert_success
    grep -q "^gh pr create -R org/repo --title T --body B --head h --base main$" "$STUB_CALL_LOG"
}

@test "prs merge: squash + delete-branch defaults pass through" {
    run provider_prs_merge org/repo 33 --squash --delete-branch
    assert_success
    grep -q "^gh pr merge 33 -R org/repo --squash --delete-branch$" "$STUB_CALL_LOG"
}

@test "prs merge: not issued when number is missing" {
    run provider_prs_merge org/repo
    assert_failure
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

@test "prs comment: passes number and body" {
    run provider_prs_comment org/repo 33 --comment-body "note"
    assert_success
    grep -q "^gh pr comment 33 -R org/repo --comment-body note$" "$STUB_CALL_LOG"
}

@test "prs thread reply: POSTs to the REST replies endpoint" {
    export STUB_GH_MUTATIONS="$TEST_TEMP_DIR/mutations.log"
    run provider_prs_thread_reply org/repo 33 555 "reply text"
    assert_success
    grep -q "POST" "$STUB_GH_MUTATIONS"
    grep -q "/repos/org/repo/pulls/33/comments/555/replies" "$STUB_GH_MUTATIONS"
}




@test "prs view: bare number first arg is the number, not a repo (regex guard)" {
    gh_calls_reset
    provider_prs_view "42" --json url
    gh_last_call_equals "pr view 42 --json url"
}

@test "prs view: repo-first shape unchanged (guard regression guard)" {
    gh_calls_reset
    provider_prs_view "org/repo" "42" --json url
    gh_last_call_equals "pr view 42 --json url -R org/repo"
}

@test "thread resolve: variables-based mutation, emits isResolved" {
    gh_calls_reset
    run provider_prs_thread_resolve "PRRT_kwDOAbc123"
    [ "$status" -eq 0 ] || echo "output: $output"
    gh_calls_contain "graphql -f query=mutation(\$threadId: ID!)"
    gh_calls_contain "threadId=PRRT_kwDOAbc123"
}

@test "thread resolve: empty thread id fails defined" {
    run provider_prs_thread_resolve ""
    [ "$status" -ne 0 ]
    [[ "$output" == *"required"* ]]
}

@test "thread reply: repo/pr/comment/body validated, POST emitted" {
    gh_calls_reset
    provider_prs_thread_reply "org/repo" "9" "555" "reply body" >/dev/null
    gh_last_call_equals "api -X POST /repos/org/repo/pulls/9/comments/555/replies -f body=reply body"
}

@test "thread reply: malformed repo fails defined" {
    run provider_prs_thread_reply "norepo" "9" "555" "body"
    [ "$status" -ne 0 ]
}

@test "threads page: builds owner/repo/pr variables; cursor optional" {
    gh_calls_reset
    provider_prs_threads_page "org/repo" "9" "CUR1" >/dev/null
    gh_calls_contain "graphql -f query=query(\$owner: String!"
    gh_calls_contain "-f owner=org"
    gh_calls_contain "-f repo=repo"
    gh_calls_contain "-F pr=9"
    gh_calls_contain "-f cursor=CUR1"
}

@test "threads page: numeric pr enforced" {
    run provider_prs_threads_page "org/repo" "abc"
    [ "$status" -ne 0 ]
}
