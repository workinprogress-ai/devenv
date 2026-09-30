#!/bin/bash
# azure/repos.bash - Azure DevOps implementation of the repos domain verbs.
#
# Implements the verbs current tools/ call sites use (parity definition,
# plan #40): provider_repos_list, provider_repos_view, and
# provider_repos_default_branch (used by workflow helpers), plus the
# azure cwd-spec hook for the core repo-target resolver and the
# repo-args shim for shared -R-style call sites. Output shapes
# mirror the gh-backed fields callers consume (--json name, --json
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
if ! declare -F azure_apply_gh_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/repos.bash: providers/azure/http.bash failed to load"
    return 1
fi
if ! declare -F azure_repo_guid >/dev/null; then
    azure_repo_guid() {
        local repo="${1:?repo required}"
        local op org project repo_name
        op=$(azure_org_project) || return 1
        org=$(printf '%s' "$op" | sed -n 1p)
        project=$(printf '%s' "$op" | sed -n 2p)
        repo_name="$repo"
        case "$repo" in
            */*) repo_name="${repo##*/}" ;;
        esac
        local response
        if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo_name}?api-version=7.1"); then
            return 1
        fi
        printf '%s' "$response" | jq -r '.id // empty'
    }
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
        local config_file="${DEVENV_ROOT:-}/devenv.config"
        if [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ] && [ -f "$config_file" ]; then
            # shellcheck disable=SC1091
            source "${DEVENV_TOOLS}/lib/config-reader.bash"
            if config_init "$config_file" 2>/dev/null; then
                [ -z "$org" ] && org=$(config_read_value "provider" "azure_org" "" 2>/dev/null)
                [ -z "$project" ] && project=$(config_read_value "provider" "azure_project" "" 2>/dev/null)
            fi
        fi
    fi
    if [ -z "$org" ] || [ -z "$project" ]; then
        log_error "azure org/project unresolved — set [provider] azure_org and azure_project in devenv.config"
        return 1
    fi
    printf '%s\n%s\n' "$org" "$project"
}

# Cwd leg for the core repo-target resolver: azure specs are three-part
# (org/project/repo), composed from config org/project + git root basename.
# Both legs must resolve; empty (not error) when they don't — the core
# resolver's contract decides what empty means.
_provider_repo_cwd_spec() {
    local op
    op=$(azure_org_project 2>/dev/null) || return 0
    local org project repo_name
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    if [ -n "$org" ] && [ -n "$project" ] && [ -n "$repo_name" ]; then
        echo "${org}/${project}/${repo_name}"
        return 0
    fi
    return 0
}

# Repo-args shim for shared call sites that build gh-style -R owner/repo
# specs. Azure carries no -R flag; the shim emits an azure-shaped
# project/repo spec so argument arrays stay resolvable, and github-only
# call sites (all current consumers) never take this path.
# Usage: provider_gh_repo_args ARR_VAR [repo]
provider_gh_repo_args() {
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
# Usage: provider_repos_commits_count [org/project/repo]  -> exit 0 non-empty
provider_repos_commits_count() {
    local repo="${1:-}"
    local op org project repo_name
    if [ -n "$repo" ]; then
        case "$repo" in
            */*/*) org="${repo%%/*}"; local rest="${repo#*/}"; project="${rest%%/*}"; repo_name="${rest#*/}" ;;
            *) log_error "provider_repos_commits_count: '$repo' is ambiguous for Azure — use org/project/repo"; return 1 ;;
        esac
    else
        op=$(azure_org_project) || return 1
        org=$(printf '%s' "$op" | sed -n 1p)
        project=$(printf '%s' "$op" | sed -n 2p)
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        [ -n "$repo_name" ] || { log_error "provider_repos_commits_count: no repo argument and no git context"; return 1; }
    fi
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo_name}/commits?\$top=1&api-version=7.1"); then
        return 1
    fi
    [ "$(printf '%s' "$response" | jq -r '.count // 0')" -ge 1 ]
}

# Create a repo. GH dialect flags translated: --description maps
# directly; --template maps to parentRepository (fork-in-project);
# visibility flags are accepted and ignored (azure repos are
# project-scoped and private by default — documented degrade).
# Usage: provider_repos_create NAME [GH-DIALECT FLAGS...]
provider_repos_create() {
    local name="${1:?repo name required}"; shift
    name="${name##*/}"   # accept full specs; azure wants the bare name
    local description="" template=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --public|--private|--internal) shift ;;
            --description) description="$2"; shift 2 ;;
            --template) template="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    local op base
    op=$(azure_org_project) || return 1
    base="https://dev.azure.com/$(printf '%s' "$op" | sed -n 1p)/$(printf '%s' "$op" | sed -n 2p)/_apis/git/repositories"
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
    printf '%s' "$response" | jq -c '{name, id, nameWithOwner: .name}'
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
            *) shift ;;
        esac
    done
    return 0
}

# Patch repo settings via the GH -F k=v dialect. Consumed settings map
# onto the repo update PATCH; unmapped keys degrade to documented skips.
# Usage: provider_repos_patch REPO -F k=v [-F k=v...]
provider_repos_patch() {
    local repo="${1:?repo required}"; shift
    local op org project repo_name
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p); project=$(printf '%s' "$op" | sed -n 2p)
    repo_name="${repo##*/}"
    local -a body_pairs=()
    local -a skipped=()
    while [ $# -gt 0 ]; do
        case "$1" in
            -F|-f)
                local kv="$2"
                local k="${kv%%=*}" v="${kv#*=}"
                case "$k" in
                    # Azure has no per-repo merge-strategy toggles (the
                    # project's merge-strategies policy owns that surface).
                    allow_merge_commit|allow_squash_merge|allow_rebase_merge|allow_auto_merge|delete_branch_on_merge|allow_update_branch)
                        skipped+=("$k") ;;
                    *)
                        body_pairs+=("$k" "$v")
                        ;;
                esac
                shift 2 ;;
            *) shift ;;
        esac
    done
    if [ "${#skipped[@]}" -gt 0 ]; then
        log_warn "provider_repos_patch: azure repos have no ${skipped[*]} knobs (merge strategies are project-policy) — skipped"
    fi
    [ "${#body_pairs[@]}" -gt 0 ] || return 0
    # Build the update body from k/v pairs (description is the mapped knob).
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
    azure_http_request PATCH "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo_name}?api-version=7.1" "$body" >/dev/null
}

# Protect a branch: the GH-shaped protection payload translates to a
# minimum-reviewers policy configuration on the branch ref (the azure
# analog surface; other payload keys degrade with a log line).
# Usage: provider_repos_protect_branch REPO BRANCH PAYLOAD_FILE
provider_repos_protect_branch() {
    local repo="${1:?repo required}" branch="${2:?branch required}" payload_file="${3:?payload file required}"
    local repo_guid
    repo_guid=$(azure_repo_guid "$repo") || return 1
    local op base
    op=$(azure_org_project) || return 1
    base="https://dev.azure.com/$(printf '%s' "$op" | sed -n 1p)/$(printf '%s' "$op" | sed -n 2p)/_apis/policy"
    local reviewers
    reviewers=$(jq -r '.required_pull_request_reviews.required_approving_review_count // 1' "$payload_file" 2>/dev/null) || reviewers=1
    local body
    body=$(jq -cn --arg rg "$repo_guid" --arg ref "refs/heads/$branch" --argjson mr "$reviewers" '{
        type: {id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},
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
    azure_http_request POST "${base}/configurations?api-version=7.1" "$body" >/dev/null
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

# Map a GH permission word to the Git Repositories allow-bits mask
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
            --permission) perm="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    azure_acl_grant "users" "$user" "$repo" "$perm"
}

# Shared grant path: resolve the identity descriptor (graph groups or
# users), SDDL-decode, POST the ACE with the mapped bits.
# Usage: azure_acl_grant KIND NAME REPO PERM  (kind: groups|users)
azure_acl_grant() {
    local kind="$1" name="$2" repo="$3" perm="$4"
    local op org
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p)
    local repo_guid
    repo_guid=$(azure_repo_guid "$repo") || return 1
    local bits
    bits=$(azure_grant_bits "$perm") || return 1
    # Resolve the identity descriptor via the graph API (vssps host).
    # Capture-then-jq: a transport failure must fail the grant, not
    # masquerade as "identity not found".
    local descriptor_response
    descriptor_response=$(azure_http_request GET "https://vssps.dev.azure.com/${org}/_apis/graph/${kind}?api-version=7.1-preview.1") || return 1
    local descriptor
    descriptor=$(printf '%s' "$descriptor_response" | jq -r --arg n "$name" \
        'if .value then (.value[] | select((.displayName // .principalName // "") == $n) | .descriptor) else empty end') || return 1
    [ -n "$descriptor" ] || { log_error "azure_acl_grant: ${kind%@*} '$name' not found"; return 1; }
    local sddl
    sddl=$(azure_identity_sddl "$descriptor") || return 1
    local ns="2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87"   # Git Repositories
    local token
    token=$(printf 'repoV2/%s' "$repo_guid")
    local body
    body=$(jq -cn --arg t "$token" --arg d "$sddl" --argjson a "$bits"         '{token: $t, merge: true, accessControlEntries: [{descriptor: $d, allow: $a, deny: 0}]}')
    azure_http_request POST "https://dev.azure.com/${org}/_apis/accesscontrolentries/${ns}?api-version=7.1" "$body" >/dev/null
}

# View a repo. Output shape mirrors gh: --json fields (name, nameWithOwner,
# owner.login, defaultBranchRef.name) via a gh-compatible projection.
# Usage: provider_repos_view [org/project/repo] [--json FIELDS] [-q JQ]
provider_repos_view() {
    local repo="${1:-}"
    # if-form shift: the && chain would return 1 under `set -e` when the
    # first arg is a flag, aborting the function before validation runs.
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        shift
    fi

    local org project repo_name
    if [ -n "$repo" ]; then
        # Accept "org/project/repo" (Azure-native) or bare "repo" (config
        # supplies org/project).
        case "$repo" in
            */*/*) org="${repo%%/*}"; local rest="${repo#*/}"; project="${rest%%/*}"; repo_name="${rest#*/}" ;;
            */*) log_error "provider_repos_view: 'org/repo' is ambiguous for Azure — use org/project/repo or configure [provider] azure_org/azure_project"; return 1 ;;
            *) repo_name="$repo"
               local op
               op=$(azure_org_project) || return 1
               org=$(printf '%s' "$op" | sed -n 1p)
               project=$(printf '%s' "$op" | sed -n 2p)
               ;;
        esac
    else
        local op
        op=$(azure_org_project) || return 1
        org=$(printf '%s' "$op" | sed -n 1p)
        project=$(printf '%s' "$op" | sed -n 2p)
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        [ -n "$repo_name" ] || { log_error "provider_repos_view: no repo argument and no git context"; return 1; }
    fi

    local api="https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo_name}"
    local response
    if ! response=$(azure_http_request GET "$api"); then
        return 1
    fi

    # Field projection: honor --json/-q in the gh dialect callers use.
    # Azure repo objects differ from gh's shape, so each gh field maps to
    # its Azure source field; unknown fields fail defined (empty jq output
    # must not read as success at call sites).
    if [ "${1:-}" = "--json" ]; then
        local fields="$2"
        local projected=""
        case "$fields" in
            name) projected="$(jq -r '.name' <<< "$response" 2>/dev/null)" ;;
            nameWithOwner) jq -r '"\(.project.name)/\(.name)"' <<< "$response" 2>/dev/null && return 0 ;;
            owner) jq -r '.project.name' <<< "$response" 2>/dev/null && return 0 ;;
            defaultBranchRef) projected="$(jq -r '.defaultBranch' <<< "$response" 2>/dev/null)" ;;
            *)
                # Comma-separated gh field lists: map each, emit one JSON
                # object in the gh shape.
                local flist f out_json=""
                local any=0
                IFS=',' read -ra flist <<< "$fields"
                for f in "${flist[@]}"; do
                    any=1
                    case "$f" in
                        name) out_json+="$( [ -n "$out_json" ] && printf , )\"name\":$(jq -c '.name' <<< "$response" 2>/dev/null)" ;;
                        nameWithOwner) out_json+="$( [ -n "$out_json" ] && printf , )\"nameWithOwner\":$(jq -c '"\(.project.name)/\(.name)"' <<< "$response" 2>/dev/null)" ;;
                        owner) out_json+="$( [ -n "$out_json" ] && printf , )\"owner\":$(jq -c '{login: .project.name}' <<< "$response" 2>/dev/null)" ;;
                        defaultBranchRef) out_json+="$( [ -n "$out_json" ] && printf , )\"defaultBranchRef\":$(jq -c '{name: .defaultBranch}' <<< "$response" 2>/dev/null)" ;;
                        *) log_error "provider_repos_view: unsupported --json field '$f'"; return 1 ;;
                    esac
                done
                [ "$any" -eq 1 ] || { log_error "provider_repos_view: empty --json field list"; return 1; }
                printf '{%s}\n' "$out_json"
                return 0
                ;;
        esac
        [ -n "$projected" ] || { log_error "provider_repos_view: field '$fields' missing from response"; return 1; }
        printf '%s\n' "$projected"
        return 0
    fi
    printf '%s\n' "$response"
}

# List an org-project's repos. Output: one JSON array of gh-shaped
# {name, nameWithOwner, isPrivate} objects; --json/-q apply gh list
# semantics (projection per record, jq over the whole array — callers use
# `--json name -q '.[].name'` to iterate repo names).
# Usage: provider_repos_list ORG/PROJECT [--limit N] [--json FIELDS] [-q J]
provider_repos_list() {
    local org_project="$1"; shift
    local json_fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then json_fields="$1"; shift; fi
                ;;
            -q|--jq)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then jq_expr="$1"; shift; fi
                ;;
            *) shift ;;
        esac
    done
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

    # Map to gh's repo shape, then apply gh list semantics for --json/-q.
    local mapped
    mapped=$(printf '%s' "$response" | jq -c '[.[] | {name: .name, nameWithOwner: (.project.name + "/" + .name), isPrivate: .isPrivate}]')
    azure_apply_gh_list_flags "$mapped" "$json_fields" "$jq_expr"
}
