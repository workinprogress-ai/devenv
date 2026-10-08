#!/usr/bin/env bash
# fork.bash - Shared helpers for the fork scripts (fork-setup, fork-sync,
# fork-export): the [fork] configuration and URL comparison. See docs/Forking.md.

# Guard against multiple sourcing
if [ -n "${_FORK_LIB_LOADED:-}" ]; then
    return 0
fi
_FORK_LIB_LOADED=1

# Decode %XX escapes in a URL path (a space is "%20" in one spelling of a remote and a
# literal space in another), so one repository has one comparable form. %2F stays
# encoded: decoding it would invent a path separator.
# Usage: _fork_uri_decode TEXT
_fork_uri_decode() {
    local in="${1:-}" out="" hex
    while [[ "$in" =~ ^([^%]*)%([0-9A-Fa-f]{2})(.*)$ ]]; do
        out+="${BASH_REMATCH[1]}"
        hex="${BASH_REMATCH[2]}"
        in="${BASH_REMATCH[3]}"
        if [ "${hex^^}" = "2F" ]; then
            out+="%2f"
        else
            # shellcheck disable=SC2059  # the escape is built on purpose
            out+="$(printf "\\x${hex}")"
        fi
    done
    printf '%s' "${out}${in}"
}

# Reduce a git remote URL to a comparable host/path form: scheme, user, port and a
# trailing slash or .git removed, lower-cased (hosts and paths compare
# case-insensitively here). Handles scp-style `[user@]host:path`, `ssh://`, `https://`,
# `http://`, `git://` and `file://` forms, with or without a path; the Azure DevOps ssh
# and visualstudio.com spellings of a repository reduce to its https form.
#
# Usage: fork_normalize_git_url URL
fork_normalize_git_url() {
    local url="$1" authority path
    case "$url" in
        *://*)
            url="${url#*://}"
            authority="${url%%/*}"
            if [ "$authority" = "$url" ]; then
                path=""
            else
                path="${url#*/}"
            fi
            authority="${authority##*@}"
            if [[ "$authority" == *:* ]] && ! [[ "${authority#*:}" =~ ^[0-9]*$ ]]; then
                # host:org with no numeric port is scp-style text inside a URL scheme
                path="${authority#*:}${path:+/$path}"
            fi
            authority="${authority%%:*}"
            if [ -n "$path" ]; then
                url="$authority/$path"
            else
                url="$authority"
            fi
            ;;
        *:*)
            # scp-style: [user@]host:path (a path with no scheme, so no port)
            url="${url##*@}"
            authority="${url%%:*}"
            path="${url#*:}"
            url="$authority/${path#/}"
            ;;
    esac
    # a file:// URL keeps its leading slash: file:///tmp/r -> /tmp/r
    url="$(_fork_uri_decode "$url")"
    url="${url%/}"
    url="${url%.git}"
    url="${url,,}"
    # Azure DevOps spells one repository several ways; reduce them to the https form
    # dev.azure.com/ORG/PROJECT/_git/REPO:
    #   ssh.dev.azure.com/v3/ORG/PROJECT/REPO       (ssh)
    #   vs-ssh.visualstudio.com/v3/ORG/PROJECT/REPO (older ssh host)
    #   ORG.visualstudio.com[/DefaultCollection]/PROJECT/_git/REPO
    if [[ "$url" =~ ^(ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)/v3/([^/]+)/([^/]+)/(.+)$ ]]; then
        url="dev.azure.com/${BASH_REMATCH[2]}/${BASH_REMATCH[3]}/_git/${BASH_REMATCH[4]}"
    elif [[ "$url" =~ ^([^/.]+)\.visualstudio\.com/(defaultcollection/)?([^/]+)/_git/(.+)$ ]]; then
        url="dev.azure.com/${BASH_REMATCH[1]}/${BASH_REMATCH[3]}/_git/${BASH_REMATCH[4]}"
    fi
    printf '%s\n' "$url"
}

# Whether the `upstream` remote of a repository is the configured [fork] upstream_repo.
# The URL compared is the one git actually contacts, after url.<base>.insteadOf
# rewriting: a rule that sends the remote to a different repository must not pass as
# the configured one. The comparison is normalized, so a .git suffix, a case difference
# or an ssh/https spelling of the same repository still matches.
#
# Usage: fork_upstream_matches REPO_ROOT   (needs FORK_UPSTREAM_REPO)
fork_upstream_matches() {
    local root="$1" contacted
    contacted="$(git -C "$root" remote get-url upstream 2>/dev/null || true)"
    [ -n "$contacted" ] || return 1
    [ "$(fork_normalize_git_url "$contacted")" = "$(fork_normalize_git_url "$FORK_UPSTREAM_REPO")" ]
}

# Read the required [fork] keys from devenv.config into FORK_UPSTREAM_REPO and
# FORK_UPSTREAM_BRANCH. Needs error-handling.bash and DEVENV_ROOT.
fork_load_config() {
    # shellcheck source=config-reader.bash
    source "$DEVENV_TOOLS/lib/config-reader.bash"
    [ -f "$DEVENV_ROOT/devenv.config" ] || die "could not read $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"
    FORK_UPSTREAM_REPO="$(config_get_raw "$DEVENV_ROOT/devenv.config" fork upstream_repo "")"
    FORK_UPSTREAM_BRANCH="$(config_get_raw "$DEVENV_ROOT/devenv.config" fork upstream_branch "")"
    [ -n "$FORK_UPSTREAM_REPO" ] || die "missing required [fork] upstream_repo in $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"
    [ -n "$FORK_UPSTREAM_BRANCH" ] || die "missing required [fork] upstream_branch in $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"
}

# Output-directory slug for a multi-select export. A selection is not a range, so a
# hash of the selected SHAs keeps two different selections from sharing a directory.
#
# Usage: fork_get_selection_slug BASE_SHORT END_SHORT SHA...
fork_get_selection_slug() {
    local base="$1" end="$2" hash
    shift 2
    hash="$(printf '%s\n' "$@" | git hash-object --stdin)"
    printf '%s-sel%s-%s\n' "$base" "${hash:0:7}" "$end"
}

# Whether the selected full SHAs are exactly every commit in BASE..END: only then may
# an export fast-forward the target.
#
# Usage: fork_is_full_range_selection REPO BASE END SHA...
fork_is_full_range_selection() {
    local repo="$1" base="$2" end="$3"
    shift 3
    [ "$(git -C "$repo" rev-list "$base..$end" | sort)" = "$(printf '%s\n' "$@" | sort)" ]
}
