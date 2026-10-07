#!/usr/bin/env bats
# The gh argv the pipelines wrappers produce: the flags a user passes must reach gh,
# and the repository must be named exactly once.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin"
    export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$GH_CALL_LOG"
[ "$1" = auth ] && exit 0
case "$*" in
    *"--json url"*) echo "https://example.invalid/run/123" ;;
esac
exit 0
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

teardown() {
    test_helper_teardown
}

rerun_call() { grep -m1 'gh run rerun' "$GH_CALL_LOG"; }

@test "pipelines-rerun --failed --debug reaches gh run rerun" {
    run bash "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh" 123 --repo acme/widgets --failed --debug
    [ "$status" -eq 0 ]
    local call; call="$(rerun_call)"
    [[ "$call" == *"--failed"* ]]
    [[ "$call" == *"-d"* ]]
}

@test "pipelines-rerun names the repository once, not twice" {
    run bash "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh" 123 --repo acme/widgets --failed
    [ "$status" -eq 0 ]
    local call; call="$(rerun_call)"
    [ "$(grep -o -- '-R acme/widgets' <<< "$call" | wc -l)" -eq 1 ]
}

@test "pipelines-rerun without flags reruns the whole run" {
    run bash "$PROJECT_ROOT/tools/scripts/pipelines-rerun.sh" 123 --repo acme/widgets
    [ "$status" -eq 0 ]
    local call; call="$(rerun_call)"
    [[ "$call" != *"--failed"* ]]
}
