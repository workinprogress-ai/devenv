#!/usr/bin/env bats
# setup: the provider token is checked for shape and validated against the provider
# API (one call per attempt) through the provider's host-side hooks; setup itself
# names no provider. The provider API is a stubbed curl; nothing here touches the
# network.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SETUP_DIR="$TEST_TEMP_DIR/.setup"
    mkdir -p "$SETUP_DIR" "$TEST_TEMP_DIR/bin"
    : > "$TEST_TEMP_DIR/curl.calls"
    : > "$TEST_TEMP_DIR/curl.headers"
    # Stub curl: logs the URL, records any header read from stdin, and answers
    # with the next HTTP status code queued in $TEST_TEMP_DIR/codes.
    cat > "$TEST_TEMP_DIR/bin/curl" <<STUB
#!/usr/bin/env bash
for a in "\$@"; do case "\$a" in https://*) echo "\$a" >> "$TEST_TEMP_DIR/curl.calls" ;; esac; done
[ -t 0 ] || cat >> "$TEST_TEMP_DIR/curl.headers"
code=\$(head -n 1 "$TEST_TEMP_DIR/codes"); sed -i 1d "$TEST_TEMP_DIR/codes"
printf '%s' "\$code"
[ "\$code" != 000 ]
STUB
    chmod +x "$TEST_TEMP_DIR/bin/curl"
    echo "someorg" > "$SETUP_DIR/provider_org.txt"
    # Load only the validation function from the script under test.
    awk '/^validate_provider_token\(\) \{/ {p=1} p {print} p && /^}/ {exit}' "$PROJECT_ROOT/setup" > "$TEST_TEMP_DIR/fn.bash"
}

teardown() {
    test_helper_teardown
}

run_validate() {
    # run_validate <stdin text> [provider]: runs validate_provider_token with the
    # stub curl first on PATH, using the named provider's hooks (default github)
    local prov="${2:-github}"
    printf '%b' "$1" | PATH="$TEST_TEMP_DIR/bin:$PATH" SETUP_DIR="$SETUP_DIR" \
        timeout 20 bash -c "source '$PROJECT_ROOT/tools/lib/providers/$prov/setup.bash'; source '$TEST_TEMP_DIR/fn.bash'; validate_provider_token"
}

@test "a token the API accepts is kept after exactly one /user call" {
    echo ghp_good > "$SETUP_DIR/provider_token.txt"
    echo 200 > "$TEST_TEMP_DIR/codes"
    run run_validate ""
    [ "$status" -eq 0 ]
    [ "$(cat "$SETUP_DIR/provider_token.txt")" = "ghp_good" ]
    [ "$(cat "$TEST_TEMP_DIR/curl.calls")" = "https://api.github.com/user" ]
}

@test "a ghp_ token the API rejects is cleared and re-prompted" {
    echo ghp_revoked > "$SETUP_DIR/provider_token.txt"
    printf '401\n200\n' > "$TEST_TEMP_DIR/codes"
    run run_validate "ghp_fresh\n"
    [ "$status" -eq 0 ]
    [ "$(cat "$SETUP_DIR/provider_token.txt")" = "ghp_fresh" ]
    [ "$(wc -l < "$TEST_TEMP_DIR/curl.calls")" -eq 2 ]
}

@test "the token is sent in a header read from stdin, not on the command line" {
    echo ghp_secret > "$SETUP_DIR/provider_token.txt"
    echo 200 > "$TEST_TEMP_DIR/codes"
    run run_validate ""
    [ "$status" -eq 0 ]
    grep -q "Authorization: Bearer ghp_secret" "$TEST_TEMP_DIR/curl.headers"
}

@test "an unreachable API warns and accepts the prefix-valid token instead of looping" {
    echo ghp_offline > "$SETUP_DIR/provider_token.txt"
    echo 000 > "$TEST_TEMP_DIR/codes"
    run run_validate ""
    [ "$status" -eq 0 ]
    [ "$(cat "$SETUP_DIR/provider_token.txt")" = "ghp_offline" ]
    [[ "$output" == *"Could not verify"* ]]
}

@test "a token without the ghp_ prefix is rejected without an API call" {
    echo notatoken > "$SETUP_DIR/provider_token.txt"
    echo 200 > "$TEST_TEMP_DIR/codes"
    run run_validate "ghp_next\n"
    [ "$status" -eq 0 ]
    [ "$(cat "$SETUP_DIR/provider_token.txt")" = "ghp_next" ]
    [ "$(wc -l < "$TEST_TEMP_DIR/curl.calls")" -eq 1 ]
}

@test "the KNOWN GAP note about unverified tokens is gone" {
    run grep -n "KNOWN GAP" "$PROJECT_ROOT/setup"
    [ "$status" -ne 0 ]
}

@test "azure: a PAT the organization accepts is kept after one connectionData call" {
    echo somepat > "$SETUP_DIR/provider_token.txt"
    echo 200 > "$TEST_TEMP_DIR/codes"
    run run_validate "" azure
    [ "$status" -eq 0 ]
    [ "$(cat "$SETUP_DIR/provider_token.txt")" = "somepat" ]
    [[ "$(cat "$TEST_TEMP_DIR/curl.calls")" == "https://dev.azure.com/someorg/_apis/connectionData"* ]]
}

@test "azure: a 203 sign-in page counts as a rejection and re-prompts" {
    echo badpat > "$SETUP_DIR/provider_token.txt"
    printf '203\n200\n' > "$TEST_TEMP_DIR/codes"
    run run_validate "goodpat\n" azure
    [ "$status" -eq 0 ]
    [ "$(cat "$SETUP_DIR/provider_token.txt")" = "goodpat" ]
    [ "$(wc -l < "$TEST_TEMP_DIR/curl.calls")" -eq 2 ]
}

@test "azure: the PAT travels in a header read from stdin, not on the command line" {
    echo secretpat > "$SETUP_DIR/provider_token.txt"
    echo 200 > "$TEST_TEMP_DIR/codes"
    run run_validate "" azure
    [ "$status" -eq 0 ]
    grep -q "^Authorization: Basic " "$TEST_TEMP_DIR/curl.headers"
    run ! grep -q secretpat "$TEST_TEMP_DIR/curl.calls"
}

@test "azure: an unreachable service warns and keeps the token" {
    echo offlinepat > "$SETUP_DIR/provider_token.txt"
    echo 000 > "$TEST_TEMP_DIR/codes"
    run run_validate "" azure
    [ "$status" -eq 0 ]
    [ "$(cat "$SETUP_DIR/provider_token.txt")" = "offlinepat" ]
    [[ "$output" == *"Could not verify"* ]]
}

@test "the organization is detected from the origin remote by each provider" {
    local repo="$TEST_TEMP_DIR/r"
    git init -q "$repo"
    git -C "$repo" remote add origin git@github.com:gh-org/x.git
    run bash -c "cd '$repo' && source '$PROJECT_ROOT/tools/lib/providers/github/setup.bash' && provider_setup_detect_org"
    [ "$output" = "gh-org" ]
    git -C "$repo" remote set-url origin https://dev.azure.com/az-org/proj/_git/x
    run bash -c "cd '$repo' && source '$PROJECT_ROOT/tools/lib/providers/azure/setup.bash' && provider_setup_detect_org"
    [ "$output" = "az-org" ]
    git -C "$repo" remote set-url origin git@ssh.dev.azure.com:v3/az-org2/proj/x
    run bash -c "cd '$repo' && source '$PROJECT_ROOT/tools/lib/providers/azure/setup.bash' && provider_setup_detect_org"
    [ "$output" = "az-org2" ]
}

@test "setup names no provider: prompts, checks and host steps come from the hooks" {
    run ! grep -inE 'github|ghp_|azure|npm\.pkg' "$PROJECT_ROOT/setup"
}

@test "the github host hook seeds ~/.npmrc once and never replaces an existing token" {
    export HOME="$TEST_TEMP_DIR/home"; mkdir -p "$HOME"
    echo ghp_x > "$SETUP_DIR/provider_token.txt"
    source "$PROJECT_ROOT/tools/lib/providers/github/setup.bash"
    provider_setup_post_hook "$SETUP_DIR" >/dev/null
    grep -q '_authToken=ghp_x' "$HOME/.npmrc"
    echo ghp_y > "$SETUP_DIR/provider_token.txt"
    provider_setup_post_hook "$SETUP_DIR" >/dev/null
    [ "$(grep -c _authToken "$HOME/.npmrc")" -eq 1 ]
}

@test "setup self-heals CRLF line endings from any invocation path, even with spaces in the path" {
    local dir="$TEST_TEMP_DIR/dir with space"
    mkdir -p "$dir"
    { sed -n '1,4p' "$PROJECT_ROOT/setup"; echo 'echo healed-run'; } | sed 's/$/\r/' > "$dir/setup"
    chmod +x "$dir/setup"
    run bash -c "cd '$dir' && bash ./setup"
    [ "$status" -eq 0 ]
    [[ "$output" == *"healed-run"* ]]
    run ! grep -q $'\r' "$dir/setup"
}
