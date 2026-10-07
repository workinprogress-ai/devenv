#!/usr/bin/env bats
# GitHub verbs speak the seam's field names, not gh's: repoSpec for a repository's
# nameWithOwner, id for a run's databaseId, url for a comment's html_url. The verb maps
# the names on the way to gh, renames them on the way back, and applies any -q program
# to the neutral records.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin"
    export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
    export GH_RESPONSE="$TEST_TEMP_DIR/response.json"; : > "$GH_RESPONSE"
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$GH_CALL_LOG"
cat "$GH_RESPONSE"
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
}

teardown() {
    test_helper_teardown
}

gh_verb() {
    run bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=github
        source '$DEVENV_TOOLS/lib/providers/github/repos.bash'
        source '$DEVENV_TOOLS/lib/providers/github/issues.bash'
        source '$DEVENV_TOOLS/lib/providers/github/prs.bash'
        source '$DEVENV_TOOLS/lib/providers/github/pipelines.bash'
        \"\$@\"
    " _ "$@"
}

# ---------------------------------------------------------------------------
# repoSpec <-> nameWithOwner
# ---------------------------------------------------------------------------

@test "repos view --json repoSpec asks gh for nameWithOwner and returns repoSpec" {
    printf '{"nameWithOwner":"acme/widgets","name":"widgets"}' > "$GH_RESPONSE"
    gh_verb provider_repos_view acme/widgets --json repoSpec,name
    [ "$status" -eq 0 ]
    grep -q -- '--json nameWithOwner,name' "$GH_CALL_LOG"
    [ "$(jq -c . <<< "$output")" = '{"repoSpec":"acme/widgets","name":"widgets"}' ]
}

@test "repos view -q applies to the neutral record: .repoSpec" {
    printf '{"nameWithOwner":"acme/widgets"}' > "$GH_RESPONSE"
    gh_verb provider_repos_view acme/widgets --json repoSpec -q .repoSpec
    [ "$status" -eq 0 ]
    [ "$output" = "acme/widgets" ]
}

@test "repos list maps repoSpec in every record" {
    printf '[{"nameWithOwner":"acme/a"},{"nameWithOwner":"acme/b"}]' > "$GH_RESPONSE"
    gh_verb provider_repos_list acme --limit 10 --json repoSpec -q '.[].repoSpec'
    [ "$status" -eq 0 ]
    [ "$output" = "$(printf 'acme/a\nacme/b')" ]
    grep -q -- '--json nameWithOwner' "$GH_CALL_LOG"
}

@test "repos view without --json passes straight through to gh" {
    printf 'plain text view' > "$GH_RESPONSE"
    gh_verb provider_repos_view acme/widgets
    [ "$status" -eq 0 ]
    [ "$output" = "plain text view" ]
}

# ---------------------------------------------------------------------------
# id <-> databaseId (runs)
# ---------------------------------------------------------------------------

@test "run list --json id asks gh for databaseId and returns id" {
    printf '[{"databaseId":9001,"status":"completed"}]' > "$GH_RESPONSE"
    gh_verb provider_pipelines_run_list acme/widgets --branch main --json id,status
    [ "$status" -eq 0 ]
    grep -q -- '--json databaseId,status' "$GH_CALL_LOG"
    [ "$(jq -c . <<< "$output")" = '[{"id":9001,"status":"completed"}]' ]
}

@test "run list -q applies to the neutral records: .[0].id" {
    printf '[{"databaseId":9001},{"databaseId":9000}]' > "$GH_RESPONSE"
    gh_verb provider_pipelines_run_list acme/widgets --json id -q '.[0].id'
    [ "$status" -eq 0 ]
    [ "$output" = "9001" ]
}

@test "run list keeps gh's other fields and the status filter flags" {
    printf '[]' > "$GH_RESPONSE"
    gh_verb provider_pipelines_run_list acme/widgets --branch main --limit 5 --json id,status,conclusion
    [ "$status" -eq 0 ]
    grep -q -- '--branch main' "$GH_CALL_LOG"
    grep -q -- '--limit 5' "$GH_CALL_LOG"
}

@test "run view --json id maps too" {
    printf '{"databaseId":9001,"url":"https://github.com/acme/widgets/actions/runs/9001"}' > "$GH_RESPONSE"
    gh_verb provider_pipelines_run_view acme/widgets 9001 --json id,url -q .id
    [ "$status" -eq 0 ]
    [ "$output" = "9001" ]
    grep -q -- '--json databaseId,url' "$GH_CALL_LOG"
}

# ---------------------------------------------------------------------------
# url <-> html_url (comments)
# ---------------------------------------------------------------------------

@test "comment_get returns the comment's web address as url, not html_url" {
    printf '{"id":911,"html_url":"https://github.com/o/r/issues/1#issuecomment-911","url":"https://api.github.com/x","body":"x"}' > "$GH_RESPONSE"
    gh_verb provider_issues_comment_get o/r 911
    [ "$status" -eq 0 ]
    [ "$(jq -r '.url' <<< "$output")" = "https://github.com/o/r/issues/1#issuecomment-911" ]
    [ "$(jq 'has("html_url")' <<< "$output")" = "false" ]
}

@test "comment_add and comment_edit return url too" {
    printf '{"id":1,"html_url":"https://github.com/o/r/issues/1#issuecomment-1"}' > "$GH_RESPONSE"
    gh_verb provider_issues_comment_add o/r 1 --body hi
    [ "$(jq -r '.url' <<< "$output")" = "https://github.com/o/r/issues/1#issuecomment-1" ]
    gh_verb provider_issues_comment_edit o/r 1 --body hi
    [ "$(jq -r '.url' <<< "$output")" = "https://github.com/o/r/issues/1#issuecomment-1" ]
}

@test "comments (the list) maps every record" {
    printf '[{"id":1,"html_url":"https://x/1"},{"id":2,"html_url":"https://x/2"}]' > "$GH_RESPONSE"
    gh_verb provider_issues_comments "" 7 o/r
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].url]' <<< "$output")" = '["https://x/1","https://x/2"]' ]
}

@test "a paginated comments list (several arrays) is mapped array by array" {
    printf '[{"id":1,"html_url":"https://x/1"}][{"id":2,"html_url":"https://x/2"}]' > "$GH_RESPONSE"
    gh_verb provider_issues_comments "" 7 o/r
    [ "$status" -eq 0 ]
    [ "$(jq -sc '[.[][].url]' <<< "$output")" = '["https://x/1","https://x/2"]' ]
}

@test "thread_reply returns url" {
    printf '{"id":5,"html_url":"https://github.com/o/r/pull/1#discussion_r5"}' > "$GH_RESPONSE"
    gh_verb provider_prs_thread_reply o/r 1 99 hello
    [ "$status" -eq 0 ]
    [ "$(jq -r '.url' <<< "$output")" = "https://github.com/o/r/pull/1#discussion_r5" ]
}

# ---------------------------------------------------------------------------
# comment id and node id in a review-thread page
# ---------------------------------------------------------------------------

@test "threads page: a comment's id is the reply id (databaseId) and nodeId the GraphQL node id" {
    printf '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"T1","isResolved":false,"comments":{"nodes":[{"id":"PRRC_node","databaseId":42,"body":"b","author":{"login":"a"}}]}}]}}}}}' > "$GH_RESPONSE"
    gh_verb provider_prs_threads_page acme/r 5
    [ "$status" -eq 0 ]
    jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0] | .id == 42 and .nodeId == "PRRC_node" and (has("databaseId") | not)' <<< "$output" >/dev/null
    # the thread's own id is untouched: pr-thread-resolve takes it
    [ "$(jq -r '.data.repository.pullRequest.reviewThreads.nodes[0].id' <<< "$output")" = "T1" ]
}
