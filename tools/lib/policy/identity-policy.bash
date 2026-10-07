#!/bin/bash
# identity-policy.bash - Identity-domain policy knobs (Plan-issue-39-001).
#
# Knobs:
#   policy_default_provider POLICY_DEFAULT_PROVIDER
#       Provider assumed when devenv.config has no [provider] name (env or the
#       built-in; deliberately not a config key).
#   policy_org POLICY_ORG
#       The org owning the workspace's repos. Resolution order (see
#       policy_resolve): POLICY_ORG env -> config [organization] org -> fail
#       (GH_ORG is not read). policy_default_provider is a
#       declared knob (see policy_define below); policy_org is implemented
#       directly because its chain predates the policy core and has two env
#       steps.
#
# Requires policy_core_init to have been called for policy_default_provider;
# policy_org is self-contained (reads POLICY_CONFIG_FILE through config_get).

# Self-source the core (guarded no-op when already loaded).
# shellcheck disable=SC1090,SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/policy-core.bash"


# The default is what is assumed when [provider] name is absent, so it cannot be read
# from that key (the configured name would answer for itself, typos included): it is
# POLICY_DEFAULT_PROVIDER or the built-in.
policy_define "default_provider" "DEFAULT_PROVIDER" "" "" "github"

# Resolve the org identity: POLICY_ORG -> config [organization] org ->
# fail (empty output, rc 1). Callers decide whether empty is
# acceptable; repo safety logic treats unresolvable as foreign.
policy_org() {
    if [ -n "${POLICY_ORG:-}" ]; then
        echo "$POLICY_ORG"
        return 0
    fi
    # Org resolution below the policy override delegates to the provider
    # identity accessor (config → seed → failure) when the provider layer is
    # loaded; the policy layer cannot source provider-core itself
    # (provider-core sources this module for detection — circular).
    if declare -F provider_org_get >/dev/null; then
        provider_org_get
        return $?
    fi
    local value
    value=$(config_get "$POLICY_CONFIG_FILE" "organization" "org" "")
    if [ -n "$value" ]; then
        echo "$value"
        return 0
    fi
    return 1
}
