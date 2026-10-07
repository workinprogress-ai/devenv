#!/usr/bin/env bats
# One assertion, both providers: the same verb, called the same way, returns the shape
# the contract names (tools/lib/providers/CONTRACT.md). Each provider's transport is
# stubbed with a response in that host's own shape; the verb maps it to the neutral one.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=proj\n' > "$DEVENV_ROOT/devenv.config"
    export AZURE_PAT="test-pat"
    export GH_RESPONSE="$TEST_TEMP_DIR/gh-response"
    printf '#!/usr/bin/env bash\ncat "$GH_RESPONSE"\n' > "$TEST_TEMP_DIR/gh"
    chmod +x "$TEST_TEMP_DIR/gh"
    stub_curl
    export PATH="$TEST_TEMP_DIR:$STUB_BIN_DIR:$PATH"
    export STUB_CALL_LOG
}

teardown() {
    unset DEVENV_ROOT
    test_helper_teardown
}

# verb_on <provider> <verb> args...: run a verb with that provider's modules loaded
verb_on() {
    local prov="$1"; shift
    run bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=$prov
        provider_load http urls auth repos issues prs pipelines projects org policies releases 2>/dev/null
        \"\$@\"
    " _ "$@"
}

# host_returns <provider> <json>: what the provider's transport answers
host_returns() {
    local prov="$1" json="$2"
    if [ "$prov" = github ]; then
        printf '%s' "$json" > "$GH_RESPONSE"
    else
        printf '%s' "$json" > "$TEST_TEMP_DIR/curl-response"
        export STUB_CURL_RESPONSE="$TEST_TEMP_DIR/curl-response"
    fi
}

@test "repos_view --json repoSpec,name: both providers return {repoSpec, name}" {
    host_returns github '{"nameWithOwner":"acme/widgets","name":"widgets"}'
    verb_on github provider_repos_view acme/widgets --json repoSpec,name
    [ "$status" -eq 0 ]
    [ "$(jq -S -c . <<< "$output")" = '{"name":"widgets","repoSpec":"acme/widgets"}' ]

    host_returns azure '{"name":"widgets","project":{"name":"acme"}}'
    verb_on azure provider_repos_view acme/widgets --json repoSpec,name
    [ "$status" -eq 0 ]
    [ "$(jq -S -c . <<< "$output")" = '{"name":"widgets","repoSpec":"acme/widgets"}' ]
}

@test "run_list --json id,status: both providers return a numeric run id" {
    host_returns github '[{"databaseId":9001,"status":"completed"}]'
    verb_on github provider_pipelines_run_list "" --json id,status
    [ "$status" -eq 0 ]
    [ "$(jq -c '.[0] | [(.id | type), .status]' <<< "$output")" = '["number","completed"]' ]

    host_returns azure '{"value":[{"id":9001,"status":"completed","result":"succeeded","sourceBranch":"refs/heads/main","definition":{"name":"CI"}}]}'
    verb_on azure provider_pipelines_run_list "" --json id,status
    [ "$status" -eq 0 ]
    [ "$(jq -c '.[0] | [(.id | type), .status]' <<< "$output")" = '["number","completed"]' ]
}

@test "run_view -q .id: both providers answer with the run id" {
    host_returns github '{"databaseId":9001}'
    verb_on github provider_pipelines_run_view "" 9001 --json id -q .id
    [ "$status" -eq 0 ]
    [ "$output" = "9001" ]

    host_returns azure '{"id":9001,"status":"completed","sourceBranch":"refs/heads/main","definition":{"name":"CI"}}'
    verb_on azure provider_pipelines_run_view "" 9001 --json id -q .id
    [ "$status" -eq 0 ]
    [ "$output" = "9001" ]
}

@test "a comment record carries id, url and body, and no html_url, on both providers" {
    host_returns github '{"id":7,"html_url":"https://example.test/c/7","body":"hello"}'
    verb_on github provider_issues_comment_get "" 7
    [ "$status" -eq 0 ]
    jq -e '.id == 7 and .url == "https://example.test/c/7" and .body == "hello" and (has("html_url") | not)' <<< "$output" >/dev/null

    host_returns azure '{"comments":[{"id":7,"workItemId":42,"text":"hello"}]}'
    verb_on azure provider_issues_comment_get "" 42/7
    [ "$status" -eq 0 ]
    jq -e '.id == "42/7" and (.url | length) > 0 and .body == "hello" and (has("html_url") | not)' <<< "$output" >/dev/null
}

@test "a review thread page carries each comment's id, nodeId, body and author, on both providers" {
    host_returns github '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"T1","isResolved":false,"path":null,"line":0,"comments":{"nodes":[{"id":"PRRC_n","databaseId":42,"body":"b","author":{"login":"ann"}}]}}]}}}}}'
    verb_on github provider_prs_threads_page acme/widgets 5
    [ "$status" -eq 0 ]
    local gh_shape; gh_shape="$(jq -c '.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0] | [(keys | sort), .body, .author.login]' <<< "$output")"

    host_returns azure '{"value":[{"id":3,"status":"active","isDeleted":false,"threadContext":null,"comments":[{"id":1,"parentCommentId":0,"content":"b","commentType":"text","author":{"displayName":"ann"}}]}]}'
    verb_on azure provider_prs_threads_page acme/widgets 5
    [ "$status" -eq 0 ]
    local az_shape; az_shape="$(jq -c '.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0] | [(keys | sort), .body, .author.login]' <<< "$output")"

    [ "$gh_shape" = "$az_shape" ]
    [ "$gh_shape" = '[["author","body","id","nodeId"],"b","ann"]' ]
}

@test "an issue list record carries the contract's fields on both providers" {
    host_returns github '[{"number":1,"title":"t","state":"OPEN","labels":[{"name":"bug"}],"url":"u"}]'
    verb_on github provider_issues_list "" --json number,title,state,labels,url
    [ "$status" -eq 0 ]
    [ "$(jq -c '.[0] | keys | sort' <<< "$output")" = '["labels","number","state","title","url"]' ]

    # Azure: WIQL first, then the batch
    printf '{"workItems":[{"id":1}]}' > "$TEST_TEMP_DIR/wiql.json"
    printf '{"value":[{"id":1,"url":"https://x/1","fields":{"System.Title":"t","System.State":"Active","System.Tags":"bug"}}]}' > "$TEST_TEMP_DIR/batch.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/wiql.json" "$TEST_TEMP_DIR/batch.json" > "$TEST_TEMP_DIR/queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/queue" verb_on azure provider_issues_list "" --json number,title,state,labels,url
    [ "$status" -eq 0 ]
    [ "$(jq -c '.[0] | keys | sort' <<< "$output")" = '["labels","number","state","title","url"]' ]
    [ "$(jq -c '.[0].labels' <<< "$output")" = '[{"name":"bug"}]' ]
}
