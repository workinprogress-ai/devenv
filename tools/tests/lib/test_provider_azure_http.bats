#!/usr/bin/env bats
# Tests for lib/providers/azure/http.bash — the Azure DevOps REST transport.
#
# All tests run through the stub_curl fixture (PATH-shadowed curl); no test
# touches the network. Assertions lock the transport contract: Basic-auth
# header form, api-version injection, ContinuationToken pagination,
# 429/Retry-After and 5xx retry, malformed-JSON typing, and token redaction.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export STUB_CALL_LOG
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    stub_curl
    export AZURE_PAT="test-pat-secret-12345"
    AZURE_HTTP_LIB="$DEVENV_TOOLS/lib/providers/azure/http.bash"
}

teardown() {
    unset AZURE_PAT
    test_helper_teardown
}

@test "azure-http: library sources cleanly" {
    run bash -c "source '$AZURE_HTTP_LIB' && echo loaded"
    [ "$status" -eq 0 ]
    [[ "$output" == "loaded" ]]
}

@test "azure-http: request sends Basic auth via Authorization header (PAT never in argv or URL)" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/resp.json"
    cat > "$STUB_BIN_DIR/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$TEST_TEMP_DIR/curl-argv.log"
# Emit a minimal 200 into the -D headers file so the transport succeeds.
prev=""
for arg in "$@"; do
    if [[ "$prev" == "-D" ]]; then
        printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    fi
    prev="$arg"
done
exit 0
EOF
    chmod +x "$STUB_BIN_DIR/curl"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        bash -c "source '$AZURE_HTTP_LIB' && azure_http_request GET 'https://dev.azure.com/org/proj/_apis/test'" > /dev/null
    # The PAT itself never appears in any curl argument (process listings)
    ! grep -q "test-pat-secret" "$TEST_TEMP_DIR/curl-argv.log"
    # Auth travels as an Authorization: Basic header built off-argv
    local expected_b64
    expected_b64=$(printf ':%s' "$AZURE_PAT" | base64 | tr -d '\r\n')
    grep -q "Authorization: Basic $expected_b64" "$TEST_TEMP_DIR/curl-argv.log"
}

@test "azure-http: request injects api-version=7.1" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/resp.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_request GET 'https://dev.azure.com/org/proj/_apis/test'"
    [ "$status" -eq 0 ]
    grep -q "api-version=7.1" "$STUB_CALL_LOG"
}

@test "azure-http: request appends api-version with & when URL has a query" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/resp.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_request GET 'https://dev.azure.com/org/proj/_apis/test?\$top=10'"
    [ "$status" -eq 0 ]
    grep -q 'api-version=7.1' "$STUB_CALL_LOG"
    grep -q 'top=10' "$STUB_CALL_LOG"
}

@test "azure-http: URL-pinned api-version (preview resources) is passed through untouched" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/resp.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_request GET 'https://dev.azure.com/org/proj/_apis/wit/workitems/1/comments?api-version=7.1-preview.3'"
    [ "$status" -eq 0 ]
    grep -q 'api-version=7.1-preview.3' "$STUB_CALL_LOG"
    # Exactly one api-version on the wire — the default must not be appended.
    [ "$(grep -o 'api-version=' "$STUB_CALL_LOG" | wc -l)" -eq 1 ]
}

@test "azure-http: request without credentials fails typed, no call made" {
    run bash -c "unset AZURE_PAT; source '$AZURE_HTTP_LIB' && AZURE_PAT_FILE=/nonexistent/no-pat-file azure_http_request GET 'https://dev.azure.com/org/_apis/test'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "no-credentials" ]]
    [[ "$output" =~ "key-update-azure" ]]
    # Failed before any transport call
    [ "$(grep -c 'curl ' "$STUB_CALL_LOG")" -eq 0 ]
}

@test "azure-http: empty AZURE_PAT self-heals via the neutral seam (PAT file)" {
    # Shared wrappers set no provider env; the transport resolves the
    # credential itself through provider_secret_get (auth file → env).
    printf 'file-resolved-pat-abc\n' > "$TEST_TEMP_DIR/pat-file"
    chmod 600 "$TEST_TEMP_DIR/pat-file"
    printf '{"value":[]}' > "$TEST_TEMP_DIR/resp.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run bash -c "unset AZURE_PAT; source '$AZURE_HTTP_LIB' && AZURE_PAT_FILE='$TEST_TEMP_DIR/pat-file' azure_http_request GET 'https://dev.azure.com/org/_apis/test'"
    [ "$status" -eq 0 ]
    # The request reached the transport (seam resolved a credential)
    [ "$(grep -c 'curl ' "$STUB_CALL_LOG")" -eq 1 ]
}

@test "azure-http: paginate self-heals the credential seam too" {
    printf 'file-resolved-pat-abc\n' > "$TEST_TEMP_DIR/pat-file"
    chmod 600 "$TEST_TEMP_DIR/pat-file"
    printf '{"value":[]}' > "$TEST_TEMP_DIR/empty.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty.json" \
        run bash -c "unset AZURE_PAT; source '$AZURE_HTTP_LIB' && AZURE_PAT_FILE='$TEST_TEMP_DIR/pat-file' azure_http_paginate 'https://dev.azure.com/org/proj/_apis/test'"
    [ "$status" -eq 0 ]
    [ "$(grep -c 'curl ' "$STUB_CALL_LOG")" -eq 1 ]
}

@test "azure-http: paginate without any credential fails typed before calling curl" {
    run bash -c "unset AZURE_PAT; source '$AZURE_HTTP_LIB' && AZURE_PAT_FILE=/nonexistent/no-pat-file azure_http_paginate 'https://dev.azure.com/org/proj/_apis/test'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "no-credentials" ]]
    [ "$(grep -c 'curl ' "$STUB_CALL_LOG")" -eq 0 ]
}

@test "azure-http: non-retryable HTTP error surfaces typed error with message" {
    printf '{"message":"TF401027: permission denied"}' > "$TEST_TEMP_DIR/err.json"
    STUB_CURL_HTTP_CODE=403 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/err.json" \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_request GET 'https://dev.azure.com/org/_apis/test'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ '"code":403' ]]
    [[ "$output" =~ "TF401027" ]]
}

@test "azure-http: malformed JSON body is a typed error" {
    printf 'not json at all' > "$TEST_TEMP_DIR/bad.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/bad.json" \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_request GET 'https://dev.azure.com/org/_apis/test'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "malformed-json" ]]
}

@test "azure-http: transport failure is a typed error after retries" {
    STUB_CURL_FAIL=1 \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_request GET 'https://dev.azure.com/org/_apis/test'"
    [ "$status" -ne 0 ]
    [[ "$output" =~ '"transport"' ]]
    # Retried before giving up: more than one call recorded
    local calls
    calls=$(grep -c "curl " "$STUB_CALL_LOG")
    [ "$calls" -ge 2 ]
}

@test "azure-http: paginate combines ContinuationToken pages into one array" {
    printf '{"value":[{"id":1}]}' > "$TEST_TEMP_DIR/page1.json"
    printf '{"value":[{"id":2},{"id":3}]}' > "$TEST_TEMP_DIR/page2.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/page1.json" "$TEST_TEMP_DIR/page2.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_paginate 'https://dev.azure.com/org/proj/_apis/test'"
    [ "$status" -eq 0 ]
    # Combined output is one array of all items across pages
    local combined
    combined="$output"
    [[ "$(jq -r '. | length' <<< "$combined")" == "3" ]]
    [[ "$(jq -r '.[0].id' <<< "$combined")" == "1" ]]
    [[ "$(jq -r '.[2].id' <<< "$combined")" == "3" ]]
    # Two curl calls recorded (one per page)
    [ "$(grep -c 'curl ' "$STUB_CALL_LOG")" -eq 2 ]
    # Second call carried the continuation token
    grep -q 'continuationToken=' "$STUB_CALL_LOG"
}

@test "azure-http: work-item content type (json-patch+json) reaches curl as a header" {
    # The live Tier-2 run surfaced Azure rejecting application/json on
    # work-item PATCH/POST with a 400 — the transport must forward the
    # caller-selected content type.
    printf '{"id":1}' > "$TEST_TEMP_DIR/ok.json"
    cat > "$STUB_BIN_DIR/curl" <<EOF
#!/usr/bin/env bash
# Record the full argv for the assertion below.
printf '%s\n' "\$@" > "\$TEST_TEMP_DIR/curl-argv.log"
exit 0
EOF
    chmod +x "$STUB_BIN_DIR/curl"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/ok.json" \
        run bash -c "source '$AZURE_HTTP_LIB' && azure_http_request PATCH 'https://dev.azure.com/org/_apis/wit/workitems/1' '[]' 'application/json-patch+json'"
    grep -q "Content-Type: application/json-patch+json" "$TEST_TEMP_DIR/curl-argv.log"
}

@test "azure-http: redaction strips the PAT from logged text" {
    run bash -c "source '$AZURE_HTTP_LIB' && AZURE_PAT='leaky-token-xyz' azure_redact 'error at https://dev.azure.com/org?token=leaky-token-xyz'"
    [ "$status" -eq 0 ]
    ! [[ "$output" =~ "leaky-token-xyz" ]]
    [[ "$output" =~ "REDACTED" ]]
}
