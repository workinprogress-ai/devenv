#!/usr/bin/env bats
# A gh failure must reach the caller. `gh ... | jq` returns jq's status, so an auth or
# network failure used to read as an empty-but-successful answer; and a GraphQL page
# cap that truncates silently makes a partial answer look complete.

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
if [ -n "${GH_FAIL:-}" ]; then echo "HTTP 401: bad credentials" >&2; exit 1; fi
cat "$GH_RESPONSE"
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
}

teardown() {
    test_helper_teardown
}

# gh_verb <function> [args]: run one github provider verb with the capabilities declared
gh_verb() {
    run bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=github
        source '$DEVENV_TOOLS/lib/providers/github/repos.bash'
        source '$DEVENV_TOOLS/lib/providers/github/issues.bash'
        source '$DEVENV_TOOLS/lib/providers/github/org.bash'
        source '$DEVENV_TOOLS/lib/providers/github/projects.bash'
        source '$DEVENV_TOOLS/lib/providers/github/prs.bash'
        \"\$@\"
    " _ "$@"
}

@test "provider_org_issue_types fails when gh fails, instead of returning an empty list" {
    GH_FAIL=1 gh_verb provider_org_issue_types some-org
    [ "$status" -ne 0 ]
}

@test "provider_org_issue_types fails on a GraphQL error payload" {
    printf '{"errors":[{"message":"Could not resolve to an Organization"}]}' > "$GH_RESPONSE"
    gh_verb provider_org_issue_types some-org
    [ "$status" -ne 0 ]
    [[ "$output" == *"Could not resolve"* ]]
}

@test "provider_org_issue_types maps the types it is given" {
    printf '{"data":{"organization":{"issueTypes":{"edges":[{"node":{"id":"T1","name":"Bug"}},{"node":{"id":"T2","name":"Task"}}],"pageInfo":{"hasNextPage":false}}}}}' > "$GH_RESPONSE"
    gh_verb provider_org_issue_types some-org
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].name]' <<< "$output")" = '["Bug","Task"]' ]
}

@test "provider_org_issue_types warns when the 100-type page cap truncated the list" {
    printf '{"data":{"organization":{"issueTypes":{"edges":[{"node":{"id":"T1","name":"Bug"}}],"pageInfo":{"hasNextPage":true}}}}}' > "$GH_RESPONSE"
    gh_verb provider_org_issue_types some-org
    [ "$status" -eq 0 ]
    [[ "$output" == *"more than 100"* ]]
}

@test "fetch_org_issue_type_ids fails when the type lookup fails" {
    run env GH_FAIL=1 bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=github
        source '$DEVENV_TOOLS/lib/providers/github/repos.bash'
        source '$DEVENV_TOOLS/lib/providers/github/issues.bash'
        source '$DEVENV_TOOLS/lib/providers/github/org.bash'
        source '$DEVENV_TOOLS/lib/issues-config.bash'
        fetch_org_issue_type_ids some-org
    "
    [ "$status" -ne 0 ]
}

@test "provider_projects_for_issue warns when the issue's project list hit its page cap" {
    printf '{"data":{"resource":{"projectItems":{"pageInfo":{"hasNextPage":true},"nodes":[{"project":{"id":"P","number":1,"title":"Board","owner":{"login":"acme"}},"fieldValues":{"pageInfo":{"hasNextPage":false},"nodes":[]}}]}}}}' > "$GH_RESPONSE"
    gh_verb provider_projects_for_issue https://github.com/acme/r/issues/1 acme
    [ "$status" -eq 0 ]
    [[ "$output" == *"more projects than the query returns"* ]]
}

@test "provider_projects_for_issue warns when an item's field values hit their page cap" {
    printf '{"data":{"resource":{"projectItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"project":{"id":"P","number":1,"title":"Board","owner":{"login":"acme"}},"fieldValues":{"pageInfo":{"hasNextPage":true},"nodes":[]}}]}}}}' > "$GH_RESPONSE"
    gh_verb provider_projects_for_issue https://github.com/acme/r/issues/1 acme
    [[ "$output" == *"more field values than the query returns"* ]]
}

@test "provider_projects_for_issue fails on a GraphQL error payload" {
    printf '{"errors":[{"message":"Resource not accessible"}]}' > "$GH_RESPONSE"
    gh_verb provider_projects_for_issue https://github.com/acme/r/issues/1 acme
    [ "$status" -ne 0 ]
}

@test "provider_projects_for_issue still lists each project with its Status" {
    printf '{"data":{"resource":{"projectItems":{"pageInfo":{"hasNextPage":false},"nodes":[{"project":{"id":"P","number":7,"title":"Board","owner":{"login":"acme"}},"fieldValues":{"pageInfo":{"hasNextPage":false},"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Review","field":{"name":"Status"}}]}}]}}}}' > "$GH_RESPONSE"
    gh_verb provider_projects_for_issue https://github.com/acme/r/issues/1 acme
    [ "$status" -eq 0 ]
    [ "$output" = "$(printf 'Board\t7\tReview')" ]
}

@test "provider_prs_threads_page warns when a thread has more comments than the query returns" {
    printf '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"T1","comments":{"pageInfo":{"hasNextPage":true},"nodes":[]}}]}}}}}' > "$GH_RESPONSE"
    gh_verb provider_prs_threads_page acme/r 5
    [ "$status" -eq 0 ]
    [[ "$output" == *"more comments than the query returns"* ]]
}

@test "provider_prs_threads_page fails when gh fails" {
    GH_FAIL=1 gh_verb provider_prs_threads_page acme/r 5
    [ "$status" -ne 0 ]
}
