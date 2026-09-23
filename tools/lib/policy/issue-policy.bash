#!/bin/bash
# issue-policy.bash - Issue-domain policy knobs (Plan-issue-39-001).
#
# Knobs:
#   policy_issue_types   POLICY_ISSUE_TYPES   [space-separated canonical types]
#   policy_issue_aliases POLICY_ISSUE_ALIASES [space-separated alias=Target pairs; empty by default]
#   policy_triage_labels POLICY_TRIAGE_LABELS [space-separated triage vocabulary]
#
# Requires policy_core_init to have been called.


# Self-source the core (guarded no-op when already loaded).
# shellcheck disable=SC1090,SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/policy-core.bash"

policy_define "issue_types" "ISSUE_TYPES" "issues" "types" "Bug Feature Task Epic"
policy_define "issue_aliases" "ISSUE_ALIASES" "issues" "aliases" ""
policy_define "triage_labels" "TRIAGE_LABELS" "issues" "triage_labels" "needs-triage needs-grooming status:ready future-idea"

# Look up a single triage label by key. Keys map onto the vocabulary:
#   needs-triage, needs-grooming, status:ready, future-idea
# Returns the label literal (default vocabulary value when config is absent),
# failing (rc 1) for unknown keys. Falls back to the built-in vocabulary when
# the triage_labels knob itself is not configured.
policy_triage_label() {
    local key="$1"
    local vocabulary
    vocabulary="$(policy_triage_labels)"
    local candidate
    for candidate in $vocabulary; do
        case "$candidate" in
            "$key") echo "$candidate"; return 0 ;;
        esac
    done
    # Colon-keyed lookups ("status:ready") match the label itself.
    case " $vocabulary " in
        *" $key "*) echo "$key"; return 0 ;;
    esac
    return 1
}
