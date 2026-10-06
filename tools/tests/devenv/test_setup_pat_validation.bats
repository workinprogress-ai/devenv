#!/usr/bin/env bats
# setup: the GitHub PAT is validated against the provider API (one /user call per
# attempt), not just by its prefix. The provider API is a stubbed curl; nothing
# here touches the network or any other provider's validation.

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
    awk '/^validate_github_pat\(\) \{/ {p=1} p {print} p && /^}/ {exit}' "$PROJECT_ROOT/setup" > "$TEST_TEMP_DIR/fn.bash"
}

teardown() {
    test_helper_teardown
}

run_validate() {
    # run_validate <stdin text>: runs validate_github_pat with the stub curl first on PATH
    printf '%b' "$1" | PATH="$TEST_TEMP_DIR/bin:$PATH" SETUP_DIR="$SETUP_DIR" \
        timeout 20 bash -c "source '$TEST_TEMP_DIR/fn.bash'; validate_github_pat"
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
