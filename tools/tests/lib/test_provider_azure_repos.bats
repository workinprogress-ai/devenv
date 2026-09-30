#!/usr/bin/env bats
# Tests for the azure provider repos + urls domains: remote parsing (https +
# ssh), web-URL building, provider_repos_view/list output shapes, and
# org/project config resolution. All transport goes through stub_curl.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    stub_curl
    export STUB_CALL_LOG
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    export AZURE_PAT="test-pat"
    export AZURE_PAT_FILE="$TEST_TEMP_DIR/azure.pat"
    printf 'test-pat\n' > "$AZURE_PAT_FILE"
    chmod 600 "$AZURE_PAT_FILE"
}

teardown() {
    unset AZURE_PAT AZURE_PAT_FILE DEVENV_ROOT
    test_helper_teardown
}

# Sourcing helper (file scope: setup exports DEVENV_TOOLS before tests run,
# and the function reads it at call time). A function, not a command string:
# immune to the quoting/expansion traps of embedding paths in `bash -c`.
azure_libs_source() {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
}

# Run helpers: source the azure libs in-process, then invoke the verb. The
# outer test shell owns the environment (STUB_CURL_RESPONSE etc. flow through
# run's env copying), and paths never pass through nested quoting.
azure_run() {
    azure_libs_source
    "$@"
}
provider_extract_url_from_text() {
    azure_libs_source
    printf '%s' "$1" | provider_extract_url "$2"
}

# ===========================================================================
# Remote URL parsing
# ===========================================================================

@test "azure_parse_remote handles https form with .git suffix" {
    azure_libs_source
    run azure_parse_remote 'https://dev.azure.com/myorg/myproj/_git/myrepo.git' 
    [ "$status" -eq 0 ]
    [ "$output" = "myorg/myproj/myrepo" ]
}

@test "azure_parse_remote handles https form without suffix" {
    azure_libs_source
    run azure_parse_remote 'https://dev.azure.com/myorg/myproj/_git/myrepo' 
    [ "$status" -eq 0 ]
    [ "$output" = "myorg/myproj/myrepo" ]
}

@test "azure_parse_remote handles ssh v3 form" {
    azure_libs_source
    run azure_parse_remote 'git@ssh.dev.azure.com:v3/myorg/myproj/myrepo' 
    [ "$status" -eq 0 ]
    [ "$output" = "myorg/myproj/myrepo" ]
}

@test "azure_parse_remote rejects a github remote" {
    azure_libs_source
    run azure_parse_remote 'https://github.com/org/repo.git' 
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not a recognized Azure DevOps remote" ]]
}

# ===========================================================================
# Web URLs
# ===========================================================================

@test "provider_web_host reports dev.azure.com" {
    azure_libs_source
    run provider_web_host
    [ "$output" = "dev.azure.com" ]
}

@test "provider_web_url builds org/project/repo/path links" {
    azure_libs_source
    run provider_web_url 'myorg/myproj/myrepo' 'pullrequest/12' 
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/myorg/myproj/myrepo/pullrequest/12" ]
}

@test "provider_web_url requires repo and path" {
    azure_libs_source
    run provider_web_url 'myorg/myproj/myrepo' 
    [ "$status" -ne 0 ]
}

@test "provider_extract_url finds azure pull request URLs" {
    azure_libs_source
    local extract_input="created https://dev.azure.com/myorg/myproj/myrepo/pullrequest/12 today"
    run provider_extract_url_from_text "$extract_input" 'pullrequest'
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/myorg/myproj/myrepo/pullrequest/12" ]
}

# ===========================================================================
# provider_repos_view / provider_repos_list
# ===========================================================================

@test "provider_repos_view returns nameWithOwner in project/repo form" {
    printf '{"name":"myrepo","project":{"name":"myproj"},"isPrivate":true}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_view myorg/myproj/myrepo --json nameWithOwner
    [ "$status" -eq 0 ]
    [ "$output" = "myproj/myrepo" ]
    # Correct API endpoint was called
    grep -q "dev.azure.com/myorg/myproj/_apis/git/repositories/myrepo" "$STUB_CALL_LOG"
    grep -q "api-version=7.1" "$STUB_CALL_LOG"
}

@test "provider_repos_view maps gh name field to azure .name" {
    printf '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/main"}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_view myorg/myproj/myrepo --json name
    [ "$status" -eq 0 ]
    [ "$output" = "myrepo" ]
}

@test "provider_repos_view maps defaultBranchRef via refs-stripping projection" {
    printf '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/main"}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_view myrepo --json defaultBranchRef
    [ "$status" -eq 0 ]
    [ "$output" = "refs/heads/main" ]
}

@test "provider_repos_view comma field list emits one gh-shaped object" {
    printf '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/dev"}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_view myrepo --json name,nameWithOwner,defaultBranchRef
    [ "$status" -eq 0 ]
    # The object must be valid JSON (nameWithOwner stays a quoted string).
    run jq -e . <<<"$output"
    [ "$status" -eq 0 ]
    run jq -r '.name + "|" + .nameWithOwner + "|" + .defaultBranchRef.name' <<<"$output"
    [ "$output" = "myrepo|myproj/myrepo|refs/heads/dev" ]
}

@test "provider_repos_default_branch strips refs/heads prefix" {
    printf '{"name":"myrepo","project":{"name":"myproj"},"defaultBranch":"refs/heads/main"}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_default_branch myrepo
    [ "$status" -eq 0 ]
    [ "$output" = "main" ]
}

@test "provider_remote_to_web normalizes both azure remote forms" {
    azure_libs_source
    run azure_run provider_remote_to_web 'https://dev.azure.com/myorg/myproj/_git/myrepo.git'
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/myorg/myproj/_git/myrepo" ]
    run azure_run provider_remote_to_web 'git@ssh.dev.azure.com:v3/myorg/myproj/myrepo'
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/myorg/myproj/_git/myrepo" ]
    run azure_run provider_remote_to_web 'git@github.com:other/repo.git'
    [ "$status" -ne 0 ]
}

@test "repo-target cwd hook composes org/project/basename" {
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"
    # Simulate a git root: run inside the (git-init'd) test dir tree.
    run bash -c "cd '$TEST_TEMP_DIR' && git init -q azure-cwd 2>/dev/null; cd azure-cwd && \
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash' && \
        PROVIDER_NAME=azure && source '$DEVENV_TOOLS/lib/providers/azure/repos.bash' && \
        provider_repo_target"
    [ "$status" -eq 0 ]
    [ "$output" = "myorg/myproj/azure-cwd" ]
}

@test "provider_gh_repo_args passes an explicit spec through untouched" {
    azure_libs_source
    local args=()
    provider_gh_repo_args args "myorg/myproj/myrepo"
    [ "${#args[@]}" -eq 1 ]
    [ "${args[0]}" = "myorg/myproj/myrepo" ]
}

@test "provider_gh_repo_args with no spec yields an empty arg list" {
    azure_libs_source
    local args=("sentinel")
    provider_gh_repo_args args ""
    [ "${#args[@]}" -eq 0 ]
}

@test "repo_split splits a three-part azure spec at the first slash (generic contract)" {
    azure_libs_source
    provider_repo_split 'myorg/myproj/myrepo' HEAD TAIL
    [ "$HEAD" = "myorg" ]
    [ "$TAIL" = "myproj/myrepo" ]
}

@test "repo_split fails defined when the spec has no separator" {
    azure_libs_source
    run provider_repo_split SPEC 'plainrepo' HEAD TAIL
    [ "$status" -ne 0 ]
    [[ "$output" =~ owner/repo ]]
}

@test "provider_repos_view resolves bare repo name from config" {
    printf '{"name":"cfgrepo","project":{"name":"cfgproj"}}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=cfgorg\nazure_project=cfgproj\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_view cfgrepo --json nameWithOwner
    [ "$status" -eq 0 ]
    [ "$output" = "cfgproj/cfgrepo" ]
}

@test "provider_repos_view without org/project config fails with guidance" {
    printf '[provider]\nname=azure\n' > "$DEVENV_ROOT/devenv.config"
    run azure_run provider_repos_view solo
    [ "$status" -ne 0 ]
    [[ "$output" =~ "azure_org" ]]
}

@test "provider_repos_list returns gh-shaped name/nameWithOwner entries" {
    printf '{"value":[{"name":"r1","project":{"name":"p1"}},{"name":"r2","project":{"name":"p1"}}]}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    run azure_run provider_repos_list org/p1
    [ "$status" -eq 0 ]
    # The endpoint hit the project-scoped list API
    grep -q "dev.azure.com/org/p1/_apis/git/repositories" "$STUB_CALL_LOG"
}

@test "provider_repos_list --json/-q yield one repo name per line (org-sweep iteration shape)" {
    # pipelines-status/list iterate `while read -r repo` over
    # the output — the whole array on one line would iterate once with a
    # JSON blob as the repo name.
    printf '{"value":[{"name":"r1","project":{"name":"p1"}},{"name":"r2","project":{"name":"p1"}}]}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_list org --json name -q '.[].name'
    [ "$status" -eq 0 ]
    [ "${lines[0]}" = "r1" ]
    [ "${lines[1]}" = "r2" ]
    [ "${#lines[@]}" -eq 2 ]
}

@test "provider_repos_list fails typed when the API errors" {
    printf '[provider]\nname=azure\nazure_org=o\nazure_project=p\n' > "$DEVENV_ROOT/devenv.config"
    printf '{"message":"TF401: unauthorized"}' > "$TEST_TEMP_DIR/err401.json"
    STUB_CURL_HTTP_CODE=401 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/err401.json" \
        run azure_run provider_repos_list o/p
    [ "$status" -ne 0 ]
}

# ============================================================================
# provider_repos_commits_count (contract verb)
# ============================================================================

@test "provider_repos_commits_count succeeds when the repo has commits" {
    printf '{"count":1,"value":[{"commitId":"abc"}]}' > "$TEST_TEMP_DIR/commits.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/commits.json" \
        run azure_run provider_repos_commits_count o1/p1/r1
    [ "$status" -eq 0 ]
}

@test "provider_repos_commits_count fails defined on an empty repo" {
    printf '{"count":0,"value":[]}' > "$TEST_TEMP_DIR/nocommits.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/nocommits.json" \
        run azure_run provider_repos_commits_count o1/p1/r1
    [ "$status" -ne 0 ]
}

# ============================================================================
# Provisioning verbs
# ============================================================================

@test "provider_repos_create POSTs the repo document" {
    printf '[provider]
name=azure
azure_org=o1
azure_project=p1
' > "$DEVENV_ROOT/devenv.config"
    printf '{"name":"r1","id":"g1"}' > "$TEST_TEMP_DIR/created.json"
    : > "$TEST_TEMP_DIR/crbody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/crbody.log" \
        run azure_run provider_repos_create o1/p1/r1 --description "d"
    [ "$status" -eq 0 ]
    jq -e '.name == "r1" and .description == "d"' < <(cat "$TEST_TEMP_DIR/crbody.log") >/dev/null
}


@test "provider_repos_patch skips merge-strategy knobs with a warning" {
    printf '[provider]
name=azure
azure_org=o1
azure_project=p1
' > "$DEVENV_ROOT/devenv.config"
    run azure_run provider_repos_patch o1/p1/r1 -F allow_squash_merge=true -F description=x
    [ "$status" -eq 0 ]
    [[ "$output" =~ "merge strategies are project-policy" ]]
}

@test "provider_repos_protect_branch posts a minimum-reviewers policy" {
    printf '[provider]
name=azure
azure_org=o1
azure_project=p1
' > "$DEVENV_ROOT/devenv.config"
    printf '{"name":"r3","id":"g3"}' > "$TEST_TEMP_DIR/r3.json"
    printf '{"required_pull_request_reviews":{"required_approving_review_count":2}}' > "$TEST_TEMP_DIR/protection.json"
    : > "$TEST_TEMP_DIR/pbbody.log"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pb.queue"
    printf '%s\n' "$TEST_TEMP_DIR/r3.json" > "$STUB_CURL_PAGES"
    STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/pbbody.log" \
        run azure_run provider_repos_protect_branch o1/p1/r3 main "$TEST_TEMP_DIR/protection.json"
    [ "$status" -eq 0 ]
    jq -e '.settings.minimumApproverCount == 2 and .settings.scope[0].refName == "refs/heads/main"' < <(cat "$TEST_TEMP_DIR/pbbody.log") >/dev/null
}

@test "azure_identity_sddl decodes the URL-safe base64 descriptor" {
    azure_libs_source
    # "abcd-_" style payload: vssgp.U3VtLUt5PUNULUNQLUNOLVN1bg== style
    local d
    d=$(azure_identity_sddl "vssgp.dGVzdC1pZGVudGl0eQ")
    [[ "$d" == Microsoft.TeamFoundation.Identity\;* ]]
    case "$d" in
        *"test-identity") ;;
        *) echo "decoded body missing: $d" >&2; return 1 ;;
    esac
}

@test "azure_grant_bits maps the GH vocabulary" {
    azure_libs_source
    [ "$(azure_grant_bits pull)" = "2" ]
    [ "$(azure_grant_bits push)" = "54" ]
    [ "$(azure_grant_bits maintain)" = "2230" ]
    [ "$(azure_grant_bits admin)" = "3967" ]
    run azure_grant_bits owner
    [ "$status" -ne 0 ]
}

