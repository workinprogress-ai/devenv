#!/bin/bash
# wip-gate.sh - shared WIP-commit gate, sourced/executed by git pre-commit hooks.
#
# Enforces the WIP-commit rule: only a WIP commit may follow a WIP commit.
# A normal commit on top of a WIP commit (or with a WIP commit buried in the
# unpushed history) is blocked until `git-unwip` restages the work.
#
# Resolution order for the calling repo: irrelevant to this script — it always
# inspects the repo of the current working directory (git finds it the same
# way the hook does).
#
# Exit codes:
#   0  commit may proceed (no WIP on top / no buried WIP)
#   1  commit must be blocked (WIP found)

set -uo pipefail

# Check if HEAD is a WIP commit (covers the case where WIP has been pushed and
# the local branch is in sync with the remote WIP tip)
head_msg=$(git log -1 --format=%s 2>/dev/null)
if [[ "$head_msg" == WIP:* ]]; then
    echo "error: Cannot commit on top of a WIP commit."
    echo "       WIP commits are temporary escape-hatch saves — un-wip before real commits."
    echo "       Run 'git-unwip' first, then re-stage your changes."
    exit 1
fi

# Also check unpushed history (covers WIP buried among unpushed commits)
if git rev-parse '@{u}' >/dev/null 2>&1; then
    if git log '@{u}..HEAD' --format=%s 2>/dev/null | grep -q "^WIP:"; then
        echo "error: WIP commit(s) found in unpushed branch history."
        echo "       Only WIP commits may follow WIP commits."
        echo "       Run 'git-unwip' first, then re-stage your changes."
        exit 1
    fi
fi

exit 0
