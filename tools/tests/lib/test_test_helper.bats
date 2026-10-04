#!/usr/bin/env bats

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
    unset _PROVIDER_CORE_LOADED PROVIDER_NAME
}

teardown() {
    test_helper_teardown
}

@test "test helper: default provider detection is isolated from the real repo config" {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_detect

    [ "$DEVENV_ROOT" != "$PROJECT_ROOT" ]
    [ "$PROVIDER_NAME" = "github" ]
}

@test "test helper: inherited Azure selection cannot override GitHub fixture URL matching" {
    run env PROVIDER_NAME=azure BATS_TEST_DIRNAME="$BATS_TEST_DIRNAME" bash -c '
        source "$1"
        test_helper_setup
        trap test_helper_teardown EXIT
        source "$PROJECT_ROOT/tools/lib/provider-loader.bash"
        printf "provider=%s\n" "$PROVIDER_NAME"
        printf "%s\n" "https://github.com/test-org/test-repo/pull/1" | provider_extract_url
    ' bash "$PROJECT_ROOT/tools/tests/test_helper.bash"

    [ "$status" -eq 0 ]
    [[ "$output" == *"provider=github"* ]]
    [[ "$output" == *"https://github.com/test-org/test-repo/pull/1"* ]]
}

@test "test helper teardown fails on config mutation without invoking git" {
    local fake_root git_log original_root original_hash original_path
    fake_root="$(mktemp -d)"
    git_log="$fake_root/git.log"
    mkdir -p "$fake_root/bin"
    printf 'before\n' > "$fake_root/devenv.config"
    cat > "$fake_root/bin/git" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GIT_CALL_LOG"
EOF
    chmod +x "$fake_root/bin/git"

    original_root="$PROJECT_ROOT"
    original_hash="$_REAL_CONFIG_HASH"
    original_path="$PATH"
    export PROJECT_ROOT="$fake_root"
    _REAL_CONFIG_HASH="$(md5sum "$fake_root/devenv.config" | cut -d' ' -f1)"
    export _REAL_CONFIG_HASH GIT_CALL_LOG="$git_log" PATH="$fake_root/bin:$PATH"
    printf 'after\n' > "$fake_root/devenv.config"

    run test_helper_teardown

    [ "$status" -ne 0 ]
    [[ "$output" == *"TEST-ISOLATION VIOLATION"* ]]
    [ ! -e "$git_log" ]
    [ "$(cat "$fake_root/devenv.config")" = "after" ]

    export PROJECT_ROOT="$original_root"
    _REAL_CONFIG_HASH="$original_hash"
    export _REAL_CONFIG_HASH PATH="$original_path"
    rm -rf "$fake_root"
}
