#!/usr/bin/env bash
# azure-smoke-test.sh (azure provider) - Live validation suite, single
# combined flow (opt-in gate; setup is licensed, teardown is mandatory).
#
# Manual validation only: never invoked by tests or CI. Verifies the azure
# provider verbs against a LIVE org through OUR transport
# (azure_http_request / azure_http_paginate), never raw curl — that is the
# point. Reads AND writes run in one flow: setup is licensed (the suite
# creates the fixtures read cases need), and everything created is torn
# down — the org outside the user-provided test project is never touched.
#
#   Gate:     interactive (tier/org/PAT prompts) or fully env-driven.
#   Project:  USER-PROVIDED test project (assumed blank/disposable). The
#             suite provisions nothing at project level; everything it
#             creates (repos, work items, PRs, policies) dies at teardown.
#
# Probes (tier 1, read-only):
#   1. Auth + api-version: one cheap authenticated GET
#   2. Repos list through azure_http_paginate — the ContinuationToken probe
#   3. WIQL query (issues list's transport path)
#   4. Work item view (when the WIQL probe found one)
#   5. PR list for the first repo
#
# Probes (tier 2, destructive): work item create → comment → close; branch
# push; PR create → rebase-merge → source-branch deletion — each runs only
# inside the self-provisioned test project.
#
# Usage:
#   AZURE_SMOKE=1 bash tools/lib/providers/azure/azure-smoke-test.sh
#   AZURE_SMOKE=write \
#       bash tools/lib/providers/azure/azure-smoke-test.sh
#
# Requires (self-contained — no devenv.config, no key-update tooling):
#   AZURE_PAT=<token>                     supplied at invocation, never persisted
#   AZURE_DEVOPS_ORG=<org>                the (live) org; the suite provisions
#                                         and destroys ONLY its own test project
#   AZURE_SMOKE=write tier additionally creates a disposable repo and work
#   items inside that project (never the project itself).
# Anything pre-existing in the org outside the suite's test project is
# never touched.
#
# Optional recording of live responses as fixtures:
#   AZURE_SMOKE_CAPTURE_DIR=<dir> saves each captured response there, redacted
#   (no credentials, identities, real GUIDs, org or project names) — see
#   smoke-capture.bash. The GUID map holds real values, lives in a private temp
#   file and is removed at teardown; it is never written to <dir>.

# shellcheck source=../../self-root.bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/lib/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
export PROVIDER_NAME="azure"
provider_load auth
source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
source "$DEVENV_TOOLS/lib/providers/azure/prs.bash"
source "$DEVENV_TOOLS/lib/providers/azure/pipelines.bash"
source "$DEVENV_TOOLS/lib/providers/azure/policies.bash"
source "$DEVENV_TOOLS/lib/providers/azure/projects.bash"
source "$DEVENV_TOOLS/lib/providers/azure/releases.bash"
source "$DEVENV_TOOLS/lib/providers/azure/repo-flag.bash"
source "$DEVENV_TOOLS/lib/providers/azure/smoke-capture.bash"

# From here on an unset variable is an error: a typo'd name must die loudly rather
# than fabricate empty-project URLs and malformed payloads. (After the sourced
# libraries, which are not written for nounset.)
set -u

# ---------------------------------------------------------------------------
# CASE CHECKLIST (first-hand sweep 2026-10-01 — derived from current module
# bodies, not the earlier audit; re-derive when modules change).
#
# Coverage accounting: every row is a provider function that either issues
# HTTP (row must have ≥1 smoke case) or is pure-local (row notes it is
# exercised via its callers). Tier: 1 = read-only, 2 = destructive/write.
#
# http.bash:        azure_http_request [1] ✅ · azure_http_paginate [1] ✅
#                   (+ redact/_pat_ensure/_auth_header local, via transport)
# auth.bash:        5 functions, no transport — exercised via key-update/seam
#                   (unit-covered in test_provider_azure_auth.bats)
# urls.bash:        8 functions, no transport — exercised via transport probes
# repo-flag.bash:   azure_repo_flag_spec, no transport — via parser cases
# org.bash:         no transport (sourcing dispatcher)
# issues.bash:      provider_issues_list/view/exists/comments/comment_get/
#                   comment_add/comment/close/reopen/edit [t1 reads / t2 writes]
#                   · graph link/children/parent/unlink [t2]
#                   · set_type, label_create/label_list/add_tag [t2]
#                   · label_ensure/label_update/milestones: no-transport no-ops
#                   · azure_issue_patch_state: exercised via close/field_set
# prs.bash:         provider_prs_list/view/diff/threads_page [t1]
#                   · create/merge/comment/threads/thread_reply/
#                     thread_create/thread_resolve [t2]
# repos.bash:       provider_repos_list/view/default_branch/commits_count [t1/t2]
#                   · repos_create [t2·project-scoped] · repos_patch [t2]
#                   · protect_branch [t2] · team_put/collaborator_put [t2·ACL]
#                   · org_packages_list [t1] · org_package_versions: typed
#                     failure — case asserts the defined error
#                   · repos_edit: no-op — case asserts warn+0
# pipelines.bash:   run_list/workflow_list/run_view [t1] · workflow_run [t2]
#                   · run_watch [t2, on triggered run] · run_cancel [t2]
#                   · run_artifacts/run_download [t2, needs artifact-bearing run]
#                   · run_rerun [t2] · wait_for_branch [t2, via run path]
# policies.bash:    org_rulesets_list [t1] · ruleset_create/update/get [t2]
# projects.bash:    projects_list/id_by_name/field_list/field_option_ids [t1]
#                   · field_set [t2] · for_issue [t2] · item_add/item_id: no-ops
# releases.bash:    org_releases_list [t1] · org_feeds_list [t1]
# SAFETY: every tier-2 request is project-scoped. The test project is
# USER-PROVIDED (assumed blank/disposable) via AZURE_SMOKE_TEST_PROJECT or
# prompt — the suite never provisions or deletes projects, and never
# touches anything outside that project.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Harness: report sink, project lifecycle (self-provisioning), marker gate.
# ---------------------------------------------------------------------------
REPORT_FILE="${AZURE_SMOKE_REPORT:-}"

# Teardown stack: register cleanup commands in creation order; the runner
# executes them in reverse at suite end (and after any late failure).
TEARDOWN_STACK=()
smoke_on_teardown() { TEARDOWN_STACK+=("$*"); }
_TEARDOWN_DONE=""
_TEARDOWN_FAILED=0
smoke_teardown_run() {
    [ -n "$_TEARDOWN_DONE" ] && return 0
    _TEARDOWN_DONE=1
    local i out
    for ((i=${#TEARDOWN_STACK[@]}-1; i>=0; i--)); do
        out=$(eval "${TEARDOWN_STACK[$i]}" 2>&1)
        if [ $? -ne 0 ]; then
            _TEARDOWN_FAILED=1
            echo "  teardown step failed: ${TEARDOWN_STACK[$i]}" >&2
            [ -n "$out" ] && echo "    detail: $(head -c 200 <<< "$out")" >&2
        fi
    done
}
# Teardown is mandatory even on a mid-suite death (a ${1:?} guard inside a
# provider verb exits the shell, bypassing the tail of the script): the
# EXIT trap re-runs the stack. The guard above makes re-entry a no-op.
trap smoke_teardown_run EXIT
# An interrupt or termination must tear down too: without these, Ctrl-C or a kill
# leaves the repo, work items and policies behind (EXIT alone does not run on a
# signal death).
trap 'smoke_teardown_run; exit 130' INT
trap 'smoke_teardown_run; exit 143' TERM
# Contract note: org + PAT arrive via env/config at invocation and are never
# persisted by this script (no config writes, no report secrets — the
# transport redacts).

report_line() {
    # Best-effort report sink — never fatal.
    [ -n "$REPORT_FILE" ] && printf '%s\n' "$*" >> "$REPORT_FILE" 2>/dev/null || true
}


# Interactive prompt for a missing value: reads from the terminal (never a
# piped/stdin context silently), echoes only when the value is not secret.
smoke_ask() {
    local var="$1" prompt="$2" secret="${3:-}"
    if [ -n "${!var:-}" ]; then return 0; fi
    if [ ! -t 0 ]; then
        echo "missing required input: $var (export it, or run interactively to be prompted)" >&2
        exit 2
    fi
    # Indirect read/export is the point: the variable NAMED by $var is the
    # target (shellcheck directives below; this is dynamic assignment).
    # shellcheck disable=SC2229
    if [ "$secret" = "secret" ]; then
        read -rsp "$prompt: " "$var" && echo >&2
    else
        # shellcheck disable=SC2229
        read -rp "$prompt: " "$var" && echo >&2
    fi
    [ -n "${!var:-}" ] || { echo "empty answer — aborting." >&2; exit 2; }
    # shellcheck disable=SC2163
    export "$var"
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
azure-smoke-test.sh — live validation suite for the Azure DevOps provider

Manual only; never invoked by tests or CI. One combined flow: provisions
fixtures INSIDE the user-provided test project, exercises every provider
verb (reads and writes), and tears down everything it created. The org
outside the test project is never touched.

USAGE
  Interactive (prompts for org / test project / PAT):
    bash tools/lib/providers/azure/azure-smoke-test.sh
  Env-driven (no prompts):
    AZURE_PAT=<token> AZURE_DEVOPS_ORG=<org> AZURE_SMOKE_TEST_PROJECT=<proj> \
        bash tools/lib/providers/azure/azure-smoke-test.sh
  Optional: AZURE_SMOKE_REPORT=<path> writes the per-verb pass/fail report.
  Optional: AZURE_SMOKE_CAPTURE_DIR=<dir> records each captured response there
            as a redacted fixture (no credentials, identities or real GUIDs).

REQUIRED
  1. AZURE_DEVOPS_ORG — the (live) org (prompted if unset)
  2. AZURE_SMOKE_TEST_PROJECT — a blank/disposable test project (prompted)
  3. AZURE_PAT — token with project/code/boards/build/policy rights
     (env-supplied at invocation; never persisted by the suite)

OUTPUT
  Status lines and counts only; the transport redacts the token on every
  path — safe to paste anywhere.
HELP
    exit 0
fi

# --- Safety gate (two tiers) ------------------------------------------------
# The suite talks to a LIVE org; it never runs by accident.
#   AZURE_SMOKE=1      read-only tier: no fixtures are created, nothing is written.
#   AZURE_SMOKE=write  destructive tier: creates and tears down fixtures inside the
#                      test project, and additionally needs an explicit confirmation
#                      (AZURE_SMOKE_CONFIRM=<test project name>, or typed at a prompt).
case "${AZURE_SMOKE:-}" in
    1)     SMOKE_TIER="read" ;;
    write) SMOKE_TIER="write" ;;
    *)
        echo "azure-smoke-test refuses to run: it exercises a LIVE Azure DevOps org." >&2
        echo "  AZURE_SMOKE=1      read-only tier" >&2
        echo "  AZURE_SMOKE=write  destructive tier (also needs AZURE_SMOKE_CONFIRM=<test project>)" >&2
        exit 2 ;;
esac

smoke_ask AZURE_DEVOPS_ORG "Azure DevOps org (the live org — only the test project is touched): "
# devenv.config fallback: only meaningful when the config actually selects
# the azure provider — a github-provider config carries no azure_org, so
# consulting it would just produce an empty value.
if [ -z "$AZURE_DEVOPS_ORG" ] && [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ] && [ -f "${DEVENV_ROOT:-}/devenv.config" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/config-reader.bash"
    if config_init "${DEVENV_ROOT}/devenv.config" 2>/dev/null; then
        if [ "$(config_read_value "provider" "name" "" 2>/dev/null)" = "azure" ]; then
            AZURE_DEVOPS_ORG=$(config_read_value "provider" "azure_org" "" 2>/dev/null)
        fi
    fi
fi
[ -n "$AZURE_DEVOPS_ORG" ] || { echo "no org resolved (env or prompt)." >&2; exit 2; }
export AZURE_DEVOPS_ORG

smoke_ask AZURE_SMOKE_TEST_PROJECT "Test project for the suite (must be blank/disposable): "
[ -n "$AZURE_SMOKE_TEST_PROJECT" ] || { echo "no test project." >&2; exit 2; }

# Destructive tier: the user must name the project they are about to have written to.
if [ "$SMOKE_TIER" = "write" ] && [ "${AZURE_SMOKE_CONFIRM:-}" != "$AZURE_SMOKE_TEST_PROJECT" ]; then
    if [ -t 0 ]; then
        read -rp "AZURE_SMOKE=write will create and delete fixtures in project '$AZURE_SMOKE_TEST_PROJECT'. Type the project name to confirm: " AZURE_SMOKE_CONFIRM
    fi
    if [ "${AZURE_SMOKE_CONFIRM:-}" != "$AZURE_SMOKE_TEST_PROJECT" ]; then
        echo "destructive tier not confirmed: set AZURE_SMOKE_CONFIRM=$AZURE_SMOKE_TEST_PROJECT (the exact test project name)." >&2
        exit 2
    fi
fi

smoke_ask AZURE_PAT "PAT (input hidden; needs Code/PR/WorkItems/Boards/Build/Packaging AND Policy management read+write): " secret

pass=0
fail=0
probe() {
    local name="$1" ok="$2" detail="${3:-}"
    if [ "$ok" = "0" ]; then
        echo "PASS  $name${detail:+ — $detail}"
        report_line "PASS  $name${detail:+ — $detail}"
        pass=$((pass + 1))
    else
        echo "FAIL  $name${detail:+ — $detail}"
        report_line "FAIL  $name${detail:+ — $detail}"
        fail=$((fail + 1))
    fi
}
# Outcome probe: PASS only when the jq FILTER holds for the JSON — the check names
# the thing that must be true, not just that the call exited 0.
probe_outcome() {
    local name="$1" json="$2" filter="$3" detail="${4:-}"
    if smoke_jq_ok "$json" "$filter"; then
        probe "$name" 0 "$detail"
    else
        probe "$name" 1 "outcome check failed: $filter${detail:+ — $detail}"
    fi
}

# Record a response as a redacted fixture (no-op without AZURE_SMOKE_CAPTURE_DIR).
probe_capture() {
    printf '%s' "$2" | smoke_capture "$1"
}

# Capture needs a private GUID map (real values — never in the capture dir); it is
# removed with the rest of the teardown.
if [ -n "${AZURE_SMOKE_CAPTURE_DIR:-}" ]; then
    smoke_redact_map_init >/dev/null
    smoke_on_teardown "rm -f '$SMOKE_REDACT_MAP'"
fi

SMOKE_REPO="${AZURE_SMOKE_TEST_REPO:-smoke-repo-$$}"  # AZURE_SMOKE_TEST_REPO: optional env override for the disposable repo name

echo "azure smoke — combined suite"
echo "=============================="
echo "target: org=$AZURE_DEVOPS_ORG test-project=$AZURE_SMOKE_TEST_PROJECT tier=$SMOKE_TIER"

# Pre-flight: the test project must exist (fail fast with a real diagnosis
# instead of a 404 cascade through every case). AZURE_PAT may not be set
# yet at this point in the env-driven path — the transport self-heals from
# the PAT file; for the interactive path the prompt already collected it.
_preflight=""
_preflight="$(AZURE_PAT="${AZURE_PAT:-}" azure_http_request GET "https://dev.azure.com/${AZURE_DEVOPS_ORG}/_apis/projects?api-version=7.1" 2>/dev/null)" || {
    echo "FAIL pre-flight: cannot list projects in org '$AZURE_DEVOPS_ORG' — check org name and PAT." >&2
    exit 1
}
if ! printf '%s' "$_preflight" | jq -e --arg p "$AZURE_SMOKE_TEST_PROJECT" '.value[] | select(.name == $p)' >/dev/null 2>&1; then
    echo "FAIL pre-flight: project '$AZURE_SMOKE_TEST_PROJECT' does not exist in org '$AZURE_DEVOPS_ORG'." >&2
    echo "Create it in the portal first (blank/disposable), then re-run." >&2
    echo "Known projects: $(printf '%s' "$_preflight" | jq -r '.value[].name' | tr '\n' ' ')" >&2
    exit 1
fi
probe "pre-flight: test project exists" 0

# Every provider_* call resolves targeting from these two — project-scoped
# to the user-provided test project for the whole run.
export AZURE_DEVOPS_ORG AZURE_DEVOPS_PROJECT="$AZURE_SMOKE_TEST_PROJECT"
org="$AZURE_DEVOPS_ORG"
project="$AZURE_SMOKE_TEST_PROJECT"

projects_resp=""
if projects_resp="$(azure_http_request GET "https://dev.azure.com/${org}/_apis/projects" 2>/dev/null)"; then
    probe "auth + api-version (projects list)" 0 "authenticated GET ok"
else
    probe "auth + api-version (projects list)" 1 "$(printf '%s' "$projects_resp" | head -c 200)"
    echo "auth failed — aborting remaining probes." >&2
    echo "summary: $pass pass, $fail fail"
    exit 1
fi

# --- 2. Repos list through OUR paginate (the ContinuationToken probe) -----
repos_json=""
if repos_json="$(azure_http_paginate "https://dev.azure.com/${org}/${project}/_apis/git/repositories" 2>/dev/null)"; then
    count="$(printf '%s' "$repos_json" | jq 'length')"
    probe "repos list via azure_http_paginate" 0 "$count repos"
    echo "note: if this count looks smaller than the portal shows, continuation is body-based, not header-based — http.bash needs the fallback"
else
    probe "repos list via azure_http_paginate" 1 "$(printf '%s' "$repos_json" | head -c 200)"
fi

# --- 3. WIQL (issues list transport path) ----------------------------------
wiql='{"query":"SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id] DESC"}'
base="https://dev.azure.com/${org}/${project}/_apis/wit"
wiql_resp=""
if wiql_resp="$(azure_http_request POST "$base/wiql" "$wiql" 2>/dev/null)"; then
    wi_count="$(printf '%s' "$wiql_resp" | jq '.workItems | length')"
    probe "WIQL query (work items found)" 0 "$wi_count ids"
else
    probe "WIQL query (work items found)" 1 "$(printf '%s' "$wiql_resp" | head -c 200)"
    wi_count=""
fi

# --- 4. Fixture provisioning (licensed setup for the reads that follow) ----
# One work item + one disposable repo, created through the provider verbs.
# Everything created here is torn down at the end of the suite.
first_id=""
first_repo=""
if [ "$SMOKE_TIER" != "write" ]; then
    echo "SKIP  fixture provisioning (read-only tier: AZURE_SMOKE=1)"
    # Read probes below use an existing repo, if the project has one.
    first_repo="$(printf '%s' "$repos_json" | jq -r '.[0].name // empty' 2>/dev/null || true)"
else
if wi_resp="$(azure_http_request POST "$(azure_wit_base)/workitems/\$Issue" '[{"op":"add","path":"/fields/System.Title","from":null,"value":"[SMOKE-DELETEME] fixture item"}]' "application/json-patch+json" 2>/dev/null)"; then
    first_id="$(printf '%s' "$wi_resp" | jq -r '.id')"
    smoke_on_teardown "azure_http_request DELETE \"$(azure_wit_base)/workitems/$first_id?destroy=true\""
    probe "fixture work item (id $first_id)" 0
else
    probe "fixture work item" 1 "$(printf '%s' "$wi_resp" | head -c 200)"
fi

first_repo="$SMOKE_REPO"
if provider_repos_create "$first_repo" >/dev/null 2>&1 || provider_repos_create "$first_repo" --private >/dev/null 2>&1; then
    probe "fixture repo ($first_repo)" 0
    # Register the repo's teardown NOW, the moment it exists, so a death at any
    # later point still removes it. The stack is LIFO: the repo DELETE is
    # registered first and the policy sweep second, so the sweep runs while the
    # repo still exists (reversed, no policy the suite created is ever found).
    # Repo DELETE: live-observed matrix — name+destroy can 400, GUID+destroy can
    # 400, plain DELETE (soft-delete) always works; fall through all three.
    smoke_on_teardown "azure_http_request DELETE \"https://dev.azure.com/${org}/${project}/_apis/git/repositories/${first_repo}?destroy=true\" || azure_http_request DELETE \"https://dev.azure.com/${org}/${project}/_apis/git/repositories/\$(azure_repo_guid \"$first_repo\" 2>/dev/null)?destroy=true\" || azure_http_request DELETE \"https://dev.azure.com/${org}/${project}/_apis/git/repositories/\$(azure_repo_guid \"$first_repo\" 2>/dev/null)\""
    smoke_on_teardown "for pid in \$(provider_org_rulesets_list \"$first_repo\" 2>/dev/null | jq -r '.[].id' 2>/dev/null); do azure_http_request DELETE \"https://dev.azure.com/${org}/${project}/_apis/policy/configurations/\$pid\"; done"
else
    probe "fixture repo ($first_repo)" 1
fi
fi

# --- 5. Reads on the fixtures (thorough: rc + shape) ------------------------
if [ -n "$first_id" ]; then
    wi_view=""
    if wi_view="$(provider_issues_view "" "$first_id" 2>/dev/null)"; then
        probe "provider_issues_view" 0 "title: $(printf '%s' "$wi_view" | jq -r '.title' | head -c 60)"
    else
        probe "provider_issues_view" 1 "$(printf '%s' "$wi_view" | head -c 200)"
    fi
    if provider_issues_exists "" "$first_id" >/dev/null 2>&1; then
        probe "provider_issues_exists" 0
    else
        probe "provider_issues_exists" 1
    fi
    if provider_issues_comments "" "$first_id" >/dev/null 2>&1; then
        probe "provider_issues_comments" 0
    else
        probe "provider_issues_comments" 1
    fi
else
    echo "SKIP  issues reads (fixture item failed)"
fi

if [ -n "$first_repo" ]; then
    prs_resp=""
    if prs_resp="$(provider_prs_list "$first_repo" 2>/dev/null)"; then
        probe "provider_prs_list (verb)" 0 "$(printf '%s' "$prs_resp" | jq 'length' 2>/dev/null) PRs"
    else
        probe "provider_prs_list (verb)" 1 "$(printf '%s' "$prs_resp" | head -c 200)"
    fi
    # An empty repository has no default branch: the verb must say so (fail), not
    # print "null"; a repository with commits must return its branch.
    first_repo_raw="$(provider_repos_view "$first_repo" 2>/dev/null || true)"
    if [ -n "$first_repo_raw" ] && [ -z "$(printf '%s' "$first_repo_raw" | jq -r '.defaultBranch // empty' 2>/dev/null)" ]; then
        if db_out="$(provider_repos_default_branch "$first_repo" 2>/dev/null)"; then
            probe "provider_repos_default_branch (empty repository)" 1 "returned '${db_out}' for a repository with no default branch"
        else
            probe "provider_repos_default_branch (empty repository fails defined)" 0
        fi
    elif db_out="$(provider_repos_default_branch "$first_repo" 2>/dev/null)" && [ -n "$db_out" ] && [ "$db_out" != "null" ]; then
        probe "provider_repos_default_branch" 0 "$db_out"
    else
        probe "provider_repos_default_branch" 1
    fi
    # An empty repo 404s on the commits query — that is the documented
    # read-before-push case: SKIP, with a re-probe after the branch push.
    if cc_out="$(provider_repos_commits_count "$org/$project/$first_repo" 2>&1)"; then
        probe "provider_repos_commits_count (pre-push)" 0 "count: ${cc_out:-0}"
    else
        echo "SKIP  provider_repos_commits_count (pre-push: $(head -c 100 <<< "$cc_out"))"
    fi
    if provider_org_releases_list "$first_repo" >/dev/null 2>&1; then
        probe "provider_org_releases_list" 0
    else
        probe "provider_org_releases_list" 1
    fi
    if provider_org_rulesets_list "$first_repo" >/dev/null 2>&1; then
        probe "provider_org_rulesets_list" 0
    else
        probe "provider_org_rulesets_list" 1
    fi
else
    echo "SKIP  repos reads (fixture repo failed)"
fi

# --- Fixture-free reads (no entity dependencies) ---------------------------
if provider_org_feeds_list >/dev/null 2>&1; then
    probe "provider_org_feeds_list" 0
else
    probe "provider_org_feeds_list" 1
fi
if provider_org_packages_list >/dev/null 2>&1; then
    probe "provider_org_packages_list" 0
else
    probe "provider_org_packages_list" 1
fi
# Transport-level reference point for the run_list case: a raw /builds GET
# through the same transport (PAT rides the Authorization header — never
# argv). Records the endpoint's health independently of the verb's
# composition, so a verb FAIL with a healthy raw GET isolates the verb.
_bld_resp=$(azure_http_request GET "https://dev.azure.com/${AZURE_DEVOPS_ORG}/${AZURE_SMOKE_TEST_PROJECT}/_apis/build/builds?api-version=7.1" 2>/dev/null)
_bld_code=$?; [ $_bld_code -eq 0 ] && _bld_code=200 || _bld_code=$(printf '%s' "$_bld_resp" | jq -r '.code // "err"' 2>/dev/null)
if _prl=$(provider_pipelines_run_list 2>&1); then
    probe "provider_pipelines_run_list (project-scoped)" 0 "runs: $(printf '%s' "$_prl" | jq 'length' 2>/dev/null || echo '?')"
else
    probe "provider_pipelines_run_list (project-scoped)" 1 "$(head -c 160 <<< "$_prl") | raw /builds transport rc: ${_bld_code:-unknown}"
fi
if provider_projects_list >/dev/null 2>&1; then
    probe "provider_projects_list (boards)" 0
else
    probe "provider_projects_list (boards)" 1
fi
if provider_projects_field_list >/dev/null 2>&1; then
    probe "provider_projects_field_list (columns)" 0
else
    probe "provider_projects_field_list (columns)" 1
fi
# Use an option the project ACTUALLY has (board-dependent — don't assume a
# column name): the first column from field_list.
_smoke_first_state=$(provider_projects_field_list 2>/dev/null | jq -r '.option // empty' 2>/dev/null | head -1)
_foi=""
if [ -n "$_smoke_first_state" ] && _foi=$(provider_projects_field_option_ids "$project" "Status" "$_smoke_first_state" 2>&1); then
    probe "provider_projects_field_option_ids" 0 "$_smoke_first_state → $_foi"
else
    probe "provider_projects_field_option_ids" 1 "$(head -c 120 <<< "$_foi")"
fi

# --- Tier 1 outcome checks and fixture captures (read-only) -----------------
# These assert OUTCOMES against what the live service returns, not only that a
# call exited 0, and record the responses (redacted, when AZURE_SMOKE_CAPTURE_DIR
# is set) as the fixtures the provider bats tests are written against. Checks that
# need created data (threads, multi-tag items, writing the column field) run in
# the write tier.
probe_capture "repos.list" "${repos_json:-[]}"
[ -n "${wiql_resp:-}" ] && probe_capture "wiql.query" "$wiql_resp"

# PR list: the verb's --state filter must return the PRs in that state, no others.
smoke_check_pr_states() {
    local repo="$1" raw verb completed non_active
    if ! raw="$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/pullrequests?searchCriteria.status=all&api-version=7.1" 2>/dev/null)"; then
        probe "PR list raw (all states)" 1 "raw GET failed for $repo"
        return 0
    fi
    probe_capture "pullrequests.list.all" "$raw"
    if ! smoke_jq_ok "$raw" '(.value | length) > 0'; then
        echo "SKIP  PR list state filters (no pull requests in $repo)"
        return 0
    fi
    completed="$(printf '%s' "$raw" | jq '[.value[] | select(.status == "completed")] | length')"
    non_active="$(printf '%s' "$raw" | jq '[.value[] | select(.status != "active")] | length')"
    if verb="$(provider_prs_list "$repo" --state merged 2>/dev/null)"; then
        probe_outcome "provider_prs_list --state merged returns only merged PRs" "$verb" 'all(.[]; .state == "MERGED")'
        probe_outcome "provider_prs_list --state merged returns every completed PR" "$verb" "length == $completed"
    else
        probe "provider_prs_list --state merged" 1 "verb failed"
    fi
    if verb="$(provider_prs_list "$repo" --state closed 2>/dev/null)"; then
        probe_outcome "provider_prs_list --state closed returns every non-active PR" "$verb" "all(.[]; .state != \"OPEN\") and length == $non_active"
    else
        probe "provider_prs_list --state closed" 1 "verb failed"
    fi
}
if [ -n "$first_repo" ]; then
    smoke_check_pr_states "$first_repo"
fi

# Work item tags: the verb's labels must equal the raw System.Tags, split on ';'
# and trimmed (Azure stores them as "a; b").
smoke_check_work_item_tags() {
    local id="$1" raw raw_tags verb
    if ! raw="$(azure_http_request GET "$(azure_wit_base)/workitems/${id}?\$expand=all&api-version=7.1" 2>/dev/null)"; then
        probe "work item raw GET ($id)" 1 "raw GET failed"
        return 0
    fi
    probe_capture "workitem.get" "$raw"
    probe_outcome "work item raw shape (id, System.State)" "$raw" '.id != null and .fields["System.State"] != null'
    raw_tags="$(printf '%s' "$raw" | jq -c '[(.fields["System.Tags"] // "") | split(";")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)]')"
    if [ "$raw_tags" = "[]" ]; then
        echo "SKIP  work item tags round-trip ($id has no tags; the write tier covers it)"
        return 0
    fi
    if verb="$(provider_issues_view "" "$id" 2>/dev/null)"; then
        probe_outcome "provider_issues_view labels equal the raw System.Tags (trimmed)" "$verb" "([.labels[].name] | sort) == ($raw_tags | sort)"
    else
        probe "provider_issues_view ($id)" 1 "verb failed"
    fi
}
_t1_wi="${first_id:-}"
[ -n "$_t1_wi" ] || _t1_wi="$(printf '%s' "${wiql_resp:-}" | jq -r '.workItems[0].id // empty' 2>/dev/null || true)"
if [ -n "$_t1_wi" ]; then
    smoke_check_work_item_tags "$_t1_wi"
else
    echo "SKIP  work item tags round-trip (no work item exists)"
fi

# Board columns must equal the configured status_workflow (azure-setup.sh converges
# them). Whether a column can be written is checked on a board-backed work item in
# the write tier (the org-wide fields list never carries the board column fields).
smoke_check_board_columns() {
    local expected="${AZURE_SMOKE_STATUS_WORKFLOW:-}" expected_json team boards bid bname cols
    if [ -z "$expected" ] && declare -F config_read_value >/dev/null; then
        expected="$(config_read_value workflows status_workflow "" 2>/dev/null || true)"
    fi
    team="$(azure_default_team_id 2>/dev/null || true)"
    if [ -z "$team" ]; then
        echo "SKIP  board columns (default team not resolvable)"
        return 0
    fi
    if ! boards="$(azure_http_request GET "https://dev.azure.com/${org}/${project}/${team}/_apis/work/boards?api-version=7.1" 2>/dev/null)"; then
        probe "boards list" 1 "raw GET failed"
        return 0
    fi
    probe_capture "boards.list" "$boards"
    if [ -z "$expected" ]; then
        echo "SKIP  board columns vs status_workflow (set AZURE_SMOKE_STATUS_WORKFLOW or [workflows] status_workflow)"
    else
        expected_json="$(printf '%s' "$expected" | jq -Rc 'split(",") | map(gsub("^\\s+|\\s+$"; ""))')"
    fi
    while IFS=$'\t' read -r bid bname; do
        [ -n "$bid" ] || continue
        if ! cols="$(azure_http_request GET "https://dev.azure.com/${org}/${project}/${team}/_apis/work/boards/${bid}/columns?api-version=7.1" 2>/dev/null)"; then
            probe "board '$bname' columns" 1 "raw GET failed"
            continue
        fi
        probe_capture "board.columns.${bname}" "$cols"
        if [ -n "${expected_json:-}" ]; then
            probe_outcome "board '$bname' columns equal status_workflow" "$cols" "[.value[].name] == $expected_json"
        fi
    done < <(printf '%s' "$boards" | jq -r '.value[]? | [.id, .name] | @tsv')
}
smoke_check_board_columns

_t1_pid="$(printf '%s' "$_preflight" | jq -r --arg p "$project" '.value[] | select(.name == $p) | .id' 2>/dev/null || true)"
if [ -n "$_t1_pid" ]; then
    _t1_proj="$(azure_http_request GET "https://dev.azure.com/${org}/_apis/projects/${_t1_pid}?includeCapabilities=true&api-version=7.1" 2>/dev/null || true)"
    probe_capture "project.capabilities" "$_t1_proj"
    probe_outcome "project process is Agile" "$_t1_proj" '.capabilities.processTemplate.templateName == "Agile"'
fi

# State sets differ per work item type (an Agile Issue has Active and Closed; a User
# Story has New, Active, Resolved and Closed), so record both.
for _t1_type in Issue "User%20Story"; do
    _t1_states="$(azure_http_request GET "$(azure_wit_base)/workitemtypes/${_t1_type}/states?api-version=7.1" 2>/dev/null || true)"
    if smoke_jq_ok "$_t1_states" '.value | type == "array"'; then
        probe_capture "workitemtypes.$(printf '%s' "$_t1_type" | tr 'A-Z%' 'a-z-' | sed 's/-20/-/').states" "$_t1_states"
        probe_outcome "${_t1_type//%20/ } type has an InProgress and a Completed state" "$_t1_states" 'any(.value[]; .category == "InProgress") and any(.value[]; .category == "Completed")'
    fi
done

# --- Tier 2 outcome checks (defined here; only called from the write tier) ----

# A merge must leave the PR completed, the source branch gone, and — for a rebase
# merge — a linear history (the default branch head has one parent, not a merge
# commit's two).
# Completion is asynchronous (mergeStatus "queued", status "active" for a while after
# the completing PATCH), so poll before judging the outcome.
smoke_wait_pr_completed() {
    local repo="$1" pr="$2" raw="" i
    for ((i = 0; i < ${AZURE_SMOKE_POLL_MAX:-30}; i++)); do
        raw="$(azure_http_request GET "$(azure_pr_base "$repo")/pullrequests/${pr}?api-version=7.1" 2>/dev/null || true)"
        smoke_jq_ok "$raw" '.status == "completed"' && break
        sleep "${AZURE_SMOKE_POLL_INTERVAL:-2}"
    done
    printf '%s' "$raw"
}
smoke_check_merge_outcome() {
    local repo="$1" pr="$2" src="$3" base_branch="$4" raw refs top commit
    local repo_url="https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}"
    if raw="$(smoke_wait_pr_completed "$repo" "$pr")" && [ -n "$raw" ]; then
        probe_capture "pullrequest.completed" "$raw"
        probe_outcome "merged PR is completed" "$raw" '.status == "completed"'
        probe_outcome "merge used the rebase strategy" "$raw" '.completionOptions.mergeStrategy == "rebase"'
    else
        probe "merged PR is completed" 1 "raw GET failed"
    fi
    if refs="$(azure_http_request GET "${repo_url}/refs?filter=heads/${src}&api-version=7.1" 2>/dev/null)"; then
        probe_capture "refs.after-merge" "$refs"
        probe_outcome "source branch is deleted after the merge" "$refs" '.count == 0'
    else
        probe "source branch is deleted after the merge" 1 "raw GET failed"
    fi
    top="$(azure_http_request GET "${repo_url}/commits?searchCriteria.itemVersion.version=${base_branch}&searchCriteria.\$top=1&api-version=7.1" 2>/dev/null | jq -r '.value[0].commitId // empty' 2>/dev/null || true)"
    if [ -n "$top" ] && commit="$(azure_http_request GET "${repo_url}/commits/${top}?api-version=7.1" 2>/dev/null)"; then
        probe_capture "commit.after-merge" "$commit"
        probe_outcome "rebase merge leaves a linear history (head commit has one parent)" "$commit" '.parents | length == 1'
    else
        probe "rebase merge leaves a linear history" 1 "head commit of ${base_branch} not resolvable"
    fi
}

# Review threads: the verb's thread list must carry the real thread ids, and a
# resolve must show as resolved. A reply addressed the way the wrapper does (by the
# comment's id) must land in the thread it was addressed to.
smoke_check_threads() {
    local repo="$1" pr="$2" th_a="$3" th_b="$4" raw page db
    if raw="$(azure_http_request GET "$(azure_pr_base "$repo")/pullrequests/${pr}/threads?api-version=7.1" 2>/dev/null)"; then
        probe_capture "pullrequest.threads" "$raw"
        probe_outcome "raw thread has a string status" "$raw" "any(.value[]; (.id | tostring) == \"$th_a\" and (.status | type) == \"string\")"
    else
        probe "raw threads GET" 1 "raw GET failed"
    fi
    if page="$(provider_prs_threads_page "$repo" "$pr" 2>/dev/null)"; then
        probe_capture "threads-page.before-resolve" "$page"
        probe_outcome "threads_page lists thread $th_a under its real id and unresolved" "$page" \
            "[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id | endswith(\"/$th_a\"))] | length == 1 and .[0].isResolved == false"
        db="$(printf '%s' "$page" | jq -r "[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id | endswith(\"/$th_b\"))][0].comments.nodes[0].id // empty" 2>/dev/null || true)"
        if [ -n "$db" ] && provider_prs_thread_reply "$repo" "$pr" "$db" "wrapper-addressed reply" >/dev/null 2>&1; then
            raw="$(azure_http_request GET "$(azure_pr_base "$repo")/pullrequests/${pr}/threads/${th_b}?api-version=7.1" 2>/dev/null || true)"
            probe_capture "pullrequest.thread.after-reply" "$raw"
            probe_outcome "a reply addressed by comment id lands in its own thread" "$raw" '(.comments | length) == 2'
            probe_outcome "the reply nests under the comment it was addressed to" "$raw" '.comments[1].parentCommentId == 1'
        else
            probe "a reply addressed by comment id lands in its own thread" 1 "no comment id for thread $th_b, or the reply was rejected"
        fi
    else
        probe "provider_prs_threads_page (shape)" 1 "verb failed"
    fi
}
smoke_check_threads_resolved() {
    local repo="$1" pr="$2" th_a="$3" page raw
    raw="$(azure_http_request GET "$(azure_pr_base "$repo")/pullrequests/${pr}/threads/${th_a}?api-version=7.1" 2>/dev/null || true)"
    probe_capture "pullrequest.thread.resolved" "$raw"
    probe_outcome "resolved thread has a closed-type status" "$raw" '(.status | type) == "string" and .status != "active" and .status != "pending"'
    if page="$(provider_prs_threads_page "$repo" "$pr" 2>/dev/null)"; then
        probe_capture "threads-page.after-resolve" "$page"
        probe_outcome "threads_page shows the resolved thread as resolved" "$page" \
            "[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id | endswith(\"/$th_a\"))] | length == 1 and .[0].isResolved == true"
    fi
}

# Labels: two adds leave two trimmed tags; --add-label preserves the existing tags;
# --remove-label removes exactly that tag.
smoke_work_item_tags() {  # <id> → trimmed tag array on stdout
    azure_http_request GET "$(azure_wit_base)/workitems/${1}?api-version=7.1" 2>/dev/null \
        | jq -c '[(.fields["System.Tags"] // "") | split(";")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)] | sort'
}
smoke_check_tag_edits() {
    local id="$1" tags
    provider_issues_label_create "" "smoke-tag-2" "" "" --issue "$id" >/dev/null 2>&1 || true
    tags="$(smoke_work_item_tags "$id")"
    probe_capture "workitem.tags.two" "$(azure_http_request GET "$(azure_wit_base)/workitems/${id}?api-version=7.1" 2>/dev/null || true)"
    probe_outcome "two label adds leave two tags" "$tags" '. == ["smoke-tag","smoke-tag-2"]'
    smoke_check_work_item_tags "$id"
    provider_issues_edit "" "$id" --add-label "extra-tag" >/dev/null 2>&1 || true
    probe_outcome "edit --add-label keeps the existing tags" "$(smoke_work_item_tags "$id")" '. == ["extra-tag","smoke-tag","smoke-tag-2"]'
    provider_issues_edit "" "$id" --remove-label "smoke-tag-2" >/dev/null 2>&1 || true
    probe_outcome "edit --remove-label removes only that tag" "$(smoke_work_item_tags "$id")" '. == ["extra-tag","smoke-tag"]'
}

# Status round-trip: every status_workflow word, set the way the wrappers set it
# (field_option_ids → field_set) and read back the way they read it (for_issue),
# must read back as itself; and the board Kanban column field must be writable.
smoke_check_status_roundtrip() {
    local id="$1" label="${2:-Issue}" words="${AZURE_SMOKE_STATUS_WORKFLOW:-}" word fid oid got kf_ref raw
    if [ -z "$words" ] && declare -F config_read_value >/dev/null; then
        words="$(config_read_value workflows status_workflow "" 2>/dev/null || true)"
    fi
    if [ -z "$words" ]; then
        echo "SKIP  status round-trip (set AZURE_SMOKE_STATUS_WORKFLOW or [workflows] status_workflow)"
        return 0
    fi
    raw="$(azure_http_request GET "$(azure_wit_base)/workitems/${id}?\$expand=all&api-version=7.1" 2>/dev/null || true)"
    kf_ref="$(printf '%s' "$raw" | jq -r '[.fields | keys[] | select(test("^WEF_.*_Kanban\\.Column$"))][0] // empty' 2>/dev/null || true)"
    if [ -z "$kf_ref" ]; then
        probe "work item type [$label] carries a board Kanban column field" 1 "no WEF_*_Kanban.Column field on item $id — this type is on no board"
    fi
    local -a _words
    IFS=',' read -ra _words <<< "$words"
    for word in "${_words[@]}"; do
        word="$(printf '%s' "$word" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
        [ -n "$word" ] || continue
        # (a) the Kanban column field: write the column name, read the field back
        if [ -n "$kf_ref" ]; then
            if azure_http_request PATCH "$(azure_wit_base)/workitems/${id}?api-version=7.1" \
                "$(jq -cn --arg p "/fields/$kf_ref" --arg v "$word" '[{op:"replace",path:$p,value:$v}]')" \
                "application/json-patch+json" >/dev/null 2>&1; then
                raw="$(azure_http_request GET "$(azure_wit_base)/workitems/${id}?\$fields=System.State,System.BoardColumn,${kf_ref}&api-version=7.1" 2>/dev/null || true)"
                probe_capture "kanban.column.${word}" "$raw"
                probe_outcome "Kanban column write [$label]: '$word' reads back" "$raw" ".fields[\"$kf_ref\"] == \"$word\""
            else
                probe "Kanban column write [$label]: '$word' reads back" 1 "PATCH of $kf_ref rejected"
            fi
        fi
        # (b) the wrapper path
        if read -r fid oid <<< "$(provider_projects_field_option_ids "$project" "Status" "$word" 2>/dev/null)" \
           && [ -n "${oid:-}" ] \
           && provider_projects_field_set "$project" "$id" "$fid" "$oid" >/dev/null 2>&1; then
            got="$(provider_projects_for_issue "https://dev.azure.com/${org}/${project}/_workitems/edit/${id}" "" 2>/dev/null | cut -f3)"
            if [ "$got" = "$word" ]; then
                probe "status round-trip [$label]: '$word' reads back as itself" 0
            else
                probe "status round-trip [$label]: '$word' reads back as itself" 1 "read back '${got:-<none>}'"
            fi
        else
            probe "status round-trip [$label]: '$word' reads back as itself" 1 "the status could not be set through the wrapper path"
        fi
    done
}

# A REVIEW: PR (pr-create-for-review) pushes two temporary branches, opens a draft
# PR between them and then deletes both. Record what the provider does to that PR
# when its branches disappear — evidence, not an assertion: the result decides how
# review branches are retired.
smoke_check_review_pr_branch_delete() {
    local repo="$1" base_branch="$2" tgt="review/smoke-$$-target" srcb="review/smoke-$$-source" pr_json pr_id raw
    if ! (
        cd "$tmpclone" 2>/dev/null || exit 1
        git checkout -q -b "$tgt" "origin/$base_branch" 2>/dev/null || git checkout -q -b "$tgt" || exit 1
        GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 git push -q origin "$tgt" 2>/dev/null || exit 1
        git checkout -q -b "$srcb" "$tgt" 2>/dev/null || exit 1
        echo "review smoke $$" > REVIEW.md && git add REVIEW.md && git commit -q -m "chore: review smoke" 2>/dev/null || exit 1
        GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 git push -q origin "$srcb" 2>/dev/null || exit 1
    ); then
        probe "review PR setup (branches pushed)" 1 "branch push failed"
        return 0
    fi
    if ! pr_json="$(provider_prs_create "$repo" --title "REVIEW: smoke" --body "smoke" --head "$srcb" --base "$tgt" --draft 2>&1)"; then
        probe "review PR create" 1 "$(head -c 120 <<< "$pr_json")"
        return 0
    fi
    pr_id="$(printf '%s' "$pr_json" | grep -oE 'pullrequest/[0-9]+' | grep -oE '[0-9]+' | head -1 || true)"
    if [ -z "$pr_id" ]; then
        probe "review PR create" 1 "no PR id parsed"
        return 0
    fi
    (
        cd "$tmpclone" || exit 1
        GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 git push -q origin ":$tgt" ":$srcb" 2>/dev/null
    ) || true
    raw="$(azure_http_request GET "$(azure_pr_base "$repo")/pullrequests/${pr_id}?api-version=7.1" 2>/dev/null || true)"
    probe_capture "pullrequest.review.after-branch-delete" "$raw"
    probe "review PR after both branches are deleted (evidence)" 0 "status=$(printf '%s' "$raw" | jq -r '.status // "unreadable"' 2>/dev/null)"
    azure_http_request PATCH "$(azure_pr_base "$repo")/pullrequests/${pr_id}?api-version=7.1" '{"status":"abandoned"}' >/dev/null 2>&1 || true
}

if [ "$SMOKE_TIER" != "write" ]; then
    echo "SKIP  write/destructive tier (AZURE_SMOKE=1 is read-only; use AZURE_SMOKE=write)"
else
echo "write/destructive coverage — test project: $AZURE_SMOKE_TEST_PROJECT"

    # SAFETY: this tier runs exclusively inside the user-provided test
    # project (assumed blank/disposable). The org outside it is
    # LIVE/PRODUCTION — never touched. No project provisioning happens
    # here; every verb call below is project-scoped.

    # The disposable repo was provisioned as a fixture; this write-path
    # re-create is an idempotence check (exists = success, matching the
    # fixture probe).
    if provider_repos_view "$SMOKE_REPO" >/dev/null 2>&1; then
        probe "disposable repo present (idempotent re-create)" 0
    else
        probe "disposable repo present" 1
    fi
    src_branch="smoke-$$"

    # 1. Create a work item, comment, close, reopen.
    wi_resp=""
    # Azure work-item create: the type ("Issue") rides the URL path, and the
    # API requires the JSON-Patch content type.
    wit_url="$(azure_wit_base)/workitems/\$Issue"
    if wi_resp=$(azure_http_request POST "$wit_url" '[{"op":"add","path":"/fields/System.Title","from":null,"value":"smoke destructive item"}]' "application/json-patch+json" 2>/dev/null); then
        wi_id=$(printf '%s' "$wi_resp" | jq -r '.id')
        smoke_on_teardown "azure_http_request DELETE \"$(azure_wit_base)/workitems/$wi_id?destroy=true\""
        probe "work item create (id $wi_id)" 0
        if provider_issues_comment "" "$wi_id" --body "smoke comment" >/dev/null 2>&1; then
            probe "work item comment" 0
        else
            probe "work item comment" 1
        fi
        if azure_http_request PATCH "$(azure_wit_base)/workitems/$wi_id" '[{"op":"replace","path":"/fields/System.State","value":"Closed"}]' "application/json-patch+json" >/dev/null 2>&1; then
            probe "work item close" 0
        else
            probe "work item close" 1
        fi
    else
        probe "work item create" 1 "$(printf '%s' "$wi_resp" | head -c 200)"
        wi_id=""
    fi

    # 2. Push a branch with one commit (git ops are local+push; then PR).
    # The default branch is resolved via the repos API up front: deriving it
    # inside the clone subshell would leave the PR --base below with nothing
    # but a hardcoded fallback, and the test project's default is "main".
    # An empty repo has no default branch until the first push: seed it by
    # pushing an initial commit to 'main' (the repo's init default), then
    # resolve the branch (post-push the view reports it).
    default_branch="main"
    # One scratch directory for the clone, the askpass helper and the payload
    # files; registered FIRST so it is removed LAST (after every step that uses it).
    SMOKE_TMP="$(mktemp -d)"
    smoke_on_teardown "rm -rf '$SMOKE_TMP'"
    tmpclone="$SMOKE_TMP/clone"
    askpass_bin="$SMOKE_TMP/askpass.sh"
    cat > "$askpass_bin" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "$AZURE_PAT"
ASKPASS
    chmod 700 "$askpass_bin"
    # A named origin makes the later branch fetch/push paths real — a
    # push-by-URL seed leaves no remote to push the source branch through,
    # which silently starves every PR case downstream.
    remote_url="https://dev.azure.com/${org}/${project}/_git/${SMOKE_REPO}"
    seed_ok=0
    branch_pushed=0
    if GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 \
       git init -q -b "$default_branch" "$tmpclone" 2>/dev/null \
       && (cd "$tmpclone" \
           && git config user.email "smoke@invalid" && git config user.name "azure-smoke" \
           && echo "seed" > README.md && git add README.md \
           && git commit -q -m "chore: smoke seed commit" \
           && git remote add origin "$remote_url" \
           && GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 \
              git push -q origin "$default_branch" 2>/dev/null); then
        probe "default branch seed (main)" 0
        seed_ok=1
    else
        probe "default branch seed (main)" 1 "push failed — PAT needs Code Write on the test project"
    fi
    # The seed block left tmpclone as a working clone pointed at the repo —
    # reuse it: branch off the seeded main, commit, push, PR, merge. Only when
    # the seed actually landed: a seed that failed leaves nothing to branch from.
    if [ "$seed_ok" = "1" ]; then
        if (
            cd "$tmpclone" || exit 1
            # Same credentials and no-prompt rule as the pushes, and a time limit: an
            # unreachable remote must not stall the run.
            GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 timeout 60 git fetch -q origin 2>/dev/null || true
            git checkout -q -b "$src_branch" "origin/$default_branch" 2>/dev/null || git checkout -q -b "$src_branch"
            echo "smoke $$" >> SMOKE.md
            git add SMOKE.md 2>/dev/null || touch SMOKE.md
            git commit -q -m "chore: smoke destructive probe" >/dev/null 2>&1
            GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 git push -q origin "$src_branch" 2>/dev/null
        ); then
            probe "branch push ($src_branch)" 0
            branch_pushed=1
        else
            probe "branch push ($src_branch)" 1 "push failed — head branch absent server-side; PR cases will fail"
        fi
        if provider_repos_commits_count "$org/$project/$first_repo" >/dev/null 2>&1; then
            probe "provider_repos_commits_count (post-push)" 0
        else
            probe "provider_repos_commits_count (post-push)" 1
        fi

        # 3. Create PR via the seam verb, rebase-merge, verify branch deletion.
        # Only when the head branch really reached the server — otherwise the 400
        # would blame the provider for a precondition the harness itself failed.
        pr_json=""
        pr_id=""
        if [ "$branch_pushed" != "1" ]; then
            probe "PR create" 1 "skipped: the head branch was not pushed (see the branch push probe)"
        elif pr_json=$(provider_prs_create "$SMOKE_REPO" --title "chore: smoke destructive probe" --body "smoke" --head "$src_branch" --base "$default_branch" 2>&1); then
            pr_id=$(printf '%s' "$pr_json" | grep -oE 'pullrequest/[0-9]+' | grep -oE '[0-9]+' | head -1 || true)
            if [ -n "$pr_id" ]; then
                probe "PR create (id $pr_id)" 0
                if provider_prs_merge "$SMOKE_REPO" "$pr_id" --rebase --delete-branch >/dev/null 2>&1; then
                    probe "PR rebase-merge + branch delete" 0
                else
                    probe "PR rebase-merge + branch delete" 1
                fi
                smoke_check_merge_outcome "$SMOKE_REPO" "$pr_id" "$src_branch" "$default_branch"
            else
                probe "PR create" 1 "reported success but no PR id could be parsed from: $(printf '%s' "$pr_json" | head -c 120)"
            fi
        else
            # pr_json holds stderr here (2>&1 capture) — surface it.
            probe "PR create" 1 "$(printf '%s' "$pr_json" | head -c 200)"
        fi
    else
        probe "branch push (clone)" 1 "seed block failed — no working clone"
    fi
    # tmpclone/askpass live until teardown (SMOKE_TMP) — they serve both PR flows
    # and the payload files below.

    # --- Extended write/destructive coverage (issue-edit/comment verbs,
    # graph, set_type, tags, thread verbs, pipelines, policies, projects) ---
    if [ -n "${wi_id:-}" ]; then
        provider_issues_edit "" "$wi_id" --title "smoke destructive item (edited)" >/dev/null 2>&1 \
            && probe "provider_issues_edit" 0 || probe "provider_issues_edit" 1
        if c_add=$(provider_issues_comment_add "" "$wi_id" --body "add-path comment" 2>/dev/null); then
            probe "provider_issues_comment_add" 0
            c_ref=$(printf '%s' "$c_add" | jq -r '.id // empty' 2>/dev/null)
            # comment_add's id is ALREADY the composite ref
            # ("<work-item>/<comment>") — passing "$wi_id/$c_ref" would
            # double-composite and the ref guard rejects it as malformed.
            if [ -n "$c_ref" ] && provider_issues_comment_get "" "$c_ref" >/dev/null 2>&1; then
                probe "provider_issues_comment_get" 0
            else
                probe "provider_issues_comment_get" 1
            fi
            if [ -n "$c_ref" ] && provider_issues_comment_edit "" "$c_ref" --body "edited comment" >/dev/null 2>&1; then
                probe "provider_issues_comment_edit" 0
            else
                probe "provider_issues_comment_edit" 1
            fi
        else
            probe "provider_issues_comment_add" 1
            probe "provider_issues_comment_get" 1 "skipped"
            probe "provider_issues_comment_edit" 1 "skipped"
        fi
        # reopen moves the item to the first Proposed (else InProgress) state of
        # its own type. Evidence probe on failure: the verb discards the
        # transport error internally, so re-issue a raw PATCH to capture the
        # store's rejection (a Closed→New transition may be illegal under this
        # project's process).
        if provider_issues_reopen "" "$wi_id" >/dev/null 2>&1; then
            probe "provider_issues_reopen" 0
        else
            ro_raw=$(azure_http_request PATCH "$(azure_wit_base)/workitems/$wi_id" '[{"op":"add","path":"/fields/System.State","from":null,"value":"New"}]' "application/json-patch+json" 2>&1)
            probe "provider_issues_reopen" 1 "$(head -c 160 <<< "$ro_raw")"
        fi
        # set_type takes four positionals (owner repo number type).
        provider_issues_set_type "" "" "$wi_id" "Task" >/dev/null 2>&1 \
            && probe "provider_issues_set_type" 0 || probe "provider_issues_set_type" 1
        # label_create parses NAME + two ignored positionals (color,
        # description) BEFORE the flag loop — the two empties are consumed
        # as those positionals so --issue survives to it; an empty NAME
        # would hit the ref guard's ${1:?} and exit the suite.
        provider_issues_label_create "" "smoke-tag" "" "" --issue "$wi_id" >/dev/null 2>&1 \
            && probe "provider_issues_label_create/add_tag" 0 || probe "provider_issues_label_create/add_tag" 1
        provider_issues_label_list >/dev/null 2>&1 \
            && probe "provider_issues_label_list" 0 || probe "provider_issues_label_list" 1
        smoke_check_tag_edits "$wi_id"
        # Graph: second item as child, link, read children/parent, unlink.
        if child_json=$(azure_http_request POST "$(azure_wit_base)/workitems/\$Issue" '[{"op":"add","path":"/fields/System.Title","from":null,"value":"smoke child item"}]' "application/json-patch+json" 2>/dev/null); then
            child_id=$(printf '%s' "$child_json" | jq -r '.id')
            # Register BEFORE anything else: an inline-only delete fails the
            # suite's zero-orphan contract the moment any later step dies.
            case "$child_id" in
                ''|*[!0-9]*) probe "graph cases" 1 "child id unresolvable"; child_id="" ;;
                # Tolerant delete: the inline probe below normally removes
                # the item first; this stack entry only fires if the suite
                # died before it (or the inline delete failed).
                *) smoke_on_teardown "azure_http_request DELETE \"$(azure_wit_base)/workitems/$child_id?destroy=true\" >/dev/null 2>&1 || true" ;;
            esac
        fi
        if [ -n "${child_id:-}" ]; then
        # Graph verbs take bare PARENT/CHILD positionals — an empty ""
        # placeholder hits their ${1:?} guards and exits the whole suite
        # (observed live; the verbs have no [repo] arg to strip).
        provider_issue_graph_link "" "$wi_id" "$child_id" >/dev/null 2>&1 \
            && probe "provider_issue_graph_link" 0 || probe "provider_issue_graph_link" 1
        provider_issue_graph_children "" "$wi_id" >/dev/null 2>&1 \
            && probe "provider_issue_graph_children" 0 || probe "provider_issue_graph_children" 1
        provider_issue_graph_parent "" "$child_id" >/dev/null 2>&1 \
            && probe "provider_issue_graph_parent" 0 || probe "provider_issue_graph_parent" 1
        provider_issue_graph_unlink "" "$wi_id" "$child_id" >/dev/null 2>&1 \
            && probe "provider_issue_graph_unlink" 0 || probe "provider_issue_graph_unlink" 1
        # Hard-delete both items (no provider verb; raw transport DELETE).
        azure_http_request DELETE "$(azure_wit_base)/workitems/$child_id?destroy=true" >/dev/null 2>&1 \
            && probe "raw DELETE work item (child)" 0 || probe "raw DELETE work item (child)" 1
        else
            probe "graph cases" 1 "child create failed or id unresolvable"
        fi
        # Projects: state transition via field_set. The alias table is the
        # recorded provider bug, so the exact state name from field_list is
        # passed directly (the item is Closed here; the first listed state
        # transitions it back out).
        if [ -n "${_smoke_first_state:-}" ]; then
            provider_projects_field_set "" "$wi_id" "System.State" "$_smoke_first_state" >/dev/null 2>&1 \
                && probe "provider_projects_field_set" 0 || probe "provider_projects_field_set" 1
        else
            probe "provider_projects_field_set" 1 "no state name resolved from field_list"
        fi
        # Two positionals (issue URL, owner), as the wrappers call it: the verb
        # reads $2 under set -u, so a one-argument call kills the whole suite.
        provider_projects_for_issue "https://dev.azure.com/${org}/${project}/_workitems/edit/$wi_id" "" >/dev/null 2>&1 \
            && probe "provider_projects_for_issue" 0 || probe "provider_projects_for_issue" 1
        smoke_check_status_roundtrip "$wi_id" "Issue"
        # A User Story sits on the Stories board; an Issue sits on no board. Check the
        # status write on the board-backed type too.
        if us_resp=$(azure_http_request POST "$(azure_wit_base)/workitems/\$User%20Story?api-version=7.1" '[{"op":"add","path":"/fields/System.Title","from":null,"value":"[SMOKE-DELETEME] board story"}]' "application/json-patch+json" 2>/dev/null); then
            us_id=$(printf '%s' "$us_resp" | jq -r '.id')
            smoke_on_teardown "azure_http_request DELETE \"$(azure_wit_base)/workitems/$us_id?destroy=true\""
            probe "fixture User Story (id $us_id)" 0
            probe_capture "workitem.user-story" "$(azure_http_request GET "$(azure_wit_base)/workitems/${us_id}?\$expand=all&api-version=7.1" 2>/dev/null || true)"
            smoke_check_status_roundtrip "$us_id" "User Story"
        else
            probe "fixture User Story" 1 "$(printf '%s' "$us_resp" | head -c 200)"
        fi
        # A Bug is born through the verb's --type; whether it sits on the Stories
        # board is a team setting, so the round-trip below is the check (its first
        # probe fails when the Bug carries no Kanban column field).
        if bug_id=$(provider_issues_create "" --title "[SMOKE-DELETEME] board bug" --type Bug 2>/dev/null) && [ -n "$bug_id" ]; then
            smoke_on_teardown "azure_http_request DELETE \"$(azure_wit_base)/workitems/$bug_id?destroy=true\""
            probe "provider_issues_create --type Bug (id $bug_id)" 0
            probe_capture "workitem.bug" "$(azure_http_request GET "$(azure_wit_base)/workitems/${bug_id}?\$expand=all&api-version=7.1" 2>/dev/null || true)"
            smoke_check_status_roundtrip "$bug_id" "Bug"
        else
            probe "provider_issues_create --type Bug" 1 "the Bug could not be created"
        fi
        # An untyped create is a User Story; set_type must be able to change it.
        if typed_id=$(provider_issues_create "" --title "[SMOKE-DELETEME] retyped" 2>/dev/null) && [ -n "$typed_id" ]; then
            smoke_on_teardown "azure_http_request DELETE \"$(azure_wit_base)/workitems/$typed_id?destroy=true\""
            probe_outcome "an untyped create is a User Story" "$(azure_http_request GET "$(azure_wit_base)/workitems/${typed_id}?\$fields=System.WorkItemType&api-version=7.1" 2>/dev/null || true)" '.fields["System.WorkItemType"] == "User Story"'
            if provider_issues_set_type "" "" "$typed_id" Bug >/dev/null 2>&1; then
                probe_outcome "provider_issues_set_type changes the type to Bug" "$(azure_http_request GET "$(azure_wit_base)/workitems/${typed_id}?\$fields=System.WorkItemType&api-version=7.1" 2>/dev/null || true)" '.fields["System.WorkItemType"] == "Bug"'
            else
                probe "provider_issues_set_type changes the type to Bug" 1 "the type change was rejected"
            fi
        else
            probe "untyped provider_issues_create" 1 "the work item could not be created"
        fi
    fi

    # The wrapper tools a user runs, end to end against real work items:
    # issue-create, issue-artifact-doc-id and issue-artifact-upsert (create, then
    # update). DEVENV_REPO is the explicit target the devenv-repo gate requires.
    wrap_repo="${project}/${SMOKE_REPO}"
    wrap_out=$(DEVENV_REPO="$wrap_repo" bash "$DEVENV_TOOLS/scripts/issue-create.sh" --title "[SMOKE-DELETEME] wrapper flow" --body "created by the smoke test" --type Task --no-interactive --no-template 2>&1) || wrap_out="${wrap_out:-failed}"
    wrap_id=$(printf '%s' "$wrap_out" | grep -oE 'Created issue: *[^ ]*' | grep -oE '[0-9]+$' | tail -1 || true)
    if [ -n "$wrap_id" ]; then
        smoke_on_teardown "azure_http_request DELETE \"$(azure_wit_base)/workitems/$wrap_id?destroy=true\""
        probe "issue-create wrapper (id $wrap_id)" 0
        probe_outcome "issue-create stored the title and body" "$(azure_http_request GET "$(azure_wit_base)/workitems/${wrap_id}?api-version=7.1" 2>/dev/null || true)" '.fields["System.Title"] == "[SMOKE-DELETEME] wrapper flow" and ((.fields["System.Description"] // "") | contains("created by the smoke test"))'
        wrap_doc=$(DEVENV_REPO="$wrap_repo" bash "$DEVENV_TOOLS/scripts/issue-artifact-doc-id.sh" --issue "$wrap_id" --artifact-type plan --slug "smoke wrapper flow" --repo "$wrap_repo" 2>&1) || wrap_doc="${wrap_doc:-failed}"
        probe_outcome "issue-artifact-doc-id emits a project/repo doc_id" "$(jq -nc --arg d "$wrap_doc" '{d: $d}')" ".d == \"dv1:${wrap_repo}:issue-${wrap_id}:plan:smoke-wrapper-flow\""
        wrap_body=$(printf 'doc_id: %s\nissue_number: %s\n\nfirst revision' "$wrap_doc" "$wrap_id")
        wrap_created=$(DEVENV_REPO="$wrap_repo" bash "$DEVENV_TOOLS/scripts/issue-artifact-upsert.sh" --issue "$wrap_id" --no-stamp --body "$wrap_body" 2>/dev/null) || true
        probe_outcome "issue-artifact-upsert creates the artifact comment" "$wrap_created" '.action == "created" and (.comment_id != null)'
        wrap_comment=$(printf '%s' "$wrap_created" | jq -r '.comment_id // empty' 2>/dev/null || true)
        wrap_body2=$(printf 'doc_id: %s\nissue_number: %s\n\nsecond revision' "$wrap_doc" "$wrap_id")
        wrap_updated=$(DEVENV_REPO="$wrap_repo" bash "$DEVENV_TOOLS/scripts/issue-artifact-upsert.sh" --issue "$wrap_id" --no-stamp --body "$wrap_body2" 2>/dev/null) || true
        probe_outcome "issue-artifact-upsert updates the same comment" "$wrap_updated" ".action == \"updated\" and ((.comment_id | tostring) == \"${wrap_comment:-none}\")"
    else
        probe "issue-create wrapper" 1 "$(printf '%s' "$wrap_out" | head -c 240)"
    fi

    # PR-domain writes against the created PR (pr_id from the merge flow may
    # be completed; threads on completed PRs still work).
    if [ -n "${pr_id:-}" ]; then
        provider_prs_threads_page "$SMOKE_REPO" "$pr_id" >/dev/null 2>&1 \
            && probe "provider_prs_threads_page" 0 || probe "provider_prs_threads_page" 1
    fi
    # Second PR for thread lifecycle (comment/reply/resolve) on an active
    # PR: push a dedicated branch up front (origin is real now), create,
    # and leave it active for the thread verbs; abandon at case end.
    pr2_json=""
    pr2_id=""
    src2="smoke2-$$"
    if (
        cd "$tmpclone" 2>/dev/null || exit 1
        git checkout -q -b "$src2" "origin/$default_branch" 2>/dev/null || git checkout -q -b "$src2"
        echo "smoke2 $$" > SMOKE2.md
        git add SMOKE2.md 2>/dev/null
        git commit -q -m "chore: smoke thread PR" 2>/dev/null
        GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 git push -q origin "$src2" 2>/dev/null
    ); then
        if pr2_json=$(provider_prs_create "$SMOKE_REPO" --title "smoke: thread lifecycle" --body "smoke" --head "$src2" --base "$default_branch" 2>&1); then
            pr2_id=$(printf '%s' "$pr2_json" | grep -oE 'pullrequest/[0-9]+' | grep -oE '[0-9]+' | head -1 || true)
            if [ -n "$pr2_id" ]; then
                probe "second PR create" 0
            else
                probe "second PR create" 1 "reported success but no PR id could be parsed"
            fi
        else
            probe "second PR create" 1 "$(head -c 120 <<< "$pr2_json")"
        fi
    else
        probe "second PR create" 1 "skipped: the head branch was not pushed"
    fi
    if [ -n "${pr2_id:-}" ]; then
        # Review threads are made with thread_create ({thread:{url,id}}, id is <pr>/<thread>);
        # a plain pr-comment is not a review thread and is checked separately below.
        if th_json=$(provider_prs_thread_create "$SMOKE_REPO" "$pr2_id" --body "smoke thread" 2>/dev/null); then
            probe_outcome "provider_prs_thread_create returns a thread url and id" "$th_json" '(.thread.url | length) > 0 and (.thread.id | test("^[0-9]+/[0-9]+$"))'
            th_id=$(printf '%s' "$th_json" | jq -r '.thread.id' | sed 's#.*/##')
            if [ -n "$th_id" ]; then
                # thread_reply takes the body positionally; thread_resolve
                # takes the bare '<pr>/<thread>' ref — a repo prefix would
                # be parsed as the ref and rejected. Both verbs capture the
                # transport error into $response and return silently — raw
                # probes re-issue the exact requests for the report.
                # A second thread, so a reply addressed by comment id (which is 1 in
                # every thread) can be told apart from one addressed by thread id.
                th_b_id="$(provider_prs_thread_create "$SMOKE_REPO" "$pr2_id" --body "smoke thread b" 2>/dev/null | jq -r '.thread.id // empty' | sed 's#.*/##')"
                if [ -n "$th_b_id" ]; then
                    smoke_check_threads "$SMOKE_REPO" "$pr2_id" "$th_id" "$th_b_id"
                else
                    probe "second review thread" 1 "no thread id parsed"
                fi
                if provider_prs_thread_reply "$SMOKE_REPO" "$pr2_id" "$th_id" "smoke reply" >/dev/null 2>&1; then
                    probe "provider_prs_thread_reply" 0
                else
                    _tr_probe=$(azure_http_request POST "$(azure_pr_base "$SMOKE_REPO")/pullrequests/${pr2_id}/threads/${th_id}/comments" '{"comments":[{"parentCommentId":0,"content":"smoke reply probe","commentType":1}]}' 2>&1)
                    probe "provider_prs_thread_reply" 1 "$(head -c 160 <<< "$_tr_probe")"
                fi
                if provider_prs_thread_resolve "$SMOKE_REPO/$pr2_id/$th_id" >/dev/null 2>&1; then
                    probe "provider_prs_thread_resolve" 0
                else
                    _ts_probe=$(azure_http_request PATCH "$(azure_pr_base "$SMOKE_REPO")/pullrequests/${pr2_id}/threads/${th_id}" '[{"op":"replace","path":"/status","value":2}]' 2>&1)
                    probe "provider_prs_thread_resolve" 1 "$(head -c 160 <<< "$_ts_probe")"
                fi
                smoke_check_threads_resolved "$SMOKE_REPO" "$pr2_id" "$th_id"
            else
                probe "provider_prs_thread_reply" 1 "no thread id parsed"
                probe "provider_prs_thread_resolve" 1 "skipped"
            fi
        else
            probe "provider_prs_thread_create" 1
            probe "provider_prs_thread_reply" 1 "skipped"
            probe "provider_prs_thread_resolve" 1 "skipped"
        fi
        # A plain PR comment: it prints a bare thread id, is not a review thread while it
        # holds one comment, and is listed once someone replies in it.
        if cmt_out=$(provider_prs_comment "$SMOKE_REPO" "$pr2_id" --body "smoke plain comment" 2>/dev/null) && [[ "$cmt_out" =~ ^[0-9]+$ ]]; then
            probe "provider_prs_comment prints a bare thread id ($cmt_out)" 0
            probe_outcome "a plain comment is not listed as a review thread" "$(provider_prs_threads_page "$SMOKE_REPO" "$pr2_id" 2>/dev/null || true)" \
                "[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id | endswith(\"/$cmt_out\"))] | length == 0"
            if provider_prs_thread_reply "$SMOKE_REPO" "$pr2_id" "$cmt_out" "smoke reply to the plain comment" >/dev/null 2>&1; then
                probe_outcome "a plain comment is listed once someone replies in it" "$(provider_prs_threads_page "$SMOKE_REPO" "$pr2_id" 2>/dev/null || true)" \
                    "[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id | endswith(\"/$cmt_out\"))] | length == 1"
            else
                probe "reply in a plain comment thread" 1 "the reply was rejected"
            fi
        else
            probe "provider_prs_comment prints a bare thread id" 1 "got: $(head -c 80 <<< "${cmt_out:-nothing}")"
        fi
        provider_prs_view "$SMOKE_REPO" "$pr2_id" >/dev/null 2>&1 \
            && probe "provider_prs_view" 0 || probe "provider_prs_view" 1
        if diff_out=$(provider_prs_diff "$SMOKE_REPO" "$pr2_id" 2>&1); then
            probe "provider_prs_diff" 0
        else
            probe "provider_prs_diff" 1 "$(head -c 160 <<< "$diff_out") — verb discards transport errors internally (finding)"
        fi
        # Abandon the second PR (raw PATCH; no provider verb).
        azure_http_request PATCH "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${SMOKE_REPO}/pullrequests/${pr2_id}" '{"status":"abandoned"}' >/dev/null 2>&1 \
            && probe "raw PATCH PR abandon" 0 || probe "raw PATCH PR abandon" 1
    fi
    # With one merged and one abandoned PR in the repo, the list filters have
    # something to separate; then the REVIEW: PR branch-deletion evidence.
    smoke_check_pr_states "$SMOKE_REPO"
    if [ "$seed_ok" = "1" ]; then
        smoke_check_review_pr_branch_delete "$SMOKE_REPO" "$default_branch"
    fi

    # Repos: patch (rename-free setting touch), protect_branch, ACL grant.
    # The verb PATCHes with >/dev/null internally (silent on failure) — raw
    # probe re-issues the exact description PATCH for the report.
    if provider_repos_patch "$SMOKE_REPO" -f description="smoke repo (patched)" >/dev/null 2>&1; then
        probe "provider_repos_patch" 0
    else
        _rp_probe=$(azure_http_request PATCH "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${SMOKE_REPO}?api-version=7.1" '{"description":"smoke repo (patched)"}' 2>&1)
        probe "provider_repos_patch" 1 "$(head -c 160 <<< "$_rp_probe")"
    fi
    # protect_branch needs a seam-shaped payload file (the review count rides
    # it); the created policy configurations are swept at teardown.
    protect_payload="$SMOKE_TMP/protect.json"
    printf '%s' '{"required_pull_request_reviews":{"required_approving_review_count":1}}' > "$protect_payload" 2>/dev/null || true
    if provider_repos_protect_branch "$SMOKE_REPO" "$default_branch" "$protect_payload" >/dev/null 2>&1; then
        probe "provider_repos_protect_branch" 0
    else
        probe "provider_repos_protect_branch" 1 "policy may already exist (idempotent-ish)"
    fi
    # ACL grant needs an existing identity; the project's default team is
    # created with the project. azure_grant_bits speaks the seam dialect
    # ("pull" is the read analog). The verb's failure paths are mostly
    # silent (error JSON discarded internally); stderr capture gets the
    # log_error identity case, empty means the deeper POST failed.
    if acl_out=$(provider_repos_team_put "$org" "${project} Team" "$SMOKE_REPO" "pull" 2>&1); then
        probe "provider_repos_team_put (ACL)" 0
    else
        probe "provider_repos_team_put (ACL)" 1 "${acl_out:+$(head -c 160 <<< "$acl_out") — }silent: identity lookup or ACL POST failed internally (finding)"
    fi

    # Pipelines: no definition exists in a fresh repo — the project-scoped
    # list must succeed with [] (its label says project-scoped). The
    # repo-scoped filter passes the bare repo NAME where the API wants a
    # repositoryId — captured as evidence for the finding family.
    if wfl_out=$(provider_pipelines_workflow_list 2>&1); then
        probe "provider_pipelines_workflow_list (project-scoped)" 0 "defs: $(printf '%s' "$wfl_out" | jq 'length' 2>/dev/null || echo '?')"
    else
        probe "provider_pipelines_workflow_list (project-scoped)" 1 "$(head -c 120 <<< "$wfl_out")"
    fi
    if wfl_repo_out=$(provider_pipelines_workflow_list "$SMOKE_REPO" 2>&1); then
        probe "workflow_list repo-filter (evidence)" 0 "defs: $(printf '%s' "$wfl_repo_out" | jq 'length' 2>/dev/null || echo '?')"
    else
        _wf_probe=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/build/definitions?repositoryId=${SMOKE_REPO}&repositoryType=TfsGit" 2>&1)
        probe "workflow_list repo-filter (evidence)" 1 "$(head -c 160 <<< "$_wf_probe")"
    fi
    echo "note: pipelines write/cancel/download cases need a pipeline definition — add azure-pipelines.yml to the disposable repo seed to enable" >&2

    # Policies: ruleset create → update (delete+recreate) → list. The
    # payload is ruleset-shaped — translate maps the pull_request rule
    # onto a minimum-reviewers policy configuration.
    policy_payload="$SMOKE_TMP/policy.json"
    # The translate pins refs/heads/main; protect_branch already created a
    # minimum-reviewers policy on main — an identical blocking configuration
    # is rejected 403 'rejected by policy'. The ruleset case targets the
    # feature branch via translate's parameters… translate pins main, so
    # instead assert idempotence: an existing equivalent policy counts as
    # created (pre-checked below).
    printf '%s' '{"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":1}}]}' > "$policy_payload" 2>/dev/null || true
    # Idempotence: protect_branch already installed the same minimum-
    # reviewers policy on main — a 403 'rejected by policy' is accepted as
    # created-success ONLY when an equivalent configuration verifiably
    # exists (any other failure stays a FAIL — no blanket masking).
    if provider_org_ruleset_create "$SMOKE_REPO" "$policy_payload" >/dev/null 2>&1; then
        probe "provider_org_ruleset_create" 0
    else
        _dup=""
        _dup=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/policy/configurations?api-version=7.1" 2>/dev/null || true)
        if printf '%s' "$_dup" | jq -e --arg rg "$(azure_repo_guid "$SMOKE_REPO" 2>/dev/null)" 'any(.value[]; .type.id == "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" and .isEnabled and .settings.scope[0].repositoryId == $rg and .settings.scope[0].refName == "refs/heads/main")' >/dev/null 2>&1; then
            probe "provider_org_ruleset_create" 0 "equivalent policy already on main (protect_branch) — idempotent"
        else
            # Evidence probe: re-POST the translated policy raw to capture
            # the store's rejection verbatim.
            _rs_guid=$(azure_repo_guid "$SMOKE_REPO" 2>/dev/null)
            _rs_raw=$(jq -cn --arg rg "$_rs_guid" '{type:{id:"fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},isEnabled:true,isBlocking:true,settings:{scope:[{repositoryId:$rg,matchKind:"exact",refName:"refs/heads/main"}],minimumApproverCount:1,creatorVoteCounts:false,allowDownvotes:false,resetOnSourcePush:false}}')
            _rs_probe=$(azure_http_request POST "https://dev.azure.com/${org}/${project}/_apis/policy/configurations" "$_rs_raw" 2>&1)
            probe "provider_org_ruleset_create" 1 "$(head -c 160 <<< "$_rs_probe")"
        fi
    fi
    # update is (REPO RULESET_ID PAYLOAD_FILE); azure's delete+recreate
    # convergence ignores the id. Always exercised — not gated on create.
    if provider_org_ruleset_update "$SMOKE_REPO" "0" "$policy_payload" >/dev/null 2>&1; then
        probe "provider_org_ruleset_update (delete+recreate)" 0
    else
        probe "provider_org_ruleset_update (delete+recreate)" 1
    fi
    if provider_org_rulesets_list "$SMOKE_REPO" >/dev/null 2>&1; then
        probe "provider_org_rulesets_list (post-write)" 0
    else
        probe "provider_org_rulesets_list (post-write)" 1
    fi
    # (The repo DELETE and the policy sweep were registered when the fixture repo
    # was created — see the fixture section.)

fi   # write tier

# Teardown: reverse-order cleanup of everything the suite created inside
# the user's test project (the project itself is the user's — never
# deleted).
smoke_teardown_run

echo "================================"
echo "summary: $pass pass, $fail fail"
report_line "summary: $pass pass, $fail fail"
# Teardown failures must fail the suite: a green run that leaves orphans is
# not green (the exit-trap has already run smoke_teardown_run by now).
[ "$fail" -eq 0 ] && [ "$_TEARDOWN_FAILED" -eq 0 ]
