#!/bin/bash
# identity-policy.bash - Identity-domain policy knobs (Plan-issue-39-001).
#
# Knobs:
#   policy_default_provider POLICY_DEFAULT_PROVIDER
#       Provider assumed when devenv.config has no [provider] name.
#   policy_org POLICY_ORG
#       The org owning the workspace's repos. Resolution order (see
#       policy_resolve): POLICY_ORG env -> GH_ORG env -> config
#       [organization] github_org -> fail. policy_default_provider is a
#       declared knob (see policy_define below); policy_org is implemented
#       directly because its chain predates the policy core and has two env
#       steps.
#
# Requires policy_core_init to have been called for policy_default_provider;
# policy_org is self-contained (uses config_read_value against POLICY_CONFIG_FILE).

# Self-source the core (guarded no-op when already loaded).
# shellcheck disable=SC1090,SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/policy-core.bash"


policy_define "default_provider" "DEFAULT_PROVIDER" "provider" "name" "github"

# Resolve the org identity: POLICY_ORG -> GH_ORG -> config [organization]
# github_org -> fail (empty output, rc 1). Callers decide whether empty is
# acceptable; repo safety logic treats unresolvable as foreign.
policy_org() {
    if [ -n "${POLICY_ORG:-}" ]; then
        echo "$POLICY_ORG"
        return 0
    fi
    if [ -n "${GH_ORG:-}" ]; then
        echo "$GH_ORG"
        return 0
    fi
    local value
    value=$(config_read_value "organization" "github_org" "")
    if [ -n "$value" ]; then
        echo "$value"
        return 0
    fi
    return 1
}
