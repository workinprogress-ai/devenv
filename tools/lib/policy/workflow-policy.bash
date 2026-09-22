#!/bin/bash
# workflow-policy.bash - Workflow-domain policy knobs (Plan-issue-39-001).
#
# Knobs:
#   policy_delivery_segment_anchor POLICY_DELIVERY_SEGMENT_ANCHOR
#       The status token anchoring the delivery segment of the configured
#       status_workflow. Falls back to the workflow config's own values in
#       workflow-core; this knob exists for forks that rename tokens and
#       need rollup anchored to a stable name.
#   policy_status_fallback POLICY_STATUS_FALLBACK
#       Status assumed for children with unreadable status during rollup.
#
# Requires policy_core_init to have been called.


# Self-source the core (guarded no-op when already loaded).
# shellcheck disable=SC1090,SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/policy-core.bash"

policy_define "delivery_segment_anchor" "DELIVERY_SEGMENT_ANCHOR" "workflows" "delivery_segment_anchor" "Implementing"
policy_define "status_fallback" "STATUS_FALLBACK" "workflows" "status_fallback" "Ready"
