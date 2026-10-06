#!/usr/bin/env bats
# Tests for scripts/pr-list.sh: what it actually hands to the provider CLI.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/pr-list.sh"

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin"
    export GH_CALL_LOG="$TEST_TEMP_DIR/gh.log"; : > "$GH_CALL_LOG"
    # Records every call; `gh pr list` rejects a stray positional the way the real CLI
    # does ("accepts 0 arg(s), received N"), and prints an empty JSON list otherwise.
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$GH_CALL_LOG"
[ "$1" = auth ] && exit 0
if [ "$1" = pr ] && [ "$2" = list ]; then
    shift 2
    positional=0
    while [ $# -gt 0 ]; do
        case "$1" in
            -R|--repo|--state|--limit|--author|--label|--base|--head|--json|--jq|-q|--search) shift 2 ;;
            -*) shift ;;
            *) positional=$((positional + 1)); shift ;;
        esac
    done
    if [ "$positional" -gt 0 ]; then
        echo "accepts 0 arg(s), received $positional" >&2
        exit 1
    fi
    echo '[]'
    exit 0
fi
exit 0
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export DEVENV_REPO="acme/widgets"
}

teardown() {
    test_helper_teardown
}

@test "pr-list.sh has valid bash syntax" {
    run bash -n "$SCRIPT"
    [ "$status" -eq 0 ]
}

@test "pr-list passes the repo exactly once (a doubled positional makes gh pr list fail)" {
    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [ "$output" = "[]" ]
    call="$(grep '^gh pr list' "$GH_CALL_LOG" | head -1)"
    [ "$(grep -o 'acme/widgets' <<<"$call" | wc -l)" -eq 1 ]
}

@test "pr-list forwards the filters it was given" {
    run bash "$SCRIPT" --state merged --limit 5 --head feature/x
    [ "$status" -eq 0 ]
    call="$(grep '^gh pr list' "$GH_CALL_LOG" | head -1)"
    [[ "$call" == *"--state merged"* && "$call" == *"--limit 5"* && "$call" == *"--head feature/x"* ]]
}

@test "pr-list reports a provider failure with the API-failure exit code" {
    printf '#!/usr/bin/env bash\n[ "$1" = auth ] && exit 0\nexit 1\n' > "$TEST_TEMP_DIR/bin/gh"
    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
}
