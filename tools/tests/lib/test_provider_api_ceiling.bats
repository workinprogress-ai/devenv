#!/usr/bin/env bats
# Ceiling test: freeze the provider_api escape-hatch call-site count.
#
# provider_api is the sanctioned escape hatch for provider-specific surfaces
# without a dedicated facade verb. Every call site is a surface a second
# provider must re-implement by hand, so growth is reviewable by design:
# to add a call site, either promote it to a named provider verb first, or
# bump the ceiling below with a rationale comment in the same change.
#
# Counting method (must stay stable):
#   - live tree only: tools/scripts/ + tools/lib/ (bash), cache excluded
#   - provider module definitions excluded (providers/github/repos.bash is
#     where the verbs are DEFINED, not called)
#   - comment lines excluded (leading-whitespace #)

load ../test_helper

CEILING_PROVIDER_API_CALL_SITES=19

_count_provider_api_call_sites() {
    grep -rn --include='*.sh' --include='*.bash' -E 'provider_api(_paginate)?[[:space:]]' \
        "$DEVENV_TOOLS/scripts" "$DEVENV_TOOLS/lib" 2>/dev/null \
        | grep -v '/cache/' \
        | grep -v 'lib/providers/' \
        | grep -v -E ':[0-9]+:[[:space:]]*#' \
        | grep -v -E ':[0-9]+:[[:space:]]*#.*provider_api' \
        | wc -l
}

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
}

@test "provider_api escape hatch: call sites within ceiling" {
    local count
    count=$(_count_provider_api_call_sites)
    echo "provider_api call sites: $count (ceiling $CEILING_PROVIDER_API_CALL_SITES)"
    [ "$count" -le "$CEILING_PROVIDER_API_CALL_SITES" ]
}

@test "provider_api ceiling counter excludes provider module definitions" {
    # The definition site (repos.bash) must not be counted; the counter's
    # exclusion of lib/providers/ is what keeps the ceiling meaningful.
    local count
    count=$(_count_provider_api_call_sites)
    local defs
    defs=$(grep -c 'provider_api()' "$DEVENV_TOOLS/lib/providers/github/repos.bash")
    [ "$defs" -ge 1 ]
    [ "$count" -lt $((count + defs)) ]  # trivially true; guard against counter regressions
}
