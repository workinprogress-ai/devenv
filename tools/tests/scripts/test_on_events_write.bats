#!/usr/bin/env bats
# Write-path tests: dispatcher transitions through the real wrapper
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
    export DEVENV_REPO="test-org/test-repo"
    unset GH_ORG
}

@test "dispatcher invokes the wrapper with resolved status and safe fan-out" {
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$STUB_CALLS"
# Apply the caller's --jq program like real gh (the project lookup filters
# inside that program; a raw-JSON echo would break the contract it asserts).
prog=""
prev=""
for a in "$@"; do
    if [ "$prev" = "--jq" ]; then prog="$a"; fi
    prev="$a"
done
case "$*" in
    *"updateProjectV2ItemFieldValue"*) payload='{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_x"}}}}' ;;
    *"projectV2(number"*) payload='{"data":{"organization":{"projectV2":{"id":"PVT_p1"}}}}' ;;
    *"items(first"*) payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_x","content":{"number":44,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}' ;;
    *"ProjectV2SingleSelectField"*) payload='{"data":{"node":{"field":{"id":"PVTVF_f","options":[{"id":"PVTFO_o","name":"To-Groom"}]}}}}' ;;
    *"projectsV2(first"*) payload='{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVT_p1","number":9,"title":"P","owner":{"login":"test-org"}}]}}}}' ;;
    *"resource(url"*) payload='{"data":{"resource":{"projectItems":{"nodes":[{"project":{"id":"PVT_p1","number":9,"title":"P","owner":{"login":"test-org"}},"fieldValues":{"nodes":[]}}]}}}}' ;;
    *) payload='{"data":{}}' ;;
esac
if [ -n "$prog" ]; then
    printf '%s' "$payload" | jq -r "$prog"
else
    echo "$payload"
fi
STUB
    export STUB_CALLS="$stub_dir/calls.log"
    run bash "$DISPATCH" _on_begin_grooming 44
    [ "$status" -eq 0 ]
    grep -q "updateProjectV2ItemFieldValue" "$STUB_CALLS"
}

@test "event write fires from the devenv checkout without DEVENV_REPO: wrapper resolves the issue's repo before the safety gate" {
    # Regression (hunt: workflow status write dead from devenv cwd): the
    # wrapper used to run the devenv-repo safety gate before repo resolution,
    # so a signal fired from the devenv checkout — where the _on_* contract
    # sets no DEVENV_REPO — was refused by the gate before the issue number
    # could route to its repo. Resolution must supply the target so the gate
    # sees an explicit override.
    unset DEVENV_REPO
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$STUB_CALLS"
prog=""
prev=""
for a in "$@"; do
    if [ "$prev" = "--jq" ]; then prog="$a"; fi
    prev="$a"
done
case "$*" in
    *"updateProjectV2ItemFieldValue"*) payload='{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_x"}}}}' ;;
    *"projectV2(number"*) payload='{"data":{"organization":{"projectV2":{"id":"PVT_p1"}}}}' ;;
    *"items(first"*) payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_x","content":{"number":44,"repository":{"nameWithOwner":"'$RESOLVED_REPO'"}}}]}}}}' ;;
    *"ProjectV2SingleSelectField"*) payload='{"data":{"node":{"field":{"id":"PVTVF_f","options":[{"id":"PVTFO_o","name":"To-Groom"}]}}}}' ;;
    *"projectsV2(first"*) payload='{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVT_p1","number":9,"title":"P","owner":{"login":"'$RESOLVED_OWNER'"}}]}}}}' ;;
    *"resource(url"*) payload='{"data":{"resource":{"projectItems":{"nodes":[{"project":{"id":"PVT_p1","number":9,"title":"P","owner":{"login":"'$RESOLVED_OWNER'"}},"fieldValues":{"nodes":[]}}]}}}}' ;;
    *) payload='{"data":{}}' ;;
esac
if [ -n "$prog" ]; then
    printf '%s' "$payload" | jq -r "$prog"
else
    echo "$payload"
fi
STUB
    # The stub mirrors whatever repo resolution produces (owner from config +
    # cwd basename in the devenv checkout) — the regression under test is
    # "resolution completes and the write proceeds", not a specific repo.
    local resolved_owner resolved_repo
    resolved_owner="$(grep -oP '^org\s*=\s*\K.*' "$DEVENV_ROOT/devenv.config" 2>/dev/null | head -1)"
    resolved_owner="${resolved_owner:-workinprogress-ai}"
    resolved_repo="${resolved_owner}/$(basename "$(git rev-parse --show-toplevel)")"
    export RESOLVED_OWNER="$resolved_owner" RESOLVED_REPO="$resolved_repo"
    export STUB_CALLS="$stub_dir/calls2.log"
    # cwd is the devenv checkout (test_helper roots it there); no DEVENV_REPO.
    run bash "$DISPATCH" _on_begin_grooming 44
    [ "$status" -eq 0 ]
    [[ "$output" != *"workflow write"* ]]
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
