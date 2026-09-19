#!/usr/bin/env bats
# Phase 5 write-path tests: dispatcher transitions through the real wrapper
# (stubbed gh), plus best-effort failure semantics (D-008).

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    DISPATCH="$PROJECT_ROOT/tools/scripts/_on_event_dispatch.sh"
    stub_dir="$(mktemp -d)"
    export STUB_DIR="$stub_dir"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$stub_dir/gh"
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    export GITHUB_REPO="test-org/test-repo"
    unset GH_ORG
}

@test "dispatcher invokes the wrapper with resolved status and safe fan-out" {
    # Record the wrapper invocation via a fake wrapper injected through PATH?
    # The dispatcher calls the wrapper by absolute DEVENV_TOOLS path, so we
    # assert on the stubbed gh call chain instead: status resolution + the
    # wrapper's GraphQL mutation call must both appear.
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$STUB_CALLS"
case "$*" in
    *"updateProjectV2ItemFieldValue"*) echo '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_x"}}}}' ;;
    *"projectV2(number"*) echo '{"data":{"organization":{"projectV2":{"id":"PVT_p1"}}}}' ;;
    *"items(first"*) echo '{"data":{"node":{"items":{"nodes":[{"id":"PVTI_x","content":{"number":44}}]}}}}' ;;
    *"ProjectV2SingleSelectField"*) echo '{"data":{"node":{"field":{"id":"PVTVF_f","options":[{"id":"PVTFO_o","name":"To-Groom"}]}}}}' ;;
    *"projectsV2(first"*) echo '{"data":{"organization":{"projectsV2":{"nodes":[{"id":"PVT_p1","number":9,"title":"P","owner":{"login":"test-org"}}]}}}}' ;;
    *"resource(url"*) echo '{"data":{"resource":{"projectItems":{"nodes":[{"project":{"id":"PVT_p1","number":9,"title":"P","owner":{"login":"test-org"}},"fieldValues":{"nodes":[]}}]}}}}' ;;
    *) echo '{"data":{}}' ;;
esac
STUB
    export STUB_CALLS="$stub_dir/calls.log"
    run bash "$DISPATCH" _on_begin_grooming 44
    [ "$status" -eq 0 ]
    grep -q "updateProjectV2ItemFieldValue" "$STUB_CALLS"
}

@test "wrapper failure is best-effort: warn + exit 0 (D-008)" {
    # Stub gh fails on everything after auth -> wrapper fails -> dispatcher warns.
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
case "$1" in auth) exit 0 ;; *) exit 1 ;; esac
STUB
    chmod +x "$STUB_DIR/gh"
    run bash "$DISPATCH" _on_begin_grooming 44
    [ "$status" -eq 0 ]
    # Contract: dispatcher exits 0 no matter what the wrapper did (D-008).
    # A read failure under --safe is a no-op success, so either outcome line
    # is acceptable; a hard crash is not.
    [[ "$output" == *"(all projects)"* || "$output" == *"best-effort"* ]]
}

@test "unknown event: warn + exit 0 (schema tolerance)" {
    run bash "$DISPATCH" _on_totally_unknown 44
    [ "$status" -eq 0 ]
    [[ "$output" == *"Unknown event"* ]]
}
