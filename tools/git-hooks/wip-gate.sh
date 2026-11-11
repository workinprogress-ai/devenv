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
#   1  commit must be blocked (WIP found, or the history could not be read)

set -uo pipefail

# A repository with no commit yet has no history to inspect: the first commit
# may always proceed. Any other failure to read history blocks (fail closed).
if ! git rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
    exit 0
fi

blocked_unreadable() {
    echo "error: could not read the commit history (git log failed) — blocking the commit."
    echo "       Fix the repository state, then retry."
    exit 1
}

# Check if HEAD is a WIP commit (covers the case where WIP has been pushed and
# the local branch is in sync with the remote WIP tip)
head_msg=$(git log -1 --format=%s 2>/dev/null) || blocked_unreadable
if [[ "$head_msg" == WIP:* ]]; then
    echo "error: Cannot commit on top of a WIP commit."
    echo "       WIP commits are temporary escape-hatch saves — un-wip before real commits."
    echo "       Run 'git-unwip' first, then re-stage your changes."
    exit 1
fi

# Also check unpushed history (covers WIP buried among unpushed commits).
# With an upstream the range is @{u}..HEAD; without one (a never-pushed
# branch) it is every commit not reachable from any remote ref. The log output
# is captured before it is tested: piping into `grep -q` lets grep exit early,
# SIGPIPE git log, and (under pipefail) turn a found WIP into a passing gate.
if git rev-parse '@{u}' >/dev/null 2>&1; then
    unpushed_subjects=$(git log '@{u}..HEAD' --format=%s 2>/dev/null) || blocked_unreadable
else
    unpushed_subjects=$(git log HEAD --not --remotes --format=%s 2>/dev/null) || blocked_unreadable
fi
if grep -q "^WIP:" <<<"$unpushed_subjects"; then
    echo "error: WIP commit(s) found in unpushed branch history."
    echo "       Only WIP commits may follow WIP commits."
    echo "       Run 'git-unwip' first, then re-stage your changes."
    exit 1
fi

exit 0
