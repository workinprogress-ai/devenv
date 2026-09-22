#!/bin/bash
# policy-core.bash - Resolution engine for org policy decisions.
#
# The policy layer separates WHAT a fork may decide (data, in config) from
# HOW the tooling decides it (this layer). Every accessor follows one
# resolution chain:
#
#   1. POLICY_<NAME> environment override (explicit, session-scoped)
#   2. Config value via the domain module's declared config key
#   3. Built-in fallback (the current org's value, documented per accessor)
#
# Domain modules (issue-policy.bash, workflow-policy.bash, identity-policy.bash)
# declare their knobs via policy_define and expose named accessor functions.
# See tools/lib/policy/README.md for the full knob catalog (fork contract).
#
# Usage:
#   source ".../lib/policy/policy-core.bash"
#   policy_core_init "$DEVENV_ROOT/devenv.config"
#   source ".../lib/policy/issue-policy.bash"
#   policy_issue_types   # -> "Bug Feature Task Epic"


# Guard against multiple sourcing: policy_define appends to POLICY_KNOBS, so
# a re-source would register duplicate knobs.
if [ -n "${_POLICY_CORE_LOADED:-}" ]; then
    return 0
fi
_POLICY_CORE_LOADED=1

# Path of the config file policy values resolve against. Set by
# policy_core_init; domain accessors require it to have been called.
POLICY_CONFIG_FILE=""

# Registry of defined policy knobs: NAME|env_suffix|section|key|fallback
POLICY_KNOBS=()

# Initialize the policy core against a config file.
# Usage: policy_core_init [CONFIG_PATH]  (default: ${DEVENV_ROOT}/devenv.config)
policy_core_init() {
    # Default config path: env root, else the devenv root this lib lives in
    # (script-relative — no caller-path coupling).
    local config_file="${1:-${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/devenv.config}"
    POLICY_CONFIG_FILE="$config_file"

    # config-reader provides the INI reading primitives (config_init /
    # config_read_value); source it lazily against our config file.
    local lib_dir
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    # shellcheck disable=SC1090,SC1091
    source "$lib_dir/config-reader.bash"
    config_init "$config_file"
}

# Declare a policy knob.
# Usage: policy_define <accessor_name> <ENV_SUFFIX> <config_section> <config_key> <fallback>
# The accessor name becomes policy_<accessor_name>; resolution order is
# POLICY_<ENV_SUFFIX> env -> config section/key -> fallback.
policy_define() {
    local accessor="$1" env_suffix="$2" section="$3" key="$4" fallback="$5"
    # Idempotent: a re-declared knob (module re-sourced, or two modules
    # declaring the same name) replaces rather than duplicates.
    local entry i existing_accessor
    for i in "${!POLICY_KNOBS[@]}"; do
        existing_accessor="${POLICY_KNOBS[$i]%%|*}"
        if [ "$existing_accessor" = "$accessor" ]; then
            POLICY_KNOBS[$i]="$accessor|$env_suffix|$section|$key|$fallback"
            return 0
        fi
    done
    POLICY_KNOBS+=("$accessor|$env_suffix|$section|$key|$fallback")
    eval "
policy_$accessor() {
    policy_resolve '$env_suffix' '$section' '$key' '$fallback'
}
"
}

# Core resolution: POLICY_<SUFFIX> env -> config -> fallback.
# Usage: policy_resolve <ENV_SUFFIX> <section> <key> <fallback>
# A missing config file is a normal state (fresh bootstrap, tests): the
# fallback applies. Empty config values also fall through to the fallback —
# an empty policy value is never meaningful.
policy_resolve() {
    local env_suffix="$1" section="$2" key="$3" fallback="$4"
    local env_var="POLICY_${env_suffix}"
    local override="${!env_var:-}"
    if [ -n "$override" ]; then
        echo "$override"
        return 0
    fi
    local value
    if [ -n "$POLICY_CONFIG_FILE" ] && [ -f "$POLICY_CONFIG_FILE" ]; then
        value=$(config_read_value "$section" "$key" "")
    fi
    echo "${value:-$fallback}"
}

# List every registered knob: "<accessor> <env> <section.key> <fallback>"
# Introspection for docs generation and debugging.
policy_knobs() {
    local entry accessor env_suffix section key fallback
    for entry in "${POLICY_KNOBS[@]}"; do
        IFS='|' read -r accessor env_suffix section key fallback <<< "$entry"
        echo "policy_$accessor POLICY_$env_suffix $section.$key $fallback"
    done
}
