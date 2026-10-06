#!/usr/bin/env bats
# scripts/pr-thread-reply.sh: how the repo spec reaches the provider verb.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/pr-thread-reply.sh"

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin"
    export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
    # gh stand-in: auth succeeds; the reply POST is logged and answers with a URL.
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$GH_CALL_LOG"
[ "$1" = auth ] && exit 0
echo '{"html_url":"https://example.invalid/reply/1"}'
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

teardown() {
    test_helper_teardown
}

reply_api_path() {   # the REST path the reply was POSTed to
    grep -m1 'api -X POST' "$GH_CALL_LOG" | grep -oE '/repos/[^ ]+'
}

@test "pr-thread-reply.sh has valid bash syntax" {
    run bash -n "$SCRIPT"
    [ "$status" -eq 0 ]
}

@test "a two-part owner/repo spec posts to that repo" {
    DEVENV_REPO="acme/widgets" run bash "$SCRIPT" 7 --comment-id 99 --body "hi"
    [ "$status" -eq 0 ]
    [ "$(reply_api_path)" = "/repos/acme/widgets/pulls/7/comments/99/replies" ]
}

# An azure-shaped org/project/repo spec: the old capture regex took the first TWO
# components (org/project) and dropped the repo, so the reply went to the project
# name as if it were the repository.
@test "a three-part org/project/repo spec keeps the repo component (not org/project)" {
    DEVENV_REPO="acme/proj/widgets" run bash "$SCRIPT" 7 --comment-id 99 --body "hi"
    [ "$status" -eq 0 ]
    path="$(reply_api_path)"
    [[ "$path" == /repos/acme/widgets/* ]]
    [[ "$path" != /repos/acme/proj/* ]]
}

@test "the legacy -R spec form is still understood" {
    DEVENV_REPO="-R acme/widgets" run bash "$SCRIPT" 7 --comment-id 99 --body "hi"
    [ "$status" -eq 0 ]
    [ "$(reply_api_path)" = "/repos/acme/widgets/pulls/7/comments/99/replies" ]
}
