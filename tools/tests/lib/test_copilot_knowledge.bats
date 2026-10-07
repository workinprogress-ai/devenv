#!/usr/bin/env bats
# copilot-knowledge.bash: the background fast-forward sync must authenticate the way
# the active provider expects (the header shape differs: GitHub vs Azure).

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin" "$TEST_TEMP_DIR/repo/.git"
    export GIT_ARGS_LOG="$TEST_TEMP_DIR/git-args.log"; : > "$GIT_ARGS_LOG"
    # nohup runs its command synchronously here so the test can read what git received.
    printf '#!/usr/bin/env bash\nexec "$@"\n' > "$TEST_TEMP_DIR/bin/nohup"
    printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "$GIT_ARGS_LOG"\nexit 0\n' > "$TEST_TEMP_DIR/bin/git"
    chmod +x "$TEST_TEMP_DIR/bin/nohup" "$TEST_TEMP_DIR/bin/git"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
}

teardown() {
    test_helper_teardown
}

# run_sync <provider-config-block>: sources the library under that config, fakes the
# token, and runs one background-style sync of $TEST_TEMP_DIR/repo.
run_sync() {
    printf '%b' "$1" > "$DEVENV_ROOT/devenv.config"
    bash -c "
        export DEVENV_ROOT='$DEVENV_ROOT' DEVENV_ROOT_SET=1
        source '$DEVENV_TOOLS/lib/copilot-knowledge.bash'
        provider_secret_get() { echo sekret; }
        pull_copilot_side_repo_on_container_start '$TEST_TEMP_DIR/repo' x
        wait
    "
}

@test "github provider: the sync authenticates with the GitHub basic-auth header" {
    run_sync '[organization]\nname=t\norg=acme\n'
    expected="$(printf 'x-access-token:sekret' | base64 -w0)"
    grep -q "AUTHORIZATION: basic $expected" "$GIT_ARGS_LOG"
}

@test "azure provider: the sync authenticates with the Azure PAT basic-auth header, not the GitHub one" {
    run_sync '[organization]\nname=t\norg=acme\n[provider]\nname=azure\nazure_org=acme\nazure_project=proj\n'
    azure="$(printf ':sekret' | base64 -w0)"
    github="$(printf 'x-access-token:sekret' | base64 -w0)"
    grep -q "AUTHORIZATION: Basic $azure" "$GIT_ARGS_LOG"
    run grep -F "$github" "$GIT_ARGS_LOG"
    [ "$status" -ne 0 ]
}
