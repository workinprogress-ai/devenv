#!/usr/bin/env bats
# Unit tests for project-list-for-issue — stubbed gh.
# Live behavior is covered by tools/tests/live/project_tools.live.bats.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/project-list-for-issue.sh"
    stub_dir="$(mktemp -d)"
    export STUB_DIR="$stub_dir"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$stub_dir/gh"
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    # Deterministic repo targeting per the wrapper's documented env contract.
    export GITHUB_REPO="test-org/test-repo"
}

@test "usage error when no arguments given" {
    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"ISSUE_NUMBER is required"* ]]
}

@test "usage error when issue number is not numeric" {
    run bash "$SCRIPT" notanumber
    [ "$status" -ne 0 ]
}

@test "help exits 0 and shows usage" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"List every GitHub Project"* ]]
}

@test "issue in no projects: empty output, exit 0 (AC-2)" {
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo '{"data":{"resource":{"projectItems":{"nodes":[]}}}}'
STUB
    chmod +x "$STUB_DIR/gh"
    run bash "$SCRIPT" 42
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "issue in projects: one TSV line per project with status (AC-1)" {
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
cat <<'JSON'
{"data":{"resource":{"projectItems":{"nodes":[
  {"project":{"title":"Alpha","number":1,"owner":{"login":"test-org"}},
   "fieldValues":{"nodes":[
     {"__typename":"ProjectV2ItemFieldTextValue"},
     {"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"To-Groom","field":{"name":"Status"}}
   ]}}
]}}}}
JSON
STUB
    chmod +x "$STUB_DIR/gh"
    run bash "$SCRIPT" 42
    [ "$status" -eq 0 ]
    [ "${#lines[@]}" -eq 1 ]
    [[ "${lines[0]}" == $'Alpha\t1\tTo-Groom' ]]
}

@test "project without Status field reports dash (AC-1 partial)" {
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
cat <<'JSON'
{"data":{"resource":{"projectItems":{"nodes":[
  {"project":{"title":"Beta","number":2,"owner":{"login":"test-org"}},
   "fieldValues":{"nodes":[
     {"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Ready","field":{"name":"Priority"}}
   ]}}
]}}}}
JSON
STUB
    chmod +x "$STUB_DIR/gh"
    run bash "$SCRIPT" 42
    [ "$status" -eq 0 ]
    [[ "$output" == *"Beta"* ]]
    local dash_line
    dash_line=$(printf '\t2\t-')
    [[ "$output" == *"$dash_line"* ]]
}

@test "graph api failure: error on stderr, non-zero exit (query failure ≠ empty)" {
    # A query failure must be distinguishable from "issue in no projects":
    # the read wrapper reports it and exits non-zero. (Best-effort exit-0
    # semantics belong to the event layer, not to a user-facing read.)
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
case "$1" in
    auth) exit 0 ;;
    *)    exit 1 ;;
esac
STUB
    chmod +x "$STUB_DIR/gh"
    run bash "$SCRIPT" 42
    [ "$status" -ne 0 ]
    [[ "$output" == *"GraphQL query failed"* ]]
}
