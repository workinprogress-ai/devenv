#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# fork-setup.sh - One-time setup for this repo's upstream
# relationship (see docs/Forking.md).
#
set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/fork.bash"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-setup.sh — one-time setup of this repo's upstream relationship

Idempotently adds a fetch-only `upstream` git remote and confirms the
`upstream_repo` and `upstream_branch` values from the `[fork]` section in
`devenv.config`. `--dry-run` reports the change without adding the remote.
See docs/Forking.md.

USAGE
  fork-setup [--dry-run]
HELP
    exit 0
fi

devenv_ensure_root "${BASH_SOURCE[0]}"
fork_load_config

DRY_RUN=0
while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      *) die "unknown option: $1" "$EXIT_MISUSE" ;;
    esac
    shift
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run fork-setup.sh from inside a git repository" "$EXIT_GENERAL_ERROR"
EXISTING_UPSTREAM="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
if [ -n "$EXISTING_UPSTREAM" ] && ! fork_upstream_matches "$REPO_ROOT"; then
    die "upstream remote already points to a different URL: $EXISTING_UPSTREAM" "$EXIT_GENERAL_ERROR"
fi

PUSH_URL=""
if [ -n "$EXISTING_UPSTREAM" ]; then
    PUSH_URL="$(git -C "$REPO_ROOT" remote get-url --push upstream 2>/dev/null || true)"
fi

if [ "$DRY_RUN" -eq 1 ]; then
    if [ -z "$EXISTING_UPSTREAM" ]; then
        echo "dry run: would add fetch-only upstream remote: $FORK_UPSTREAM_REPO"
    elif [ "$PUSH_URL" = "/dev/null" ]; then
        echo "upstream remote already configured: $FORK_UPSTREAM_REPO"
    fi
    if [ "$PUSH_URL" != "/dev/null" ]; then
        echo "dry run: would set upstream push URL to /dev/null"
    fi
    echo "upstream branch: $FORK_UPSTREAM_BRANCH"
    exit 0
fi

if [ -z "$EXISTING_UPSTREAM" ]; then
    git -C "$REPO_ROOT" remote add upstream "$FORK_UPSTREAM_REPO" || die "failed to add upstream remote" "$EXIT_GENERAL_ERROR"
fi

if [ "$PUSH_URL" != "/dev/null" ]; then
    # Git treats an explicit push URL as authoritative; /dev/null makes pushes fail.
    git -C "$REPO_ROOT" config --local --replace-all remote.upstream.pushurl /dev/null || die "failed to make upstream fetch-only" "$EXIT_GENERAL_ERROR"
fi

if [ -z "$EXISTING_UPSTREAM" ]; then
    echo "added fetch-only upstream remote: $FORK_UPSTREAM_REPO"
else
    echo "upstream remote already configured: $FORK_UPSTREAM_REPO"
fi
echo "upstream branch: $FORK_UPSTREAM_BRANCH"
