#!/usr/bin/env bash
# azure/repo-flag.bash — defensive seam-dialect repo-flag translation.
#
# Canonical repo targeting is positional (provider_repo_target / get_repo_spec
# emit a bare `org/repo` or `org/project/repo` spec). Neutral callers
# may hand a verb a `-R <spec>` pair; azure's parsers normalize it
# here instead of dropping or mis-parsing it.
#
# azure_repo_flag_spec: scan the arg array for a leading `-R <spec>` /
# `--repo <spec>` / `-R=<spec>` and return the spec on stdout. Never emits —
# callers assign; the args are NOT consumed (parsers shift their own).

azure_repo_flag_spec() {
    local i=1
    while [ $i -le $# ]; do
        case "${!i}" in
            -R)
                local next=$((i + 1))
                eval "printf '%s\n' \"\${$next:-}\""
                return 0
                ;;
            -R=*|--repo=*)
                printf '%s\n' "${!i#*=}"
                return 0
                ;;
            --repo)
                local next=$((i + 1))
                eval "printf '%s\n' \"\${$next:-}\""
                return 0
                ;;
        esac
        i=$((i + 1))
    done
    return 1
}
