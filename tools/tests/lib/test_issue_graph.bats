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
    # Repo resolution comes from DEVENV_REPO (same pattern as the workflow-
    # core suite); without it the stub would see repo-view calls.
    export DEVENV_REPO="test-org/test-repo"
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

@test "issue_parent resolves 'Part of #N' body-text links (body-text convention)" {
    # Native linkage absent (an issue without native sub-issue linkage): the body-text
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

# ============================================================================
# Provider-neutrality of the graph surface (azure routing)
# ============================================================================

@test "issue_link_subissue routes through the provider verb, not raw graphql" {
    # The public helper must call provider_issue_graph_link; the graphql
    # composition is provider-internal. A stubbed verb records the numbers.
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
exit 0
STUB
    chmod +x "$STUB_DIR/gh"
    run bash -c "source '$GRAPH' && provider_issue_graph_link() { echo \"graph_link repo=[\$1] \$2 \$3\"; } && issue_link_subissue 46 47"
    [ "$status" -eq 0 ]
    [ "$output" = "graph_link repo=[] 46 47" ]
}

@test "issue_children delegates to provider_issue_graph_children" {
    run bash -c "source '$GRAPH' && provider_issue_graph_children() { printf '47\n48\n'; } && issue_children 46"
    [ "$status" -eq 0 ]
    [ "${lines[0]}" = "47" ]
    [ "${lines[1]}" = "48" ]
}

@test "issue_parent delegates to provider_issue_graph_parent (native leg)" {
    run bash -c "source '$GRAPH' && provider_issue_graph_parent() { printf '46'; } && issue_parent 47"
    [ "$status" -eq 0 ]
    [ "$output" = "46" ]
}

# ---------------------------------------------------------------------------
# issue_read_status: a status read inside a signal flow follows the same rule as the
# status write — an unset DEVENV_REPO means the signal targets the checkout it runs
# in, so the read script gets the explicit --devenv override; an exported DEVENV_REPO
# already names the target.
# ---------------------------------------------------------------------------

read_status_args() {   # read_status_args <DEVENV_REPO or empty> -> the args the read script got
    local tools="$STUB_DIR/graph-tools"
    mkdir -p "$tools/scripts"
    cat > "$tools/scripts/project-list-for-issue.sh" <<STUB
#!/usr/bin/env bash
echo "ARGS \$*" >> "$STUB_DIR/read-args.log"
printf 'Board\t1\tReady\n'
STUB
    chmod +x "$tools/scripts/project-list-for-issue.sh"
    : > "$STUB_DIR/read-args.log"
    if [ -n "$1" ]; then
        run env DEVENV_REPO="$1" ISSUE_GRAPH_TOOLS="$tools" bash -c "source '$GRAPH' && issue_read_status 44"
    else
        run env -u DEVENV_REPO ISSUE_GRAPH_TOOLS="$tools" bash -c "source '$GRAPH' && issue_read_status 44"
    fi
}

@test "issue_read_status passes --devenv when DEVENV_REPO is unset" {
    read_status_args ""
    [ "$status" -eq 0 ]
    grep -qx "ARGS 44 --devenv" "$STUB_DIR/read-args.log"
}

@test "issue_read_status passes no override when DEVENV_REPO names the target" {
    read_status_args "other-org/other-repo"
    [ "$status" -eq 0 ]
    grep -qx "ARGS 44" "$STUB_DIR/read-args.log"
}

@test "issue_read_status returns each of the workflow's words as itself, never a coarser state" {
    local tools="$STUB_DIR/graph-tools" word
    mkdir -p "$tools/scripts"
    for word in TBD To-Groom Ready Implementing Review Merged Staging Production; do
        cat > "$tools/scripts/project-list-for-issue.sh" <<STUB
#!/usr/bin/env bash
printf 'Stories\t44\t$word\n'
STUB
        chmod +x "$tools/scripts/project-list-for-issue.sh"
        run env DEVENV_REPO=o/r ISSUE_GRAPH_TOOLS="$tools" bash -c "source '$GRAPH' && issue_read_status 44"
        [ "$status" -eq 0 ]
        [ "$output" = "$word" ] || { echo "$word read as: $output"; return 1; }
    done
}

# ---------------------------------------------------------------------------
# The repository rides GraphQL variables (-f o= -f r=). gh fills {owner}/{repo}
# placeholders only in the endpoint and -F fields, never inside a -f query, so a
# query that embeds them asks GitHub for a repository literally named "{repo}".
# ---------------------------------------------------------------------------

graphql_calls() { grep ' graphql ' "$GH_CALL_LOG"; }

@test "issue_children passes the target repository as GraphQL variables, not placeholders" {
    run bash -c "source '$GRAPH' && issue_children 46"
    [ "$status" -eq 0 ]
    graphql_calls | grep -q -- '-f o=test-org'
    graphql_calls | grep -q -- '-f r=test-repo'
    run ! grep -F '{owner}' "$GH_CALL_LOG"
    run ! grep -F '{repo}' "$GH_CALL_LOG"
}

@test "issue_parent passes the target repository as GraphQL variables" {
    run bash -c "source '$GRAPH' && issue_parent 46"
    graphql_calls | grep -q -- '-f o=test-org'
    graphql_calls | grep -q -- '-f r=test-repo'
    run ! grep -F '{owner}' "$GH_CALL_LOG"
}

@test "issue_link_subissue resolves both node ids in the target repository" {
    run bash -c "source '$GRAPH' && issue_link_subissue 46 47"
    [ "$status" -eq 0 ]
    # two node-id lookups, each carrying the repository, then the mutation
    [ "$(graphql_calls | grep -c -- '-f o=test-org')" -ge 2 ]
    [ "$(graphql_calls | grep -c -- '-f r=test-repo')" -ge 2 ]
}

@test "the sub-issue verbs follow DEVENV_REPO, not whatever repository gh would pick" {
    run env DEVENV_REPO=other-org/other-repo bash -c "source '$GRAPH' && issue_children 46"
    [ "$status" -eq 0 ]
    graphql_calls | grep -q -- '-f o=other-org'
    graphql_calls | grep -q -- '-f r=other-repo'
}

@test "provider_issue_graph_children takes the repository as its first argument" {
    run bash -c "source '$GRAPH' && provider_issue_graph_children third-org/third-repo 46"
    [ "$status" -eq 0 ]
    graphql_calls | grep -q -- '-f o=third-org'
    graphql_calls | grep -q -- '-f r=third-repo'
}

@test "provider_issue_graph_unlink resolves node ids in the target repository too" {
    run bash -c "source '$GRAPH' && provider_issue_graph_unlink '' 46 47"
    [ "$status" -eq 0 ]
    [ "$(graphql_calls | grep -c -- '-f o=test-org')" -ge 2 ]
    grep -q removeSubIssue "$GH_CALL_LOG"
}

@test "a failing gh makes the sub-issue link fail and say why" {
    printf '#!/usr/bin/env bash\necho "gh $*" >> "$GH_CALL_LOG"\necho "boom: not authorized" >&2\nexit 1\n' > "$STUB_DIR/gh"
    run bash -c "source '$GRAPH' && issue_link_subissue 46 47"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not authorized"* ]]
}
