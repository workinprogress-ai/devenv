#!/bin/bash
# azure/org.bash - org-surface verbs for azure.
#
# The GH org module carries the ruleset surface; azure's analog is the
# repo-scoped policy configuration set (azure/policies.bash). This thin
# module keeps the canonical loader name ('org') provider-neutral:
# provider_load org resolves here and the ruleset verbs load through it.

if [ -n "${_PROVIDER_AZURE_ORG_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_ORG_LOADED=1

# The ruleset surface lives in policies.bash (repo-scoped policy
# configurations). Source it here so 'provider_load org' delivers the
# full org verb set for azure.
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/policies.bash"
# Releases + Artifacts feeds ride the org surface too.
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/releases.bash"
