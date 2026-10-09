#!/bin/bash
# azure/urls.bash - Azure DevOps URL primitives for the url seam.
#
# Host and URL-shape definitions for Azure DevOps Services (cloud). All URL
# construction derives from provider_web_host so a fork retargeting its host
# (Server/on-prem later) edits one function.
#
# URL forms handled:
#   https://dev.azure.com/{org}/{project}/_git/{repo}   (https remote)
#   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}     (ssh remote)
# Web UI: https://dev.azure.com/{org}/{project}/{path}

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_URLS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_URLS_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

# A value from devenv.config through the one INI reader, read from the file itself so
# nothing global is re-pointed. Prints nothing when the file or key is absent.
# Usage: azure_config_get SECTION KEY
azure_config_get() {
    local file="${DEVENV_ROOT:-}/devenv.config"
    [ -f "$file" ] || return 0
    if ! declare -F config_get_raw >/dev/null; then
        [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ] || return 0
        # shellcheck disable=SC1091
        source "${DEVENV_TOOLS}/lib/config-reader.bash"
    fi
    config_get_raw "$file" "$1" "$2" "" 2>/dev/null || true
}

# Percent-encode one URL component (an org, project, repo or branch name, a
# definition name): spaces, slashes and the like in a name must not break or
# redirect the request.
# Usage: azure_uri VALUE -> prints the encoded value
azure_uri() {
    jq -rn --arg v "${1:-}" '$v|@uri'
}

# Web host for Azure DevOps Services. Single point of host definition:
# provider_extract_url derives its matcher from this.
# Usage: provider_web_host
provider_web_host() {
    printf 'dev.azure.com\n'
}

# Git transport URL for a repo: https://dev.azure.com/{org}/{project}/_git/{repo}.
# Clean URL — the PAT never embeds; auth rides the transport's header or the
# git credential helper.
# Usage: provider_git_transport_url ORG PROJECT REPO
#                             or:  provider_git_transport_url ORG REPO
# The 2-arg form (the shape neutral callers like repo-get use against the
# github seam) is accepted: the project injects from AZURE_DEVOPS_PROJECT
# or the configured [provider] azure_project. Callers MAY pass the resolved
# 3-part spec; providers own arity normalization.
provider_git_transport_url() {
    local org="${1:-}" project="${2:-}" repo="${3:-}"
    if [ -z "$org" ]; then
        log_error "provider_git_transport_url requires org"
        return 1
    fi
    if [ -z "$project" ]; then
        log_error "provider_git_transport_url requires repo (2-arg form: ORG REPO) or a project (3-arg form: ORG PROJECT REPO)"
        return 1
    fi
    if [ -z "$repo" ]; then
        # 2-arg form: $2 was the repo; re-slot it and inject the configured
        # project.
        repo="$project"
        project="${AZURE_DEVOPS_PROJECT:-}"
        [ -n "$project" ] || project=$(azure_config_get provider azure_project)
        if [ -z "$project" ]; then
            log_error "provider_git_transport_url: 2-arg form requires a configured project (AZURE_DEVOPS_PROJECT or [provider] azure_project)"
            return 1
        fi
    fi
    printf 'https://dev.azure.com/%s/%s/_git/%s\n' "$(azure_uri "$org")" "$(azure_uri "$project")" "$(azure_uri "$repo")"
}

# Org-level base URL (compatibility with the github url seam's shape).
# Usage: provider_git_remote_base ORG [PROJECT]
provider_git_remote_base() {
    local org="${1:-}"
    if [ -z "$org" ]; then
        log_error "provider_git_remote_base requires org"
        return 1
    fi
    printf 'https://dev.azure.com/%s\n' "$(azure_uri "$org")"
}

# Web-UI URL. The repo argument carries org/project/repo in the remote form
# "org/project/repo" (Azure nests one level deeper than GitHub's owner/repo);
# path is repo-relative ("pull/12", "issue/7").
# Usage: provider_web_url ORG/PROJECT/REPO PATH
provider_web_url() {
    local repo="${1:-}"
    local path="${2:-}"
    if [ -z "$repo" ] || [ -z "$path" ]; then
        log_error "provider_web_url requires repo (org/project/repo) and path"
        return 1
    fi
    # each segment of the org/project/repo spec is encoded; the path is the
    # caller's own relative path
    local seg encoded=""
    local -a segs
    IFS='/' read -ra segs <<< "$repo"
    for seg in "${segs[@]}"; do
        encoded="${encoded:+$encoded/}$(azure_uri "$seg")"
    done
    printf 'https://dev.azure.com/%s/%s\n' "$encoded" "$path"
}

# Extract the first web URL from provider output, optionally filtered to a
# path prefix. Mirrors the github seam's derivation: host from
# provider_web_host (single point of definition).
# Usage: printf '%s' "$output" | provider_extract_url [path_prefix]
provider_extract_url() {
    local path_prefix="${1:-}"
    local host_rx
    host_rx=$(provider_web_host | sed 's/\./\\./g')
    local pattern="https://${host_rx}[^[:space:]]+"
    if [ -n "$path_prefix" ]; then
        pattern="https://${host_rx}/[^[:space:]]*/${path_prefix}[^[:space:]]*"
    fi
    local url
    url=$(grep -oE "$pattern" | head -n1)
    [ -n "$url" ] && printf '%s\n' "$url"
}

# Decode %XX escapes in a URL path segment (a remote carries "My%20Project" where the
# name is "My Project"). Only well-formed %XX sequences are decoded; every request
# builder percent-encodes the name again with azure_uri.
# Usage: azure_uri_decode TEXT
azure_uri_decode() {
    local in="${1:-}" out="" hex
    while [[ "$in" =~ ^([^%]*)%([0-9A-Fa-f]{2})(.*)$ ]]; do
        out+="${BASH_REMATCH[1]}"
        hex="${BASH_REMATCH[2]}"
        in="${BASH_REMATCH[3]}"
        # shellcheck disable=SC2059  # the escape is built on purpose
        out+="$(printf "\\x${hex}")"
    done
    printf '%s' "${out}${in}"
}

# Parse an Azure DevOps git remote URL into org/project/repo.
# Accepts https and ssh forms (with or without a .git suffix), including the
# organization-host form.
#   https://dev.azure.com/org/project/_git/repo
#   https://org.visualstudio.com/project/_git/repo
#   git@ssh.dev.azure.com:v3/org/project/repo
# Usage: azure_parse_remote URL  -> prints "org/project/repo"
azure_parse_remote() {
    local url="$1"
    local org project repo
    case "$url" in
        *dev.azure.com/*_git/*)
            local tail="${url#*dev.azure.com/}"
            tail="${tail#.git}"
            tail="${tail%.git}"
            org="${tail%%/*}"
            local rest="${tail#*/}"
            project="${rest%%/*}"
            rest="${rest#*/_git/}"
            repo="$rest"
            ;;
        *.visualstudio.com/*_git/*)
            # the organization is the host's first label; embedded credentials
            # (https://token@org.visualstudio.com/...) are stripped first
            local host_part="${url#*://}"
            host_part="${host_part#*@}"
            org="${host_part%%.visualstudio.com*}"
            local tail="${host_part#*.visualstudio.com/}"
            tail="${tail%.git}"
            project="${tail%%/*}"
            repo="${tail#*/_git/}"
            ;;
        git@ssh.dev.azure.com:*)
            local tail="${url#git@ssh.dev.azure.com:v3/}"
            org="${tail%%/*}"
            local rest="${tail#*/}"
            project="${rest%%/*}"
            repo="${rest#*/}"
            repo="${repo%.git}"
            ;;
        *)
            log_error "azure_parse_remote: not a recognized Azure DevOps remote: $url"
            return 1
            ;;
    esac
    if [ -z "$org" ] || [ -z "$project" ] || [ -z "$repo" ]; then
        log_error "azure_parse_remote: could not split $url into org/project/repo"
        return 1
    fi
    # Names come out decoded: a remote spells a space as %20, and the request
    # builders encode the name once, themselves.
    printf '%s/%s/%s\n' "$(azure_uri_decode "$org")" "$(azure_uri_decode "$project")" "$(azure_uri_decode "$repo")"
}

# Normalize a git remote URL to the provider's clean https web form.
# Azure remotes (both https dev.azure.com and ssh v3 forms, with or
# without .git) collapse to
# https://dev.azure.com/{org}/{project}/_git/{repo}. Non-matching input
# returns 1.
#
# Usage:
#   web=$(provider_remote_to_web "$remote_url") || echo "not ours"
provider_remote_to_web() {
    local remote="${1:-}"
    local parsed
    if ! parsed=$(azure_parse_remote "$remote" 2>/dev/null); then
        # Not an azure remote — the seam contract: return 1 and let the
        # caller fall back (provider-hosted repos are the caller's concern).
        return 1
    fi
    local org project repo
    org="${parsed%%/*}"
    local rest="${parsed#*/}"
    project="${rest%%/*}"
    repo="${rest#*/}"
    printf 'https://dev.azure.com/%s/%s/_git/%s\n' "$(azure_uri "$org")" "$(azure_uri "$project")" "$(azure_uri "$repo")"
}

# A git remote URL as this provider's repo spec: the two-part project/repo (the
# organization comes from config). Returns 1 when the remote is not an Azure remote.
#
# Usage:
#   spec=$(provider_remote_to_spec "$remote_url") || echo "not ours"
provider_remote_to_spec() {
    local parsed
    parsed=$(azure_parse_remote "${1:-}" 2>/dev/null) || return 1
    printf '%s\n' "${parsed#*/}"
}

# The configured organization: AZURE_DEVOPS_ORG, else [provider] azure_org.
_azure_urls_config_org() {
    local org="${AZURE_DEVOPS_ORG:-}"
    [ -n "$org" ] || org=$(azure_config_get provider azure_org)
    printf '%s\n' "$org"
}

# Web page of a pull request. SPEC is project/repo (the organization comes from
# config) or org/project/repo.
# Usage: provider_pr_web_url SPEC NUMBER
provider_pr_web_url() {
    local spec="${1:-}" number="${2:-}"
    if [ -z "$spec" ] || [ -z "$number" ]; then
        log_error "provider_pr_web_url requires a repo spec (project/repo) and a PR number"
        return 1
    fi
    local org project repo
    case "$spec" in
        */*/*) org="${spec%%/*}"; local rest="${spec#*/}"; project="${rest%%/*}"; repo="${rest#*/}" ;;
        */*)   org="$(_azure_urls_config_org)"; project="${spec%%/*}"; repo="${spec#*/}" ;;
        *)     log_error "provider_pr_web_url: spec '$spec' is not project/repo"; return 1 ;;
    esac
    if [ -z "$org" ]; then
        log_error "provider_pr_web_url: organization unresolved — set [provider] azure_org in devenv.config"
        return 1
    fi
    printf 'https://dev.azure.com/%s/%s/_git/%s/pullrequest/%s\n' "$(azure_uri "$org")" "$(azure_uri "$project")" "$(azure_uri "$repo")" "$number"
}

# Web page of a work item. SPEC is project/repo (the organization comes from
# config) or org/project/repo; a work item belongs to the project, not the repo.
# Usage: provider_issue_web_url SPEC NUMBER
provider_issue_web_url() {
    local spec="${1:-}" number="${2:-}"
    if [ -z "$spec" ] || [ -z "$number" ]; then
        log_error "provider_issue_web_url requires a repo spec (project/repo) and a work item number"
        return 1
    fi
    local org project
    case "$spec" in
        */*/*) org="${spec%%/*}"; local rest="${spec#*/}"; project="${rest%%/*}" ;;
        */*)   org="$(_azure_urls_config_org)"; project="${spec%%/*}" ;;
        *)     log_error "provider_issue_web_url: spec '$spec' is not project/repo"; return 1 ;;
    esac
    if [ -z "$org" ]; then
        log_error "provider_issue_web_url: organization unresolved — set [provider] azure_org in devenv.config"
        return 1
    fi
    printf 'https://dev.azure.com/%s/%s/_workitems/edit/%s\n' "$(azure_uri "$org")" "$(azure_uri "$project")" "$number"
}

# ----------------------------------------------------------------------------
# seam-dialect list projections (shared by every list verb)
# ----------------------------------------------------------------------------

# Apply the seam's list semantics to a mapped JSON array of records:
#   1. --json FIELD,FIELD  -> per-record projection {field: .field, ...}
#      (unknown fields become null, matching the seam's behavior of only emitting
#      known keys — callers that ask for aliases a verb lacks get nulls,
#      never a hard failure, mirroring the seam's tolerant projection)
#   2. --jq/-q PROGRAM     -> applied ONCE to the whole array (list
#      semantics: '.[0].url' selects from the list, not per record)
# Validate a --json field list before it is spliced into a jq object constructor:
# a comma-separated list of plain names, each present in the record when a sample
# record is given (gh errors on an unknown field; so does this).
# Usage: azure_json_fields_check VERB FIELDS [SAMPLE_JSON]   (returns 1 with a named error)
azure_json_fields_check() {
    local verb="$1" fields="$2" sample="${3:-}" f
    if ! [[ "$fields" =~ ^[A-Za-z_][A-Za-z0-9_]*(,[A-Za-z_][A-Za-z0-9_]*)*$ ]]; then
        log_error "$verb: --json takes a comma-separated list of field names, got '$fields'"
        return 1
    fi
    [ -n "$sample" ] || return 0
    local IFS=','
    for f in $fields; do
        if ! printf '%s' "$sample" | jq -e --arg k "$f" 'has($k)' >/dev/null 2>&1; then
            log_error "$verb: unknown JSON field '$f'"
            return 1
        fi
    done
}

# Apply a -q/--jq program to JSON on stdin. A null result prints nothing (gh prints
# nothing for it, and callers test the output with [ -n ]); one rule for every verb.
# Usage: azure_jq_query PROGRAM < json
azure_jq_query() {
    jq -r "($1) | if . == null then empty else . end"
}

# Order matches the seam: projection first, then the jq program over the result.
# Usage: azure_apply_list_flags INPUT_JSON [FIELDS] [JQ_PROGRAM]
#   Prints the final output; empty FIELDS and JQ_PROGRAM echo INPUT unchanged.
azure_apply_list_flags() {
    local input="$1" fields="${2:-}" jq_program="${3:-}"
    if [ -n "$fields" ]; then
        azure_json_fields_check "azure list" "$fields" "$(printf '%s' "$input" | jq -c '.[0] // empty')" || return 1
        input=$(printf '%s' "$input" | jq -c "[.[] | {${fields}}]") || return 1
    fi
    if [ -n "$jq_program" ]; then
        # null jq results are suppressed (empty output for no-match selects
        # like '.[0].url' over an empty list); raw jq would print "null",
        # which consumers test with [ -n ] — empty means "no PR" to them.
        printf '%s' "$input" | azure_jq_query "$jq_program"
        return $?
    fi
    printf '%s' "$input"
}
