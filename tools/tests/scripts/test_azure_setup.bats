#!/usr/bin/env bats
# Tests for lib/providers/azure/azure-setup.sh — the one-time project setup.
#
# Gate and board configuration tests use synthetic credentials and mocked
# transport. Live API interaction is manual-only, never used by these tests.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SETUP_SCRIPT="$DEVENV_TOOLS/lib/providers/azure/azure-setup.sh"
}

teardown() {
    test_helper_teardown
}

mock_setup_board() {
    local workflow="$1"
    stub_curl
    export AZURE_SETUP=1
    export AZURE_PAT_FILE="$HOME/azure.pat"
    printf 'synthetic-azure-pat\n' > "$AZURE_PAT_FILE"
    chmod 600 "$AZURE_PAT_FILE"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=proj\n[workflows]\nstatus_workflow=%s\n' "$workflow" > "$DEVENV_ROOT/devenv.config"
    export STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/request-bodies"
    export SETUP_FIXTURES="$TEST_TEMP_DIR/setup-fixtures"
    mkdir -p "$SETUP_FIXTURES"
    printf '%s' '{"value":[{"id":"project-id","name":"proj"}]}' > "$SETUP_FIXTURES/projects"
    printf '%s' '{"defaultTeam":{"id":"team-id"}}' > "$SETUP_FIXTURES/team"
    printf '%s' '{"children":[{"name":"repo"}]}' > "$SETUP_FIXTURES/areas"
    printf '%s' '{"value":[{"name":"repo"}]}' > "$SETUP_FIXTURES/repos"
    printf '%s' '{"value":[{"id":"board-id","name":"Issues"}]}' > "$SETUP_FIXTURES/boards"
    printf '%s' '{"value":[{"id":"first","name":"Custom backlog","columnType":"incoming","stateMappings":{"Issue":"To Do"}},{"id":"middle","name":"Custom doing","columnType":"inProgress","itemLimit":4,"stateMappings":{"Issue":"Doing"}},{"id":"last","name":"Custom done","columnType":"outgoing","stateMappings":{"Issue":"Done"}}]}' > "$SETUP_FIXTURES/columns"
    mv "$STUB_BIN_DIR/curl" "$STUB_BIN_DIR/curl-response"
    cat > "$STUB_BIN_DIR/curl" <<'MOCK'
#!/usr/bin/env bash
url="${@: -1}"
method=GET
body=""
previous=""
for argument in "$@"; do
    [ "$previous" = "-X" ] && method="$argument"
    [ "$previous" = "-d" ] && body="$argument"
    previous="$argument"
done
case "$url" in
    */columns\?*)
        if [ "$method" = PUT ]; then
            jq -n --argjson columns "$body" '{value: ($columns | to_entries | map(.value + {id: (.value.id // ("generated-" + (.key | tostring)))}))}' > "$SETUP_FIXTURES/columns"
        fi
        export STUB_CURL_RESPONSE="$SETUP_FIXTURES/columns" ;;
    */_apis/work/boards\?*) export STUB_CURL_RESPONSE="$SETUP_FIXTURES/boards" ;;
    */_apis/git/repositories\?*) export STUB_CURL_RESPONSE="$SETUP_FIXTURES/repos" ;;
    */classificationnodes\?*) export STUB_CURL_RESPONSE="$SETUP_FIXTURES/areas" ;;
    *includeCapabilities*) export STUB_CURL_RESPONSE="$SETUP_FIXTURES/team" ;;
    */_apis/projects\?*) export STUB_CURL_RESPONSE="$SETUP_FIXTURES/projects" ;;
    *) exit 99 ;;
esac
exec "$(dirname "$0")/curl-response" "$@"
MOCK
    chmod +x "$STUB_BIN_DIR/curl"
}

@test "azure-setup: script has valid syntax" {
    bash -n "$SETUP_SCRIPT"
}

@test "azure-setup: refuses to run without AZURE_SETUP=1" {
    run bash "$SETUP_SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "AZURE_SETUP=1" ]]
    # And it refused BEFORE any network attempt (no curl spawn).
}

@test "azure-setup: --help prints usage and requirements without the gate" {
    run bash "$SETUP_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "azure-setup.sh" ]]
    [[ "$output" =~ "AZURE_SETUP=1" ]]
    [[ "$output" =~ "key-update-azure" ]]
    [[ "$output" =~ "status_workflow" ]]
    [[ "$output" =~ "--dry-run" ]]
}

@test "azure-setup: help works via -h too" {
    run bash "$SETUP_SCRIPT" -h
    [ "$status" -eq 0 ]
    [[ "$output" =~ "USAGE" ]]
}

@test "azure-setup: gated run without PAT fails with guidance, not a stack trace" {
    # Gate passes but no PAT: the auth seam must fail with the documented
    # message. config points at a temp DEVENV_ROOT with no PAT file.
    export DEVENV_ROOT="$TEST_TEMP_DIR"
    mkdir -p "$DEVENV_ROOT"
    printf '[provider]\nname=azure\nazure_org=o\nazure_project=p\n' > "$DEVENV_ROOT/devenv.config"
    AZURE_SETUP=1 run bash "$SETUP_SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "key-update-azure" ]]
}

@test "azure-setup: forces customized board names when counts match" {
    mock_setup_board 'TBD,Implementing,Production'
    run bash "$SETUP_SCRIPT"
    [ "$status" -eq 0 ]
    jq -e 'type == "array" and map(.name) == ["TBD","Implementing","Production"] and .[0].id == "first" and .[1].id == "middle" and .[2].id == "last" and .[1].itemLimit == 4' "$STUB_CURL_REQUEST_BODY"
}

@test "azure-setup: grows boards using supported mappings and preserves endpoint ids" {
    mock_setup_board 'TBD,Ready,Implementing,Review,Production'
    run bash "$SETUP_SCRIPT"
    [ "$status" -eq 0 ]
    jq -e 'map(.name) == ["TBD","Ready","Implementing","Review","Production"] and .[0].id == "first" and .[4].id == "last" and .[1].id == "middle" and .[2].id == null and .[3].id == null and .[2].columnType == "inProgress" and .[2].stateMappings.Issue == "Doing" and .[4].stateMappings.Issue == "Done"' "$STUB_CURL_REQUEST_BODY"
}

@test "azure-setup: shrinks boards to the configured vocabulary" {
    mock_setup_board 'TBD,Production'
    run bash "$SETUP_SCRIPT"
    [ "$status" -eq 0 ]
    jq -e 'length == 2 and .[0].id == "first" and .[1].id == "last" and map(.name) == ["TBD","Production"]' "$STUB_CURL_REQUEST_BODY"
}

@test "azure-setup: dry run previews customized board convergence without writes" {
    mock_setup_board 'TBD,Ready,Implementing,Review,Production'
    cp "$SETUP_FIXTURES/columns" "$TEST_TEMP_DIR/original-columns"
    run bash "$SETUP_SCRIPT" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry]"*"Issues"* ]]
    [ ! -s "$STUB_CURL_REQUEST_BODY" ]
    cmp "$SETUP_FIXTURES/columns" "$TEST_TEMP_DIR/original-columns"
}

@test "azure-setup: converged repeat run does not rewrite the board" {
    mock_setup_board 'TBD,Ready,Implementing,Review,Production'
    run bash "$SETUP_SCRIPT"
    [ "$status" -eq 0 ]
    [ -s "$STUB_CURL_REQUEST_BODY" ]
    cp "$SETUP_FIXTURES/columns" "$TEST_TEMP_DIR/converged-columns"
    rm "$STUB_CURL_REQUEST_BODY"
    run bash "$SETUP_SCRIPT"
    [ "$status" -eq 0 ]
    [ ! -s "$STUB_CURL_REQUEST_BODY" ]
    cmp "$SETUP_FIXTURES/columns" "$TEST_TEMP_DIR/converged-columns"
}

@test "azure-setup: configures all eight workflow columns and trims whitespace" {
    mock_setup_board ' TBD, To-Groom,Ready,Implementing,Review,Merged,Staging, Production '
    run bash "$SETUP_SCRIPT"
    [ "$status" -eq 0 ]
    jq -e 'map(.name) == ["TBD","To-Groom","Ready","Implementing","Review","Merged","Staging","Production"] and .[7].id == "last" and (.[2:7] | all(.[]; .id == null and .stateMappings.Issue == "Doing"))' "$STUB_CURL_REQUEST_BODY"
}

@test "azure-setup: rejects empty duplicate or single-column workflow without board writes" {
    local workflow
    for workflow in 'TBD,,Production' 'TBD,TBD' 'TBD'; do
        mock_setup_board "$workflow"
        run bash "$SETUP_SCRIPT"
        [ "$status" -ne 0 ]
        [[ "$output" == *"distinct, non-empty column names"* ]]
        [ ! -s "$STUB_CURL_REQUEST_BODY" ]
    done
}

@test "azure-setup: reports missing in-progress mapping rather than inventing process states" {
    mock_setup_board 'TBD,Ready,Production'
    jq '.value |= map(select(.columnType != "inProgress"))' "$SETUP_FIXTURES/columns" > "$TEST_TEMP_DIR/two-columns"
    mv "$TEST_TEMP_DIR/two-columns" "$SETUP_FIXTURES/columns"
    run bash "$SETUP_SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"existing in-progress state mapping"* ]]
    [ ! -s "$STUB_CURL_REQUEST_BODY" ]
}
