#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

# ============================================================================
# azure policies + provisioning verbs that need multi-step transport chains
# (repo-guid resolution → create/translate). Kept in a dedicated file:
# the multi-GET queue harness is order-sensitive and a clean file scope
# keeps sibling-test stub exports from leaking into the queue state.
# ============================================================================

setup() {
    test_helper_setup
    stub_curl
    export STUB_CALL_LOG
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    export AZURE_PAT="test-pat"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=proj\n' > "$DEVENV_ROOT/devenv.config"
}


@test "provider_org_ruleset_create translates pull_request to a policy" {
    printf '{"name":"rs","rules":[{"type":"pull_request","parameters":{"required_approving_review_count":2}}]}' > "$TEST_TEMP_DIR/rs.json"
    printf '{"name":"r4","id":"g4","defaultBranch":"refs/heads/master"}' > "$TEST_TEMP_DIR/r4.json"
    : > "$TEST_TEMP_DIR/rsbody.log"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/policies.bash"
    export STUB_CURL_RESPONSE="$TEST_TEMP_DIR/r4.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/rsbody.log"
    run provider_org_ruleset_create o1/p1/r4 "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    jq -e '.settings.minimumApproverCount == 2' < <(cat "$TEST_TEMP_DIR/rsbody.log") >/dev/null
    # the policy guards the repository's real default branch, not a hard-coded main
    jq -e '.settings.scope[0].refName == "refs/heads/master"' < <(cat "$TEST_TEMP_DIR/rsbody.log") >/dev/null
}

@test "provider_repos_create maps --template to parentRepository" {
    printf '{"name":"t1","id":"tg1"}' > "$TEST_TEMP_DIR/tmpl.json"
    printf '{"name":"r2","id":"g2"}' > "$TEST_TEMP_DIR/created2.json"
    : > "$TEST_TEMP_DIR/crbody2.log"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/tmpl.json" "$TEST_TEMP_DIR/created2.json" > "$TEST_TEMP_DIR/tq.queue"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/policies.bash"
    declare -F provider_repos_create >/dev/null && echo "verb: loaded" >&2
    export STUB_CURL_PAGES="$TEST_TEMP_DIR/tq.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/crbody2.log"
    output=$(provider_repos_create o1/p1/r2 --template o1/p1/t1); rc=$?
    [ "$rc" -eq 0 ]
    jq -e '.parentRepository.id == "tg1"' < <(cat "$TEST_TEMP_DIR/crbody2.log") >/dev/null
}

@test "provider_org_ruleset_create emits the transport error JSON on failure" {
    # Error-contract regression: a rejected policy POST must surface the
    # error JSON (the silent >/dev/null path made 403s look like code bugs).
    printf '{"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":1}}]}' > "$TEST_TEMP_DIR/rs.json"
    printf '{"id":"guid-99","name":"r4","defaultBranch":"refs/heads/main"}' > "$TEST_TEMP_DIR/repo4.json"
    printf '{"error":"http","code":403,"message":"The update is rejected by policy."}' > "$TEST_TEMP_DIR/forbidden.json"
    # NOTE: STUB_CURL_HTTP_CODE is global per invocation — the repo-guid GET
    # would also 403 under it. So serve the guid via the queue FIRST while
    # the code is still 200, then flip: not possible in one call. Instead
    # stub-curl dynamically: 200 for repositories, 403 for policy.
    cat > "$STUB_BIN_DIR/curl" <<'EOF'
#!/usr/bin/env bash
url=""
prev=""
for arg in "$@"; do
    if [[ "$prev" == "-D" ]]; then headers_file="$arg"; fi
    prev="$arg"
done
case "$*" in
    *repositories*)
        printf 'HTTP/1.1 200 OK\r\n\r\n' > "${headers_file:-/dev/null}"
        cat "$REPO4_JSON"
        ;;
    *)
        printf 'HTTP/1.1 403 Forbidden\r\n\r\n' > "${headers_file:-/dev/null}"
        cat "$FORBIDDEN_JSON"
        ;;
esac
exit 0
EOF
    export REPO4_JSON="$TEST_TEMP_DIR/repo4.json" FORBIDDEN_JSON="$TEST_TEMP_DIR/forbidden.json"
    : 
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/policies.bash"
    output=$(provider_org_ruleset_create o1/p1/r4 "$TEST_TEMP_DIR/rs.json" 2>&1) || rc=$?
    [ "${rc:-0}" -ne 0 ]
    [[ "$output" =~ 'rejected by policy' ]]
}

# ---------------------------------------------------------------------------
# Branch choice, create-before-delete, names
# ---------------------------------------------------------------------------

load_policy_libs() {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/policies.bash"
}

@test "azure_ruleset_branches lists every explicit branch, adds the default for a keyword, skips wildcards" {
    load_policy_libs
    local out
    out=$(azure_ruleset_branches '{"conditions":{"ref_name":{"include":["refs/heads/release"]}}}' master 2>/dev/null)
    [ "$out" = "release" ]
    out=$(azure_ruleset_branches '{"conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/release","refs/heads/feature/*"]}}}' master 2>/dev/null)
    [ "$out" = $'main\nrelease' ]
    out=$(azure_ruleset_branches '{"conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"]}}}' master 2>/dev/null)
    [ "$out" = "master" ]
    out=$(azure_ruleset_branches '{"rules":[]}' main 2>/dev/null)
    [ "$out" = "main" ]
}

@test "azure_ruleset_branches: a keyword next to an explicit branch protects both, and a wildcard-only list protects nothing" {
    load_policy_libs
    local out
    out=$(azure_ruleset_branches '{"conditions":{"ref_name":{"include":["~DEFAULT_BRANCH","refs/heads/release"]}}}' master 2>/dev/null)
    [ "$out" = $'release\nmaster' ]
    out=$(azure_ruleset_branches '{"conditions":{"ref_name":{"include":["~ALL","refs/heads/release"]}}}' master 2>/dev/null)
    [ "$out" = $'release\nmaster' ]
    out=$(azure_ruleset_branches '{"conditions":{"ref_name":{"include":["refs/heads/release/*"]}}}' master 2>/dev/null)
    [ -z "$out" ]
    run azure_ruleset_branches '{"conditions":{"ref_name":{"include":["refs/heads/release/*"]}}}' master
    [[ "$output" == *"no single branch to protect"* ]]
}

@test "ruleset_update creates the new policy before deleting the replaced one, and only that reviewers policy" {
    printf '{"rules":[{"type":"pull_request"}]}' > "$TEST_TEMP_DIR/rs.json"
    cat > "$TEST_TEMP_DIR/configs.json" <<'JSON'
{"id":"g4","name":"r4","defaultBranch":"refs/heads/main","value":[
 {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4"}]}},
 {"id":8,"type":{"id":"0609b952-1397-4640-95ec-e00a01b2c241"},"settings":{"scope":[{"repositoryId":"g4"}]}},
 {"id":9,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"other"}]}}]}
JSON
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET; url=""
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
cat "$CONFIGS"
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
    load_policy_libs
    run provider_org_ruleset_update o1/p1/r4 7 "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    local post_line del_line
    post_line=$(grep -n '^POST .*configurations' "$CALLS" | head -1 | cut -d: -f1)
    del_line=$(grep -n '^DELETE ' "$CALLS" | head -1 | cut -d: -f1)
    [ -n "$post_line" ] && [ -n "$del_line" ] && [ "$post_line" -lt "$del_line" ]
    grep -q 'DELETE .*configurations/7' "$CALLS"
    run ! grep -q 'DELETE .*configurations/8' "$CALLS"
    run ! grep -q 'DELETE .*configurations/9' "$CALLS"
}

@test "ruleset_update keeps the old policy when the new one cannot be created" {
    printf '{"rules":[{"type":"pull_request"}]}' > "$TEST_TEMP_DIR/rs.json"
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET
for arg in "$@"; do
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"
done
echo "$method" >> "$CALLS"
if [[ "$method" == POST ]]; then
    prev=""; for arg in "$@"; do [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 403 Forbidden\r\n\r\n' > "$arg"; prev="$arg"; done
    printf '{"message":"rejected"}'
else
    prev=""; for arg in "$@"; do [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"; prev="$arg"; done
    cat "$CONFIGS"
fi
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    printf '{"id":"g4","defaultBranch":"refs/heads/main","value":[{"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4"}]}}]}' > "$TEST_TEMP_DIR/configs.json"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
    load_policy_libs
    run provider_org_ruleset_update o1/p1/r4 "" "$TEST_TEMP_DIR/rs.json"
    [ "$status" -ne 0 ]
    run ! grep -q '^DELETE' "$CALLS"
}

@test "ruleset_list names a policy by its type, not the same word for every policy" {
    cat > "$TEST_TEMP_DIR/configs.json" <<'JSON'
{"id":"g4","value":[
 {"id":7,"isEnabled":true,"type":{"id":"a","displayName":"Minimum number of reviewers"},"settings":{"scope":[{"repositoryId":"g4"}]}},
 {"id":8,"isEnabled":false,"type":{"id":"b","displayName":"Build"},"settings":{"scope":[{"repositoryId":"g4"}]}}]}
JSON
    export STUB_CURL_RESPONSE="$TEST_TEMP_DIR/configs.json"
    load_policy_libs
    run provider_org_rulesets_list o1/p1/r4
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].name]' <<< "$output")" = '["Minimum number of reviewers","Build"]' ]
}

@test "ruleset_update updates the policy already on the branch in place: no duplicate POST, no delete" {
    printf '{"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":2}}]}' > "$TEST_TEMP_DIR/rs.json"
    cat > "$TEST_TEMP_DIR/configs.json" <<'JSON'
{"id":"g4","name":"r4","defaultBranch":"refs/heads/main","value":[
 {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/main"}]}}]}
JSON
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
cat "$CONFIGS"
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
    load_policy_libs
    run provider_org_ruleset_update o1/p1/r4 "" "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    grep -q '^PUT .*policy/configurations/7' "$CALLS"
    run ! grep -q '^POST .*policy/configurations' "$CALLS"
    run ! grep -q '^DELETE' "$CALLS"
}

@test "ruleset_update leaves reviewers policies on branches the payload does not name" {
    printf '{"rules":[{"type":"pull_request"}]}' > "$TEST_TEMP_DIR/rs.json"
    cat > "$TEST_TEMP_DIR/configs.json" <<'JSON'
{"id":"g4","name":"r4","defaultBranch":"refs/heads/main","value":[
 {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/main"}]}},
 {"id":10,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/release"}]}}]}
JSON
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET; url=""
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
cat "$CONFIGS"
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
    load_policy_libs
    run provider_org_ruleset_update o1/p1/r4 "" "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    run ! grep -q '^DELETE' "$CALLS"
    grep -q '^PUT .*configurations/7' "$CALLS"
}

@test "ruleset_update writes a policy for every explicit branch the payload names" {
    printf '{"conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/release"]}},"rules":[{"type":"pull_request"}]}' > "$TEST_TEMP_DIR/rs.json"
    printf '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}' > "$TEST_TEMP_DIR/configs.json"
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET; url=""
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
cat "$CONFIGS"
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
    load_policy_libs
    run provider_org_ruleset_update o1/p1/r4 "" "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    [ "$(grep -c '^POST .*configurations' "$CALLS")" -eq 2 ]
}

@test "ruleset_create can be retried: a branch that already has a policy is updated, not posted again" {
    printf '{"conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/release"]}},"rules":[{"type":"pull_request"}]}' > "$TEST_TEMP_DIR/rs.json"
    cat > "$TEST_TEMP_DIR/configs.json" <<'JSON'
{"id":"g4","defaultBranch":"refs/heads/main","value":[
 {"id":7,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/main"}]}}]}
JSON
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET; url=""
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
cat "$CONFIGS"
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
    load_policy_libs
    run provider_org_ruleset_create o1/p1/r4 "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    grep -q '^PUT .*configurations/7' "$CALLS"
    [ "$(grep -c '^POST .*configurations' "$CALLS")" -eq 1 ]
}

@test "ruleset_update fails when the ruleset names no branch a policy can protect" {
    printf '{"conditions":{"ref_name":{"include":["refs/heads/release/*"]}},"rules":[{"type":"pull_request"}]}' > "$TEST_TEMP_DIR/rs.json"
    printf '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}' > "$TEST_TEMP_DIR/configs.json"
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET; url=""
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
cat "$CONFIGS"
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
    load_policy_libs
    run provider_org_ruleset_update o1/p1/r4 "" "$TEST_TEMP_DIR/rs.json"
    [ "$status" -ne 0 ]
    run ! grep -qE '^(POST|PUT|DELETE)' "$CALLS"
}

_policy_stub_curl() {
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
prev=""; method=GET; url=""
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
cat "$CONFIGS"
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log" CONFIGS="$TEST_TEMP_DIR/configs.json"; : > "$CALLS"
}

@test "ruleset create and update name the problem when the payload leaves no branch to protect" {
    printf '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}' > "$TEST_TEMP_DIR/configs.json"
    _policy_stub_curl
    load_policy_libs
    local inc verb
    for inc in '["refs/tags/*"]' '["refs/tags/v1"]' '["main"]' '["~all"]' '["~ALL "]'; do
        printf '{"conditions":{"ref_name":{"include":%s}},"rules":[{"type":"pull_request"}]}' "$inc" > "$TEST_TEMP_DIR/rs.json"
        run provider_org_ruleset_create o1/p1/r4 "$TEST_TEMP_DIR/rs.json"
        [ "$status" -ne 0 ]
        [[ "$output" == *"names no branch an Azure policy can protect"* ]] || { echo "create $inc: $output"; false; }
        run provider_org_ruleset_update o1/p1/r4 "" "$TEST_TEMP_DIR/rs.json"
        [ "$status" -ne 0 ]
        [[ "$output" == *"names no branch an Azure policy can protect"* ]] || { echo "update $inc: $output"; false; }
    done
    run ! grep -qE '^(POST|PUT|DELETE)' "$CALLS"
}

@test "ruleset create rejects a payload that is not JSON, as update does" {
    printf 'not json' > "$TEST_TEMP_DIR/rs.json"
    printf '{"id":"g4","defaultBranch":"refs/heads/main","value":[]}' > "$TEST_TEMP_DIR/configs.json"
    _policy_stub_curl
    load_policy_libs
    run provider_org_ruleset_create o1/p1/r4 "$TEST_TEMP_DIR/rs.json"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not valid JSON"* ]]
}

@test "ruleset update logs the policy it retires and the branch it was on" {
    printf '{"rules":[{"type":"pull_request"}]}' > "$TEST_TEMP_DIR/rs.json"
    cat > "$TEST_TEMP_DIR/configs.json" <<'JSON'
{"id":"g4","defaultBranch":"refs/heads/main","value":[
 {"id":11,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g4","refName":"refs/heads/release/x"}]}}]}
JSON
    _policy_stub_curl
    load_policy_libs
    run provider_org_ruleset_update o1/p1/r4 11 "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    [[ "$output" == *"retiring policy 11 on refs/heads/release/x"* ]]
    grep -q '^DELETE .*configurations/11' "$CALLS"
}

@test "~ALL is a warning that it protects the default branch only" {
    load_policy_libs
    run azure_ruleset_branches '{"conditions":{"ref_name":{"include":["~ALL"]}}}' master
    [[ "$output" == *"~ALL protects the default branch only"* ]]
    [[ "$output" == *"master"* ]]
}
