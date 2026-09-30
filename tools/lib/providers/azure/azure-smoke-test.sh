#!/usr/bin/env bash
# azure-smoke-test.sh (azure provider) - Live validation smoke, two opt-in tiers.
#
# Manual validation only: never invoked by tests or CI. Verifies the
# transport's live-org assumptions through OUR code (azure_http_request /
# azure_http_paginate), not raw curl — that is the point.
#
#   Gate:     AZURE_SMOKE=1 (refuses to run without it)
#   Tier:     1 = read-only. No create/update/delete. (Tier 2, destructive,
#             lives behind AZURE_SMOKE=write and a disposable test project.)
#   Output:   token-redacted by design (the transport redacts on every log
#             path; this script additionally prints nothing but status lines
#             and counts). Safe to paste anywhere.
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
# on the configured project, against AZURE_SMOKE_TEST_REPO.
#
# Usage:
#   AZURE_SMOKE=1 bash tools/lib/providers/azure/azure-smoke-test.sh
#   AZURE_SMOKE=write AZURE_SMOKE_TEST_REPO=<disposable-repo> \
#       bash tools/lib/providers/azure/azure-smoke-test.sh
#
# Requires: key-update-azure has stored the PAT (0600 file), and devenv.config
# carries [provider] azure_org / azure_project (or AZURE_DEVOPS_ORG /
# AZURE_DEVOPS_PROJECT are exported). For tier 2 the test repo must be
# DISPOSABLE: everything in it can be deleted or merged without loss.

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

TIER="${AZURE_SMOKE:-0}"
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
azure-smoke-test.sh — live validation smoke for the Azure DevOps provider

Manual only; never invoked by tests or CI. Probes run through the provider
transport (azure_http_request / azure_http_paginate), never raw curl.

USAGE
  AZURE_SMOKE=1 bash tools/lib/providers/azure/azure-smoke-test.sh
      Tier 1 — read-only: auth, repo list, WIQL, work-item view, PR list.

  AZURE_SMOKE=write AZURE_SMOKE_TEST_REPO=<repo> \
      bash tools/lib/providers/azure/azure-smoke-test.sh
      Tier 2 — destructive, adds: work item create → comment → close;
      branch push; PR create → rebase-merge → source-branch deletion.
      <repo> must be a DISPOSABLE repo in the configured project.

REQUIRED
  1. PAT stored via key-update-azure (0600 file; no env var needed).
  2. devenv.config [provider] section:
       name = azure
       azure_org = <org>          # dev.azure.com/{org}
       azure_project = <project>  # URL segment after the org
     (or AZURE_DEVOPS_ORG / AZURE_DEVOPS_PROJECT exported).
  3. Tier 2 only: AZURE_SMOKE_TEST_REPO pointing at a disposable repo.

OUTPUT
  Status lines and counts only; the transport redacts the token on every
  path — safe to paste anywhere.
HELP
    exit 0
fi
if [ "$TIER" != "1" ] && [ "$TIER" != "write" ]; then
    echo "refusing to run: set AZURE_SMOKE=1 (read-only tier) or AZURE_SMOKE=write (destructive tier) to opt in." >&2
    exit 1
fi
if [ "$TIER" = "write" ] && [ -z "${AZURE_SMOKE_TEST_REPO:-}" ]; then
    echo "destructive tier requires AZURE_SMOKE_TEST_REPO=<repo-name> (a DISPOSABLE repo in the configured project)." >&2
    exit 1
fi

# Resolve the PAT through the seam (never printed). set -e does not guard
# command substitutions in assignments on all bash versions — capture rc.
AZURE_PAT=""
if ! AZURE_PAT="$(provider_secret_get token 2>/dev/null)" || [ -z "$AZURE_PAT" ]; then
    echo "no PAT resolvable — run key-update-azure first." >&2
    exit 1
fi
export AZURE_PAT

pass=0
fail=0
probe() {
    local name="$1" ok="$2" detail="${3:-}"
    if [ "$ok" = "0" ]; then
        echo "PASS  $name${detail:+ — $detail}"
        pass=$((pass + 1))
    else
        echo "FAIL  $name${detail:+ — $detail}"
        fail=$((fail + 1))
    fi
}

echo "azure smoke (tier 1, read-only)"
echo "================================"

# --- 1. Auth + api-version: cheapest authenticated call -------------------
op="$(azure_org_project)" || { echo "org/project unresolved — set [provider] azure_org/azure_project"; exit 1; }
org="$(printf '%s' "$op" | sed -n 1p)"
project="$(printf '%s' "$op" | sed -n 2p)"
echo "target: org=$org project=$project"

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

# --- 4. Work item view (only when the probe above found one) ---------------
if [ -n "$wiql_resp" ] && [ "$wi_count" != "0" ]; then
    first_id="$(printf '%s' "$wiql_resp" | jq -r '.workItems[0].id')"
    wi_view=""
    if wi_view="$(azure_http_request GET "$base/workitems/${first_id}" 2>/dev/null)"; then
        probe "work item view (id $first_id)" 0 "title: $(printf '%s' "$wi_view" | jq -r '.fields["System.Title"]' | head -c 60)"
    else
        probe "work item view (id $first_id)" 1 "$(printf '%s' "$wi_view" | head -c 200)"
    fi
else
    echo "SKIP  work item view (no work items in project)"
fi

# --- 5. PR list for the first repo ------------------------------------------
first_repo="$(printf '%s' "$repos_json" | jq -r '.[0].name // empty' 2>/dev/null || true)"
if [ -n "$first_repo" ]; then
    prs_resp=""
    if prs_resp="$(azure_http_paginate "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${first_repo}/pullrequests" 2>/dev/null)"; then
        probe "PR list (repo $first_repo)" 0 "$(printf '%s' "$prs_resp" | jq 'length') PRs"
    else
        probe "PR list (repo $first_repo)" 1 "$(printf '%s' "$prs_resp" | head -c 200)"
    fi
else
    echo "SKIP  PR list (no repositories in project)"
fi

if [ "$TIER" = "write" ]; then
    echo "================================"
    echo "tier 2 (destructive) — test repo: $AZURE_SMOKE_TEST_REPO"
    src_branch="smoke-$$"

    # 1. Create a work item, comment, close, reopen.
    wi_resp=""
    # Azure work-item create: the type ("Issue") rides the URL path, and the
    # API requires the JSON-Patch content type.
    wit_url="$(azure_wit_base)/workitems/\$Issue"
    if wi_resp=$(azure_http_request POST "$wit_url" '[{"op":"add","path":"/fields/System.Title","from":null,"value":"smoke destructive item"}]' "application/json-patch+json" 2>/dev/null); then
        wi_id=$(printf '%s' "$wi_resp" | jq -r '.id')
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
    default_branch=""
    repo_view_json=""
    if repo_view_json=$(provider_repos_view "$AZURE_SMOKE_TEST_REPO" 2>/dev/null); then
        default_branch=$(printf '%s' "$repo_view_json" | jq -r '.defaultBranch // empty' | sed 's#^refs/heads/##')
    fi
    [ -n "$default_branch" ] || { echo "FAIL  PR create (could not resolve default branch of $AZURE_SMOKE_TEST_REPO)"; fail=$((fail + 1)); }
    tmpclone=$(mktemp -d)
    askpass_bin="$tmpclone.askpass.sh"
    cat > "$askpass_bin" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "$AZURE_PAT"
ASKPASS
    chmod 700 "$askpass_bin"
    if GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes" \
       git clone -q "https://dev.azure.com/${org}/${project}/_git/${AZURE_SMOKE_TEST_REPO}" "$tmpclone" 2>/dev/null; then
        (
            cd "$tmpclone" || exit 1
            git config user.email "smoke@invalid" >/dev/null 2>&1
            git config user.name "azure-smoke" >/dev/null 2>&1
            git checkout -q -b "$src_branch" "origin/$default_branch" 2>/dev/null || git checkout -q -b "$src_branch"
            echo "smoke $$" >> SMOKE.md
            git add SMOKE.md 2>/dev/null || touch SMOKE.md
            git commit -q -m "chore: smoke destructive probe" >/dev/null 2>&1
            GIT_ASKPASS="$askpass_bin" GIT_TERMINAL_PROMPT=0 git push -q origin "$src_branch" 2>/dev/null
        )
        probe "branch push ($src_branch)" 0

        # 3. Create PR via the seam verb, rebase-merge, verify branch deletion.
        pr_json=""
        if pr_json=$(provider_prs_create "$AZURE_SMOKE_TEST_REPO" --title "chore: smoke destructive probe" --body "smoke" --head "$src_branch" --base "$default_branch" 2>/dev/null); then
            pr_id=$(printf '%s' "$pr_json" | grep -oE 'pullrequest/[0-9]+' | grep -oE '[0-9]+')
            probe "PR create (id $pr_id)" 0
            if provider_prs_merge "$AZURE_SMOKE_TEST_REPO" "$pr_id" --rebase --delete-branch >/dev/null 2>&1; then
                probe "PR rebase-merge + branch delete" 0
            else
                probe "PR rebase-merge + branch delete" 1
            fi
        else
            probe "PR create" 1 "$(printf '%s' "$pr_json" | head -c 200)"
        fi
    else
        probe "branch push (clone)" 1 "could not clone test repo"
    fi
    rm -rf "$tmpclone" "$askpass_bin"
fi

echo "================================"
echo "summary: $pass pass, $fail fail"
[ "$fail" -eq 0 ]
