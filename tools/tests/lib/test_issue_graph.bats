#!/usr/bin/env bats
# Tests for the issue-graph helper contracts (native sub-issues).
# Stubbed gh; assertions on call shape. API shapes live-verified against
# GitHub: addSubIssue / subIssues / removeSubIssue.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    GRAPH="$PROJECT_ROOT/tools/lib/issue-graph.bash"
    stub_dir="$(mktemp -d)"
    export STUB_DIR="$stub_dir"
    GH_CALL_LOG="$stub_dir/calls.log"
    export GH_CALL_LOG
    cat > "$stub_dir/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
# jq-aware stub: apply the caller's --jq program like real gh does.
jq_program=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--jq" ]; then jq_program="$arg"; fi
    prev="$arg"
done
payload=""
case "$*" in
    *"addSubIssue"*)
        payload='{"data":{"addSubIssue":{"issue":{"number":46},"subIssue":{"number":47}}}}'
        ;;
    *"removeSubIssue"*)
        payload='{"data":{"removeSubIssue":{"issue":{"number":46}}}}'
        ;;
    *"subIssues"*)
        payload='{"data":{"repository":{"issue":{"subIssues":{"nodes":[{"number":47},{"number":48}],"totalCount":2}}}}}'
        ;;
    *"id}"*|*"issue(number"*)
        payload='{"data":{"repository":{"issue":{"id":"I_test1"}}}}'
        ;;
    *)
        payload='{"data":{}}'
        ;;
esac
if [ -n "$jq_program" ]; then
    printf '%s' "$payload" | jq -r "$jq_program"
else
    echo "$payload"
fi
STUB
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    # Repo resolution comes from GITHUB_REPO (same pattern as the workflow-
    # core suite); without it the stub would see repo-view calls.
    export GITHUB_REPO="test-org/test-repo"
}

@test "issue_link_subissue issues the addSubIssue mutation" {
    run bash -c "source '$GRAPH' && issue_link_subissue 46 47"
    [ "$status" -eq 0 ]
    grep -q "addSubIssue" "$GH_CALL_LOG"
}

@test "issue_children returns child issue numbers one per line" {
    run bash -c "source '$GRAPH' && issue_children 46"
    [ "$status" -eq 0 ]
    [ "${lines[0]}" = "47" ]
    [ "${lines[1]}" = "48" ]
}

@test "issue_parent returns empty for an issue with no parent (resolved via body link)" {
    # No native parent, no body-text link: empty output either way.
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
jq_program=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--jq" ]; then jq_program="$arg"; fi
    prev="$arg"
done
case "$*" in
    *"graphql"*)
        printf '%s' '{"data":{"repository":{"issue":{"parent":null}}}}' | jq -r "$jq_program"
        ;;
    *"--json body"*) echo '{"body":"plain body, no links"}' ;;
    *) echo '{}' ;;
esac
STUB
    chmod +x "$STUB_DIR/gh"
    run bash -c "source '$GRAPH' && issue_parent 44"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "issue_parent resolves 'Part of #N' body-text links (legacy convention)" {
    # Native linkage absent (pre-native sub-issue issue): the body-text
    # fallback is what resolves the parent.
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
jq_program=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--jq" ]; then jq_program="$arg"; fi
    prev="$arg"
done
case "$*" in
    *"graphql"*)
        printf '%s' '{"data":{"repository":{"issue":{"parent":null}}}}' | jq -r "$jq_program"
        ;;
    *"--json body"*)
        # Mirror real gh: -q .body prints the unescaped body text.
        printf 'Part of #43\n\nreal content\n'
        ;;
    *) echo '{}' ;;
esac
STUB
    chmod +x "$STUB_DIR/gh"
    run bash -c "source '$GRAPH' && issue_parent 44"
    [ "$status" -eq 0 ]
    [ "$output" = "43" ]
}

@test "issue_parent prefers native parent linkage over body text" {
    # Native parent present AND a (stale) body link: native wins. The body
    # is deliberately never consulted - only the graphql call is served.
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
jq_program=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--jq" ]; then jq_program="$arg"; fi
    prev="$arg"
done
case "$*" in
    *"graphql"*)
        printf '%s' '{"data":{"repository":{"issue":{"parent":{"number":99}}}}}' | jq -r "$jq_program"
        ;;
    *)
        echo "UNEXPECTED GH CALL: $*" >> "$GH_CALL_LOG"
        echo '{}' ;;
esac
STUB
    chmod +x "$STUB_DIR/gh"
    run bash -c "source '$GRAPH' && issue_parent 44"
    [ "$status" -eq 0 ]
    [ "$output" = "99" ]
    if grep -q "UNEXPECTED GH CALL" "$GH_CALL_LOG"; then
        fail "body must not be consulted when native linkage is present"
    fi
}

@test "issue_link_subissue with missing args is a usage error" {
    run bash -c "source '$GRAPH' && issue_link_subissue 46"
    [ "$status" -ne 0 ]
}
