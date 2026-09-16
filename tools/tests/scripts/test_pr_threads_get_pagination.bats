#!/usr/bin/env bats
# Pagination behavior tests for pr-threads-get (Plan-002 task 4.1 / AC-6).
#
# Drives the script's manual GraphQL pagination loop through the paginated gh
# fixture: multi-page traversal merges both pages' threads; a single page
# short-circuits with exactly one gh call; a gh failure mid-pagination
# surfaces non-zero (EXIT_GENERAL_ERROR class, since the loop treats an empty
# response as fatal).

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

# Build a GraphQL response page with one thread and the given pageInfo.
# Usage: make_page <thread_id> <has_next:bool> <cursor:str|null>
make_page() {
    local thread_id="$1" has_next="$2" cursor="$3"
    cat << EOF
{"data":{"repository":{"pullRequest":{"reviewThreads":{
    "pageInfo":{"hasNextPage":$has_next,"endCursor":$cursor},
    "nodes":[{"id":"$thread_id","isResolved":false,"path":"src/a.ts","line":10,
              "startLine":10,"diffSide":"RIGHT",
              "comments":{"nodes":[{"id":"c_$thread_id","databaseId":42,
                                    "author":{"login":"reviewer"},
                                    "body":"fix this","createdAt":"2026-01-01T00:00:00Z",
                                    "url":"https://example.invalid/c/42"}]}}]
}}}}}
EOF
}

setup() {
    test_helper_setup
    stub_gh

    # Recording stub for gh is already provided by the fixture; the script
    # resolves the repo spec via get_repo_spec, so pin it via GITHUB_REPO.
    export GITHUB_REPO="test-org/test-repo"

    # Count only pagination invocations, not the `gh auth status` preflight
    # that ensure_gh_login performs.
    api_call_count() {
        grep -c "^gh api graphql" "$STUB_CALL_LOG" 2>/dev/null || true
    }
    export -f api_call_count

    # check_target_repo requires a real git repo (git rev-parse must pass),
    # so run from a real temp repo; the gh stub keeps the API hermetic.
    TEST_REPO=$(mktemp -d)
    git init -q "$TEST_REPO"
    cd "$TEST_REPO"
}

teardown() {
    cd "$ORIGINAL_PWD" 2>/dev/null || true
    [ -n "${TEST_REPO:-}" ] && rm -rf "$TEST_REPO"
}

@test "pagination: multi-page traversal merges all pages' threads" {
    local p1="$TEST_TEMP_DIR/p1.json" p2="$TEST_TEMP_DIR/p2.json"
    make_page "T1" true '"CURSOR_1"' > "$p1"
    make_page "T2" false "null" > "$p2"
    printf '%s\n%s\n' "$p1" "$p2" > "$TEST_TEMP_DIR/pages.txt"
    export STUB_GH_PAGES="$TEST_TEMP_DIR/pages.txt"

    run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" 42
    [ "$status" -eq 0 ]
    [[ "$output" == *'"id":"T1"'* ]]
    [[ "$output" == *'"id":"T2"'* ]]
    # Two pagination calls (the auth preflight is excluded from the count)
    [ "$(api_call_count)" -eq 2 ]
    # Second call carried the cursor from page 1
    stub_calls_contain 'cursor=CURSOR_1'
}

@test "pagination: single page short-circuits with exactly one gh call" {
    local p1="$TEST_TEMP_DIR/p1.json"
    make_page "T1" false "null" > "$p1"
    printf '%s\n' "$p1" > "$TEST_TEMP_DIR/pages.txt"
    export STUB_GH_PAGES="$TEST_TEMP_DIR/pages.txt"

    run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" 42
    [ "$status" -eq 0 ]
    [[ "$output" == *'"id":"T1"'* ]]
    [ "$(api_call_count)" -eq 1 ]
    # No cursor was sent on the only call
    ! stub_calls_contain 'cursor='
}

@test "pagination: mid-pagination gh failure exits non-zero" {
    # Page 1 says more pages exist; the stub queue then exhausts and fails,
    # which the script must surface as a non-zero exit, not silently return
    # a truncated result.
    local p1="$TEST_TEMP_DIR/p1.json"
    make_page "T1" true '"CURSOR_1"' > "$p1"
    printf '%s\n' "$p1" > "$TEST_TEMP_DIR/pages.txt"
    export STUB_GH_PAGES="$TEST_TEMP_DIR/pages.txt"

    run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" 42
    [ "$status" -ne 0 ]
}

@test "pagination: unresolved-only filter drops resolved threads" {
    local p1="$TEST_TEMP_DIR/p1.json"
    cat > "$p1" << 'EOF'
{"data":{"repository":{"pullRequest":{"reviewThreads":{
    "pageInfo":{"hasNextPage":false,"endCursor":null},
    "nodes":[{"id":"T_RESOLVED","isResolved":true,"path":"src/a.ts","line":10,
              "startLine":10,"diffSide":"RIGHT","comments":{"nodes":[]}},
             {"id":"T_OPEN","isResolved":false,"path":"src/b.ts","line":20,
              "startLine":20,"diffSide":"RIGHT","comments":{"nodes":[]}}]
}}}}}
EOF
    printf '%s\n' "$p1" > "$TEST_TEMP_DIR/pages.txt"
    export STUB_GH_PAGES="$TEST_TEMP_DIR/pages.txt"

    run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" 42
    [ "$status" -eq 0 ]
    [[ "$output" == *'"id":"T_OPEN"'* ]]
    ! grep -q "T_RESOLVED" <<< "$output"

    # Re-fill the queue (the first run consumed the page), then --all keeps
    # both threads.
    printf '%s\n' "$p1" > "$TEST_TEMP_DIR/pages.txt"
    run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" --all 42
    [ "$status" -eq 0 ]
    [[ "$output" == *'"id":"T_RESOLVED"'* ]]
    [[ "$output" == *'"id":"T_OPEN"'* ]]
}
