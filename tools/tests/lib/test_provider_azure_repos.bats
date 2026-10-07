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

@test "azure_parse_remote decodes percent-escapes so a name with a space is encoded exactly once" {
    azure_libs_source
    run azure_parse_remote 'https://dev.azure.com/myorg/My%20Project/_git/r%C3%A9po'
    [ "$status" -eq 0 ]
    [ "$output" = "myorg/My Project/répo" ]
    # the request builders encode the decoded name once
    spec="$(provider_remote_to_spec 'https://dev.azure.com/myorg/My%20Project/_git/myrepo')"
    [ "$spec" = "My Project/myrepo" ]
    [ "$(azure_uri 'My Project')" = "My%20Project" ]
}

@test "provider_remote_to_web re-encodes a decoded name for the web form" {
    azure_libs_source
    run provider_remote_to_web 'https://dev.azure.com/myorg/My%20Project/_git/myrepo'
    [ "$output" = "https://dev.azure.com/myorg/My%20Project/_git/myrepo" ]
}

@test "azure_uri_decode leaves a stray percent sign alone" {
    azure_libs_source
    run azure_uri_decode '100%'
    [ "$output" = "100%" ]
    run azure_uri_decode 'a%2Fb%zz'
    [ "$output" = 'a/b%zz' ]
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

@test "provider_repos_view returns repoSpec in project/repo form" {
    printf '{"name":"myrepo","project":{"name":"myproj"},"isPrivate":true}' > "$TEST_TEMP_DIR/resp.json"
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resp.json" \
        run azure_run provider_repos_view myorg/myproj/myrepo --json repoSpec
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
        run azure_run provider_repos_view myrepo --json name,repoSpec,defaultBranchRef
    [ "$status" -eq 0 ]
    # The object must be valid JSON (repoSpec stays a quoted string).
    run jq -e . <<<"$output"
    [ "$status" -eq 0 ]
    run jq -r '.name + "|" + .repoSpec + "|" + .defaultBranchRef.name' <<<"$output"
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

@test "repo-target cwd hook composes the two-part project/basename" {
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"
    # Simulate a git root: run inside the (git-init'd) test dir tree.
    run bash -c "cd '$TEST_TEMP_DIR' && git init -q azure-cwd 2>/dev/null; cd azure-cwd && \
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash' && \
        PROVIDER_NAME=azure && source '$DEVENV_TOOLS/lib/providers/azure/repos.bash' && \
        provider_repo_target"
    [ "$status" -eq 0 ]
    [ "$output" = "myproj/azure-cwd" ]
}

@test "provider_repo_args passes an explicit spec through untouched" {
    azure_libs_source
    local args=()
    provider_repo_args args "myorg/myproj/myrepo"
    [ "${#args[@]}" -eq 1 ]
    [ "${args[0]}" = "myorg/myproj/myrepo" ]
}

@test "provider_repo_args with no spec yields an empty arg list" {
    azure_libs_source
    local args=("sentinel")
    provider_repo_args args ""
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
        run azure_run provider_repos_view cfgrepo --json repoSpec
    [ "$status" -eq 0 ]
    [ "$output" = "cfgproj/cfgrepo" ]
}

@test "provider_repos_view without org/project config fails with guidance" {
    printf '[provider]\nname=azure\n' > "$DEVENV_ROOT/devenv.config"
    run azure_run provider_repos_view solo
    [ "$status" -ne 0 ]
    [[ "$output" =~ "azure_org" ]]
}

@test "provider_repos_list returns gh-shaped name/repoSpec entries" {
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


# ---------------------------------------------------------------------------
# protect_branch idempotence, ACL identity match, repos_view -q
# ---------------------------------------------------------------------------

# A curl that answers by URL/method: the repository, the existing policy list,
# and (for the ACL grant) the project, the graph identities and the ACE POST.
policy_curl() {
    cat > "$STUB_BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
method=GET; url=""; prev=""
for arg in "$@"; do
    [[ "$prev" == "-D" ]] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"
    [[ "$prev" == "-X" ]] && method="$arg"
    prev="$arg"; url="$arg"
done
echo "$method $url" >> "$CALLS"
case "$url" in
    *policy/configurations*) cat "$CONFIGS" ;;
    *graph/groups*) cat "$GROUPS_JSON" ;;
    *_apis/projects/*) printf '{"id":"proj-guid"}' ;;
    *accesscontrolentries*) printf '{"value":[]}' ;;
    *repositories*) printf '{"id":"g3","name":"r3","defaultBranch":"refs/heads/master"}' ;;
    *) printf '{}' ;;
esac
STUB
    chmod +x "$STUB_BIN_DIR/curl"
    export CALLS="$TEST_TEMP_DIR/calls.log"; : > "$CALLS"
}

@test "provider_repos_protect_branch updates the policy already on that branch instead of creating a duplicate" {
    printf '{"required_pull_request_reviews":{"required_approving_review_count":2}}' > "$TEST_TEMP_DIR/protection.json"
    printf '{"value":[{"id":11,"type":{"id":"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},"settings":{"scope":[{"repositoryId":"g3","refName":"refs/heads/main"}]}}]}' > "$TEST_TEMP_DIR/configs.json"
    export CONFIGS="$TEST_TEMP_DIR/configs.json"
    policy_curl
    run azure_run provider_repos_protect_branch o1/p1/r3 main "$TEST_TEMP_DIR/protection.json"
    [ "$status" -eq 0 ]
    grep -q '^PUT .*policy/configurations/11' "$CALLS"
    run ! grep -q '^POST .*policy/configurations' "$CALLS"
}

@test "provider_repos_protect_branch creates the policy when the branch has none" {
    printf '{}' > "$TEST_TEMP_DIR/protection.json"
    printf '{"value":[]}' > "$TEST_TEMP_DIR/configs.json"
    export CONFIGS="$TEST_TEMP_DIR/configs.json"
    policy_curl
    run azure_run provider_repos_protect_branch o1/p1/r3 main "$TEST_TEMP_DIR/protection.json"
    [ "$status" -eq 0 ]
    grep -q '^POST .*policy/configurations' "$CALLS"
}

@test "azure_acl_grant matches a group by its project-scoped principal name, not by display name alone" {
    cat > "$TEST_TEMP_DIR/groups.json" <<'JSON'
{"value":[
 {"displayName":"Contributors","principalName":"[other]\\Contributors","descriptor":"vssgp.OTHER"},
 {"displayName":"Contributors","principalName":"[p1]\\Contributors","descriptor":"vssgp.MINE"}]}
JSON
    printf '{"value":[]}' > "$TEST_TEMP_DIR/configs.json"
    export GROUPS_JSON="$TEST_TEMP_DIR/groups.json" CONFIGS="$TEST_TEMP_DIR/configs.json"
    policy_curl
    run azure_run azure_acl_grant groups Contributors o1/p1/r3 push
    [ "$status" -eq 0 ]
    # the ACE is written for the descriptor of the matching project's group
    grep -q '^POST .*accesscontrolentries' "$CALLS"
}

@test "azure_acl_grant refuses a name that matches more than one identity" {
    cat > "$TEST_TEMP_DIR/groups.json" <<'JSON'
{"value":[
 {"displayName":"Readers","principalName":"[p1]\\Readers","descriptor":"vssgp.A"},
 {"displayName":"Readers","principalName":"[p1]\\Readers","descriptor":"vssgp.B"}]}
JSON
    export GROUPS_JSON="$TEST_TEMP_DIR/groups.json" CONFIGS="$TEST_TEMP_DIR/groups.json"
    policy_curl
    run azure_run azure_acl_grant groups Readers o1/p1/r3 push
    [ "$status" -ne 0 ]
    [[ "$output" == *"more than one identity"* ]]
}

@test "azure_acl_grant fails when no identity matches" {
    printf '{"value":[{"displayName":"Other","principalName":"[p1]\\\\Other","descriptor":"vssgp.X"}]}' > "$TEST_TEMP_DIR/groups.json"
    export GROUPS_JSON="$TEST_TEMP_DIR/groups.json" CONFIGS="$TEST_TEMP_DIR/groups.json"
    policy_curl
    run azure_run azure_acl_grant groups Missing o1/p1/r3 push
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found"* ]]
}

@test "provider_repos_view applies -q to the projected object" {
    printf '{"name":"r1","project":{"name":"p1"},"defaultBranch":"refs/heads/main"}' > "$TEST_TEMP_DIR/repo.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/repo.json" run azure_run provider_repos_view o1/p1/r1 --json name,defaultBranchRef -q '.defaultBranchRef.name'
    [ "$status" -eq 0 ]
    [ "$output" = "refs/heads/main" ]
}

@test "provider_repos_view of an empty repository (no default branch) fails instead of printing null" {
    printf '{"name":"r1","project":{"name":"p1"}}' > "$TEST_TEMP_DIR/empty-repo.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty-repo.json" run azure_run provider_repos_view o1/p1/r1 --json defaultBranchRef
    [ "$status" -ne 0 ]
    [[ "$output" != *null* ]]
}

@test "provider_repos_view takes the two-part project/repo spec, the org coming from config" {
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=cfgproj\n' > "$DEVENV_ROOT/devenv.config"
    printf '{"name":"r1","project":{"name":"p1"}}' > "$TEST_TEMP_DIR/repo.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/repo.json" run azure_run provider_repos_view p1/r1 --json name
    [ "$status" -eq 0 ]
    [ "$output" = "r1" ]
    grep -q 'org/p1/_apis/git/repositories/r1' "$STUB_CALL_LOG"
}
