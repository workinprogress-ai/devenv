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
    printf '{"name":"r4","id":"g4"}' > "$TEST_TEMP_DIR/r4.json"
    : > "$TEST_TEMP_DIR/rsbody.log"
    printf '%s\n' "$TEST_TEMP_DIR/r4.json" > "$TEST_TEMP_DIR/rs.queue"
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/policies.bash"
    export STUB_CURL_PAGES="$TEST_TEMP_DIR/rs.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/rsbody.log"
    run provider_org_ruleset_create o1/p1/r4 "$TEST_TEMP_DIR/rs.json"
    [ "$status" -eq 0 ]
    jq -e '.settings.minimumApproverCount == 2' < <(cat "$TEST_TEMP_DIR/rsbody.log") >/dev/null
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
