#!/usr/bin/env bash
# fork-setup.sh (azure provider) - One-time setup for this repo's upstream
# relationship (see docs/Forking.md).
#
set -euo pipefail
# shellcheck source=../../self-root.bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/lib/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-setup.sh — one-time setup of this repo's upstream relationship

Idempotently adds a fetch-only `upstream` git remote and confirms the
`upstream_repo` and `upstream_branch` values from the `[fork]` section in
`devenv.config`. `--dry-run` reports the change without adding the remote.
See docs/Forking.md.

USAGE
  bash tools/lib/providers/azure/fork-setup.sh [--dry-run]
HELP
    exit 0
fi

devenv_ensure_root "${BASH_SOURCE[0]}"
source "$DEVENV_TOOLS/lib/config-reader.bash"
config_init "$DEVENV_ROOT/devenv.config" || die "could not read $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"
FORK_UPSTREAM_REPO="$(config_read_value fork upstream_repo "")"
FORK_UPSTREAM_BRANCH="$(config_read_value fork upstream_branch "")"
[ -n "$FORK_UPSTREAM_REPO" ] || die "missing required [fork] upstream_repo in $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"
[ -n "$FORK_UPSTREAM_BRANCH" ] || die "missing required [fork] upstream_branch in $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"

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
if [ -n "$EXISTING_UPSTREAM" ] && [ "$EXISTING_UPSTREAM" != "$FORK_UPSTREAM_REPO" ]; then
    die "upstream remote already points to a different URL: $EXISTING_UPSTREAM" "$EXIT_GENERAL_ERROR"
fi

PUSH_URL=""
if [ -n "$EXISTING_UPSTREAM" ]; then
    PUSH_URL="$(git -C "$REPO_ROOT" remote get-url --push --all upstream 2>/dev/null || true)"
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
