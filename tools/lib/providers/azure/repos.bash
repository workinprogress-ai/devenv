#!/bin/bash
# azure/repos.bash - Azure DevOps implementation of the repos domain verbs.
#
# Implements the verbs current tools/ call sites use (parity definition,
# plan #40): provider_repos_list, provider_repos_view, and
# provider_repos_default_branch (used by workflow helpers), plus the
# azure cwd-spec hook for the core repo-target resolver and the
# repo-args shim for shared -R-style call sites. Output shapes
# mirror the seam fields callers consume (--json name, --json
# nameWithOwner, -q '.owner.login', etc.) so wrappers stay transport-blind.
#
# Transport: azure_http_request / azure_http_paginate (providers/azure/http).
# Contract: return non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_REPOS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_REPOS_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F azure_http_request >/dev/null; then
    # Self-heal: the canonical loader (provider-load order) may source this
    # module before http.bash; source the transport ourselves instead of
    # failing, so module order never matters.
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/http.bash"
fi
if ! declare -F azure_apply_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_repo_flag_spec >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repo-flag.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/repos.bash: providers/azure/http.bash failed to load"
    return 1
fi
# Resolve org/project for API paths. Order: explicit env overrides
# (AZURE_DEVOPS_ORG/AZURE_DEVOPS_PROJECT, session-scoped) → devenv.config
# [provider] azure_org/azure_project.
# Usage: azure_org_project  -> prints "org project" (two words); returns 1
#        when either is unresolved.
azure_org_project() {
    local org="${AZURE_DEVOPS_ORG:-}"
    local project="${AZURE_DEVOPS_PROJECT:-}"
    if [ -z "$org" ] || [ -z "$project" ]; then
        [ -n "$org" ] || org=$(azure_config_get provider azure_org)
        [ -n "$project" ] || project=$(azure_config_get provider azure_project)
    fi
    if [ -z "$org" ] || [ -z "$project" ]; then
        log_error "azure org/project unresolved — set [provider] azure_org and azure_project in devenv.config"
        return 1
    fi
    printf '%s\n%s\n' "$org" "$project"
}

# Split a repo spec into org, project and repo, one per line. Specs are
# org/project/repo, project/repo (the canonical form) or a bare repo name; the
# configured org and project fill whatever the spec leaves out. An empty spec
# yields an empty repo. Returns 1 when org or project cannot be resolved.
# Usage: azure_repo_parts SPEC -> prints org, project, repo
azure_repo_parts() {
    local spec="${1:-}" org="" project="" repo=""
    case "$spec" in
        */*/*) org="${spec%%/*}"; local rest="${spec#*/}"; project="${rest%%/*}"; repo="${rest#*/}" ;;
        */*) project="${spec%%/*}"; repo="${spec#*/}" ;;
        "") : ;;
        *) repo="$spec" ;;
    esac
    # the configuration supplies only what the spec leaves out
    if [ -z "$org" ] || [ -z "$project" ]; then
        local op
        op=$(azure_org_project) || return 1
        [ -n "$org" ] || org=$(printf '%s' "$op" | sed -n 1p)
        [ -n "$project" ] || project=$(printf '%s' "$op" | sed -n 2p)
    fi
    printf '%s\n%s\n%s\n' "$org" "$project" "$repo"
}

# The git API root of a repo spec, every component encoded:
# https://dev.azure.com/<org>/<project>/_apis/git/repositories/<repo>
# (the repositories collection when the spec names no repo).
# Usage: azure_git_repo_url SPEC
azure_git_repo_url() {
    local parts org project repo
    parts=$(azure_repo_parts "${1:-}") || return 1
    org=$(printf '%s' "$parts" | sed -n 1p); project=$(printf '%s' "$parts" | sed -n 2p); repo=$(printf '%s' "$parts" | sed -n 3p)
    local url
    url="https://dev.azure.com/$(azure_uri "$org")/$(azure_uri "$project")/_apis/git/repositories"
    [ -n "$repo" ] && url="${url}/$(azure_uri "$repo")"
    printf '%s' "$url"
}

# The repository's GUID (the form several APIs filter on), resolved from a repo
# spec through the repository's own org and project.
# Usage: azure_repo_guid SPEC -> prints the id
azure_repo_guid() {
    local spec="${1:?repo required}" url response
    url=$(azure_git_repo_url "$spec") || return 1
    response=$(azure_http_request GET "$url") || return 1
    printf '%s' "$response" | jq -r '.id // empty'
}

# Cwd leg for the core repo-target resolver: the canonical Azure spec is the
# two-part project/repo (the organization always comes from config), composed from
# the configured project + git root basename. Both legs must resolve; empty (not
# error) when they don't — the core resolver's contract decides what empty means.
_provider_repo_cwd_spec() {
    local op
    op=$(azure_org_project 2>/dev/null) || return 0
    local project repo_name
    project=$(printf '%s' "$op" | sed -n 2p)
    repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    if [ -n "$project" ] && [ -n "$repo_name" ]; then
        echo "${project}/${repo_name}"
        return 0
    fi
    return 0
}

# Repo-args shim for shared call sites that build flag-style -R owner/repo
# specs. Azure carries no -R flag; the shim emits an azure-shaped
# project/repo spec so argument arrays stay resolvable, and github-only
# call sites (all current consumers) never take this path.
# Usage: provider_repo_args ARR_VAR [repo]
provider_repo_args() {
    local -n __arr="$1"
    local __repo="${2:-}"
    if [ -n "$__repo" ]; then
        __arr=("$__repo")
    else
        __arr=()
    fi
}

# Default branch of a repo: repos view projection, refs/heads/ stripped.
# Usage: provider_repos_default_branch [org/project/repo]  -> e.g. main
provider_repos_default_branch() {
    local repo="${1:-}"
    local view
    if ! view=$(provider_repos_view "$repo" --json defaultBranchRef 2>/dev/null); then
        log_error "provider_repos_default_branch: repos view failed for '${repo:-<cwd>}'"
        return 1
    fi
    # The single-field projection returns the raw ref text (refs/heads/X),
    # not a JSON object — strip the prefix textually.
    local branch="${view#refs/heads/}"
    branch="$(printf '%s' "$branch" | tr -d '[:space:]')"
    if [ -z "$branch" ]; then
        log_error "provider_repos_default_branch: no default branch in view output"
        return 1
    fi
    printf '%s\n' "$branch"
}

# Whether a repository has at least one commit (newly created repos may be
# unready while init completes; the caller polls).
# Usage: provider_repos_commits_count [SPEC]  -> exit 0 non-empty
provider_repos_commits_count() {
    local repo="${1:-}"
    if [ -z "$repo" ]; then
        repo=$(_provider_repo_cwd_spec)
        [ -n "$repo" ] || { log_error "provider_repos_commits_count: no repo argument and no git context"; return 1; }
    fi
    local url response
    url=$(azure_git_repo_url "$repo") || return 1
    if ! response=$(azure_http_request GET "${url}/commits?\$top=1&api-version=7.1"); then
        return 1
    fi
    [ "$(printf '%s' "$response" | jq -r '.count // 0')" -ge 1 ]
}

# Create a repo. Seam dialect flags translated: --description maps
# directly; --template maps to parentRepository (fork-in-project);
# visibility flags are accepted and ignored (azure repos are
# project-scoped and private by default — documented degrade).
# Usage: provider_repos_create NAME [SEAM-DIALECT FLAGS...]
provider_repos_create() {
    local name="${1:?repo name required}"; shift
    name="${name##*/}"   # accept full specs; azure wants the bare name
    local description="" template=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --public|--private|--internal) shift ;;
            --description) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; description="$2"; shift 2 ;;
            --template) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; template="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    local base
    base=$(azure_git_repo_url "") || return 1
    local body
    body=$(jq -n --arg n "$name" --arg d "$description" '{name: $n} + (if $d != "" then {description: $d} else {} end)')
    if [ -n "$template" ]; then
        local tguid
        tguid=$(azure_repo_guid "$template") || return 1
        body=$(printf '%s' "$body" | jq -c --arg tg "$tguid" '. + {parentRepository: {id: $tg}}')
    fi
    local response
    if ! response=$(azure_http_request POST "${base}?api-version=7.1" "$body"); then
        return 1
    fi
    printf '%s' "$response" | jq -c '{name, id, repoSpec: ((.project.name // "") + "/" + .name)}'
}

# Edit a repo (settings flips). Azure repos have fewer knobs: --template
# is not patchable post-create (create-time parentRepository only);
# accepted and ignored with a log line per the documented degrade.
# Usage: provider_repos_edit REPO [FLAGS...]
provider_repos_edit() {
    local repo="${1:?repo required}"; shift
    while [ $# -gt 0 ]; do
        case "$1" in
            --template) log_warn "azure repos cannot switch template post-create (create-time parentRepository only) — ignored"; shift ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    return 0
}

# Patch repo settings via the -F k=v dialect. Consumed settings map
# onto the repo update PATCH; unmapped keys degrade to documented skips.
# Usage: provider_repos_patch REPO -F k=v [-F k=v...]
provider_repos_patch() {
    local repo="${1:?repo required}"; shift
    local -a body_pairs=()
    local -a skipped=()
    while [ $# -gt 0 ]; do
        case "$1" in
            -F|-f)
                provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1
                local kv="$2"
                local k="${kv%%=*}" v="${kv#*=}"
                case "$k" in
                    # Azure has no per-repo merge-strategy toggles (the
                    # project's merge-strategies policy owns that surface),
                    # and the repositories PATCH endpoint rejects description
                    # outright ('The repository change is not supported') —
                    # both degrade to documented skips.
                    allow_merge_commit|allow_squash_merge|allow_rebase_merge|allow_auto_merge|delete_branch_on_merge|allow_update_branch|description)
                        skipped+=("$k") ;;
                    *)
                        body_pairs+=("$k" "$v")
                        ;;
                esac
                shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    if [ "${#skipped[@]}" -gt 0 ]; then
        log_warn "provider_repos_patch: azure repos have no ${skipped[*]} knobs (merge strategies are project-policy; description is create-time only) — skipped"
    fi
    [ "${#body_pairs[@]}" -gt 0 ] || return 0
    # Build the update body from surviving k/v pairs.
    # Keys are emitted as quoted JSON object keys with $var refs: a key
    # containing jq-special characters (dash, dot) must not be interpolated
    # as a bare {shorthand} identifier.
    local -a jq_argv=("jq" "-cn")
    local -a key_refs=()
    local i=0
    while [ "$i" -lt "${#body_pairs[@]}" ]; do
        jq_argv+=(--arg "${body_pairs[$i]}" "${body_pairs[$((i+1))]}")
        key_refs+=("\"${body_pairs[$i]}\":\$${body_pairs[$i]}")
        i=$((i+2))
    done
    local body
    body=$("${jq_argv[@]}" "{${key_refs[*]}}") || return 1
    local repo_url
    repo_url=$(azure_git_repo_url "$repo") || return 1
    azure_http_request PATCH "${repo_url}?api-version=7.1" "$body" >/dev/null
}

# Protect a branch: the seam-shaped protection payload translates to a
# minimum-reviewers policy configuration on the branch ref (the azure
# analog surface; other payload keys degrade with a log line). Idempotent: a
# policy already on that repo and branch is updated in place (re-provisioning
# would otherwise be rejected as a duplicate).
# Usage: provider_repos_protect_branch REPO BRANCH PAYLOAD_FILE
provider_repos_protect_branch() {
    local repo="${1:?repo required}" branch="${2:?branch required}" payload_file="${3:?payload file required}"
    local repo_guid
    repo_guid=$(azure_repo_guid "$repo") || return 1
    local parts base
    parts=$(azure_repo_parts "$repo") || return 1
    base="https://dev.azure.com/$(azure_uri "$(printf '%s' "$parts" | sed -n 1p)")/$(azure_uri "$(printf '%s' "$parts" | sed -n 2p)")/_apis/policy"
    local reviewers
    reviewers=$(jq -r '.required_pull_request_reviews.required_approving_review_count // 1' "$payload_file" 2>/dev/null) || reviewers=1
    local type_id="fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"
    local body
    body=$(jq -cn --arg rg "$repo_guid" --arg ref "refs/heads/$branch" --argjson mr "$reviewers" --arg t "$type_id" '{
        type: {id: $t},
        isEnabled: true,
        isBlocking: true,
        settings: {
            scope: [{repositoryId: $rg, matchKind: "exact", refName: $ref}],
            minimumApproverCount: $mr,
            creatorVoteCounts: false,
            allowDownvotes: false,
            resetOnSourcePush: false
        }
    }')
    local existing existing_id
    existing=$(azure_http_request GET "${base}/configurations?api-version=7.1") || return 1
    existing_id=$(printf '%s' "$existing" | jq -r --arg rg "$repo_guid" --arg ref "refs/heads/$branch" --arg t "$type_id" \
        '[.value[]? | select(.type.id == $t and .settings.scope[0].repositoryId == $rg and .settings.scope[0].refName == $ref) | .id][0] // empty')
    if [ -n "$existing_id" ]; then
        azure_http_request PUT "${base}/configurations/${existing_id}?api-version=7.1" "$body" >/dev/null
    else
        azure_http_request POST "${base}/configurations?api-version=7.1" "$body" >/dev/null
    fi
}

# ---------------------------------------------------------------------------
# Permissions (research-verified SDDL + accesscontrolentries path)
# ---------------------------------------------------------------------------

# Decode a graph descriptor to the SDDL string the ACL API accepts
# (base64 payload, URL-safe alphabet, Microsoft.TeamFoundation.Identity
# prefix — the raw vssgp./aad. descriptor is rejected with a 500).
# Usage: azure_identity_sddl DESCRIPTOR -> prints SDDL
azure_identity_sddl() {
    local descriptor="${1:?descriptor required}"
    local payload="${descriptor#*.}"
    # Graph descriptors are unpadded URL-safe base64; restore the padding
    # (base64 -d rejects missing '=' fill) before decoding.
    while [ $(( ${#payload} % 4 )) -ne 0 ]; do
        payload="${payload}="
    done
    local decoded
    decoded=$(printf '%s' "$payload" | tr '_-' '/+' | base64 -d 2>/dev/null) || return 1
    printf 'Microsoft.TeamFoundation.Identity;%s' "$decoded"
}

# Map a seam permission word to the Git Repositories allow-bits mask
# (live-verified values; triage = read + work-items bits per owner
# decision).
# Usage: azure_grant_bits PERM -> prints numeric mask
azure_grant_bits() {
    case "$1" in
        pull)    echo 2 ;;
        triage)  echo 2 ;;   # + WorkItems-namespace bits when issue work is needed
        push)    echo 54 ;;
        maintain) echo 2230 ;;
        admin)   echo 3967 ;;
        *) log_error "azure_grant_bits: unknown permission '$1'"; return 1 ;;
    esac
}

# Grant a team repo permissions (idempotent merge; response echo is the
# read-back).
# Usage: provider_repos_team_put ORG TEAM REPO [PERMISSION]
provider_repos_team_put() {
    local _org="$1" team="$2" repo="$3" perm="${4:-push}"
    azure_acl_grant "groups" "$team" "$repo" "$perm"
}

# Grant a user repo permissions.
# Usage: provider_repos_collaborator_put REPO USERNAME [FLAGS...]
provider_repos_collaborator_put() {
    local repo="$1" user="$2"; shift 2
    local perm="push"
    while [ $# -gt 0 ]; do
        case "$1" in
            --permission) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; perm="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    azure_acl_grant "users" "$user" "$repo" "$perm"
}

# Shared grant path: resolve the identity descriptor (graph groups or
# users), SDDL-decode, POST the ACE with the mapped bits.
# Usage: azure_acl_grant KIND NAME REPO PERM  (kind: groups|users)
azure_acl_grant() {
    local kind="$1" name="$2" repo="$3" perm="$4"
    local parts org project org_enc
    parts=$(azure_repo_parts "$repo") || return 1
    org=$(printf '%s' "$parts" | sed -n 1p); project=$(printf '%s' "$parts" | sed -n 2p)
    org_enc=$(azure_uri "$org")
    local repo_guid
    repo_guid=$(azure_repo_guid "$repo") || return 1
    local bits
    bits=$(azure_grant_bits "$perm") || return 1
    # Resolve the identity descriptor via the graph API (vssps host). The list is
    # org-wide and paged, and display names repeat across projects (every project
    # has a "Contributors"): a group matches on its principal name,
    # "[<project>]\\<name>", in this repo's project; a user on principal name
    # (the sign-in address) or, failing that, exact display name. Exactly one
    # identity must match.
    local descriptor_response
    descriptor_response=$(azure_http_paginate "https://vssps.dev.azure.com/${org_enc}/_apis/graph/${kind}?api-version=7.1-preview.1") || return 1
    local descriptor matches
    matches=$(printf '%s' "$descriptor_response" | jq -c --arg n "$name" --arg p "$project" --arg kind "$kind" '
        [.[] | select(
            if $kind == "groups" then
                ((.principalName // "") == $n) or ((.principalName // "") == ("[" + $p + "]\\" + $n))
            else
                ((.principalName // "") == $n) or ((.displayName // "") == $n)
            end) | .descriptor]') || return 1
    case "$(printf '%s' "$matches" | jq 'length')" in
        0) descriptor="" ;;
        1) descriptor=$(printf '%s' "$matches" | jq -r '.[0]') ;;
        *) log_error "azure_acl_grant: ${kind%s} '$name' matches more than one identity — pass its principal name"; return 1 ;;
    esac
    [ -n "$descriptor" ] || { log_error "azure_acl_grant: ${kind%@*} '$name' not found"; return 1; }
    local sddl
    sddl=$(azure_identity_sddl "$descriptor") || return 1
    local ns="2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87"   # Git Repositories
    # ACL security tokens are dataspace-rooted: repoV2/{PROJECT-id}/{repo-id}
    # — a bare repo guid as the first segment fails with "Could not find
    # dataspace with category Git" (live-verified).
    local project_id_response project_id
    # Capture-then-jq: a transport failure must fail the grant, not
    # masquerade as "project id unresolvable".
    project_id_response=$(azure_http_request GET "https://dev.azure.com/${org_enc}/_apis/projects/$(azure_uri "$project")?api-version=7.1") || return 1
    project_id=$(printf '%s' "$project_id_response" | jq -r '.id // empty')
    [ -n "$project_id" ] || { log_error "azure_acl_grant: project id unresolvable"; return 1; }
    local token
    token=$(printf 'repoV2/%s/%s' "$project_id" "$repo_guid")
    local body
    body=$(jq -cn --arg t "$token" --arg d "$sddl" --argjson a "$bits"         '{token: $t, merge: true, accessControlEntries: [{descriptor: $d, allow: $a, deny: 0}]}')
    # Error contract: emit the transport's error JSON on failure.
    local response
    if ! response=$(azure_http_request POST "https://dev.azure.com/${org_enc}/_apis/accesscontrolentries/${ns}?api-version=7.1" "$body"); then
        printf '%s' "$response"
        return 1
    fi
    printf '%s' "$response"
}

# View a repo. Output shape follows the seam: --json fields (name, nameWithOwner,
# owner.login, defaultBranchRef.name) via a seam-compatible projection.
# Usage: provider_repos_view [SPEC] [--json FIELDS] [-q JQ]
provider_repos_view() {
    local repo="${1:-}"
    # if-form shift: the && chain would return 1 under `set -e` when the
    # first arg is a flag, aborting the function before validation runs.
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        shift
    fi

    if [ -z "$repo" ]; then
        repo=$(_provider_repo_cwd_spec)
        [ -n "$repo" ] || { log_error "provider_repos_view: no repo argument and no git context"; return 1; }
    fi
    local api
    api=$(azure_git_repo_url "$repo") || return 1
    local response
    if ! response=$(azure_http_request GET "$api"); then
        return 1
    fi

    # Field projection: honor --json/-q in the seam dialect callers use. Azure repo
    # objects differ from the seam's shape, so each seam field maps to its Azure source
    # field; unknown fields fail defined, and a field the repo has no value for
    # (an empty repo has no default branch) fails rather than reading as "null".
    local fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; fields="${2:-}"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="${2:-}"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    if [ -z "$fields" ]; then
        if [ -n "$jq_expr" ]; then
            azure_jq_query "$jq_expr" <<< "$response"
        else
            printf '%s\n' "$response"
        fi
        return
    fi
    local flist f obj="{}" val
    IFS=',' read -ra flist <<< "$fields"
    [ "${#flist[@]}" -gt 0 ] || { log_error "provider_repos_view: empty --json field list"; return 1; }
    for f in "${flist[@]}"; do
        case "$f" in
            name) val=$(jq -c '.name // null' <<< "$response") ;;
            repoSpec) val=$(jq -c 'if .name then "\(.project.name)/\(.name)" else null end' <<< "$response") ;;
            owner) val=$(jq -c 'if .project.name then {login: .project.name} else null end' <<< "$response") ;;
            defaultBranchRef) val=$(jq -c 'if .defaultBranch then {name: .defaultBranch} else null end' <<< "$response") ;;
            *) log_error "provider_repos_view: unsupported --json field '$f'"; return 1 ;;
        esac
        [ "$val" != "null" ] || { log_error "provider_repos_view: field '$f' has no value for this repository"; return 1; }
        obj=$(jq -c --arg k "$f" --argjson v "$val" '. + {($k): $v}' <<< "$obj")
    done
    if [ -n "$jq_expr" ]; then
        azure_jq_query "$jq_expr" <<< "$obj"
        return
    fi
    # Without -q a single scalar field prints as raw text (the form the
    # default-branch lookup reads); several fields print as one object.
    if [ "${#flist[@]}" -eq 1 ]; then
        case "${flist[0]}" in
            name) jq -r '.name' <<< "$obj" ;;
            repoSpec) jq -r '.repoSpec' <<< "$obj" ;;
            owner) jq -r '.owner.login' <<< "$obj" ;;
            defaultBranchRef) jq -r '.defaultBranchRef.name' <<< "$obj" ;;
        esac
    else
        printf '%s\n' "$obj"
    fi
}

# List an org-project's repos. Output: one JSON array of seam-shaped
# {name, nameWithOwner, isPrivate} objects; --json/-q apply list
# semantics (projection per record, jq over the whole array — callers use
# `--json name -q '.[].name'` to iterate repo names).
# Usage: provider_repos_list ORG/PROJECT [--limit N] [--json FIELDS] [-q J]
provider_repos_list() {
    local org_project="$1"; shift
    local json_fields="" jq_expr="" limit=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; json_fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            --limit|-L) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; limit="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    case "$limit" in
        ''|*[!0-9]*) [ -z "$limit" ] || { log_error "provider_repos_list: --limit requires a number"; return 1; } ;;
    esac
    local org project
    case "$org_project" in
        */*) org="${org_project%%/*}"; project="${org_project#*/}" ;;
        *)
            # Bare org: project must come from config.
            local op
            op=$(azure_org_project) || return 1
            org="$org_project"
            project=$(printf '%s' "$op" | sed -n 2p)
            ;;
    esac

    local api="https://dev.azure.com/${org}/${project}/_apis/git/repositories"
    local response
    if ! response=$(azure_http_paginate "$api"); then
        return 1
    fi

    # Map to the seam's repo shape, then apply list semantics for --json/-q.
    local mapped
    mapped=$(printf '%s' "$response" | jq -c --arg n "$limit" '[.[] | {name: .name, repoSpec: (.project.name + "/" + .name), isPrivate: .isPrivate}] | if $n == "" then . else .[:($n|tonumber)] end')
    azure_apply_list_flags "$mapped" "$json_fields" "$jq_expr"
}

# List packages for the org. Azure Artifacts is feed-centric: org packages
# surface through the packaging feeds API (same source as
# provider_org_feeds_list). Endpoint argument mirrors the github verb's
# contract for call-shape parity; azure resolves targeting itself and the
# argument is advisory only.
# Usage: provider_org_packages_list [ENDPOINT] [-f KEY=VALUE ...]
provider_org_packages_list() {
    local op
    op=$(azure_org_project) || return 1
    local org
    org=$(printf '%s' "$op" | sed -n 1p)
    local response
    if ! response=$(azure_http_request GET "https://feeds.dev.azure.com/${org}/_apis/packaging/feeds?api-version=7.1-preview.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -c '[.value[] | {name: .name, package_type: "nuget", id: .id, url: .url}]'
}

# List versions of one package. Azure Artifacts exposes per-feed package
# versions; without a feed+package id the neutral layer's GitHub-shaped
# endpoint cannot resolve — fail defined rather than guessing a feed.
# Usage: provider_org_package_versions ENDPOINT
provider_org_package_versions() {
    log_error "provider_org_package_versions: azure packages versioning is feed-scoped; the GitHub-shaped endpoint has no Azure analog"
    return 1
}
