#!/usr/bin/env bash
# fork-sync.sh (azure provider) - On-demand sync against the configured
# upstream remote (see docs/Forking.md).
#
set -euo pipefail
# shellcheck source=../../self-root.bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/lib/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-sync.sh — report or rebase against the configured upstream

Fetches `upstream` and reports ahead/behind counts and commits by default;
it does not rebase or push unless explicitly requested. `--rebase` rebases
the current branch onto `upstream/<branch>` without merge commits. On a
conflict, it prints `git rebase --abort` guidance and exits without pushing.
`--push-to-origin` uses a normal fast-forward push. If `origin` has commits
missing locally, it refuses unless paired with `--rewrite-origin`; that
explicit path uses `--force-with-lease`. `--yes` confirms without a prompt;
otherwise a TTY gets a `y/N` prompt and non-TTY use fails closed.
`--dry-run` reports the planned operations.

USAGE
    bash tools/lib/providers/azure/fork-sync.sh [--dry-run] [--rebase] [--push-to-origin [--rewrite-origin]] [--yes]
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

normalize_git_url() {
    local url="$1" authority path
    case "$url" in
        git@*:*)
            url="${url#git@}"
            url="${url/:/\/}"
            ;;
        ssh://*|https://*|http://*)
            url="${url#*://}"
            authority="${url%%/*}"
            path="${url#*/}"
            authority="${authority##*@}"
            url="$authority/$path"
            ;;
        file://*) url="${url#file://}" ;;
    esac
    url="${url%/}"
    url="${url%.git}"
    printf '%s\n' "$url"
}

DRY_RUN=0
REBASE=0
PUSH=0
REWRITE_ORIGIN=0
YES=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --rebase) REBASE=1 ;;
        --push-to-origin) PUSH=1 ;;
        --rewrite-origin) REWRITE_ORIGIN=1 ;;
        --yes) YES=1 ;;
        *) die "unknown option: $1" "$EXIT_MISUSE" ;;
    esac
    shift
done

[ "$YES" -eq 0 ] || [ "$PUSH" -eq 1 ] || die "--yes requires --push-to-origin" "$EXIT_MISUSE"
[ "$REWRITE_ORIGIN" -eq 0 ] || [ "$PUSH" -eq 1 ] || die "--rewrite-origin requires --push-to-origin" "$EXIT_MISUSE"
if [ "$PUSH" -eq 1 ] && [ "$YES" -eq 0 ] && [ ! -t 0 ]; then
    die "non-TTY --push-to-origin requires --yes" "$EXIT_MISUSE"
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run fork-sync.sh from inside a git repository" "$EXIT_GENERAL_ERROR"
UPSTREAM_URL="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
[ -n "$UPSTREAM_URL" ] || die "upstream remote is missing; run fork-setup.sh first" "$EXIT_GENERAL_ERROR"
[ "$UPSTREAM_URL" = "$FORK_UPSTREAM_REPO" ] || die "upstream remote URL does not match [fork] upstream_repo" "$EXIT_GENERAL_ERROR"

UPSTREAM_REF="refs/remotes/upstream/$FORK_UPSTREAM_BRANCH"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "dry run: would fetch upstream and compare HEAD with upstream/$FORK_UPSTREAM_BRANCH"
    if [ "$REBASE" -eq 1 ]; then
        echo "dry run: would rebase the current branch onto upstream/$FORK_UPSTREAM_BRANCH"
    fi
    if [ "$REWRITE_ORIGIN" -eq 1 ]; then
        echo "dry run: would allow an explicit origin history rewrite if required"
    fi
    exit 0
fi

git -C "$REPO_ROOT" fetch upstream || die "failed to fetch upstream" "$EXIT_GENERAL_ERROR"
git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF" || die "upstream branch '$FORK_UPSTREAM_BRANCH' was not fetched" "$EXIT_GENERAL_ERROR"

if [ "$PUSH" -eq 1 ] && [ "$REBASE" -eq 0 ]; then
    PUSH_COUNTS="$(git -C "$REPO_ROOT" rev-list --left-right --count "$UPSTREAM_REF...HEAD")" || die "failed to compare HEAD with upstream/$FORK_UPSTREAM_BRANCH" "$EXIT_GENERAL_ERROR"
    read -r PUSH_BEHIND _ <<< "$PUSH_COUNTS"
    [ "$PUSH_BEHIND" -eq 0 ] || die "branch is behind upstream; pass --rebase before --push-to-origin" "$EXIT_MISUSE"
fi

CURRENT_BRANCH="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'HEAD')"
if [ "$REBASE" -eq 1 ]; then
    [ "$CURRENT_BRANCH" != "HEAD" ] || die "cannot rebase while HEAD is detached" "$EXIT_GENERAL_ERROR"
    if ! git -C "$REPO_ROOT" rebase "$UPSTREAM_REF"; then
        if git -C "$REPO_ROOT" rev-parse --verify --quiet REBASE_HEAD >/dev/null; then
            echo "Rebase conflict. Resolve the conflicts or return to the pre-rebase state with:" >&2
            printf '  git -C %q rebase --abort\n' "$REPO_ROOT" >&2
            exit "$EXIT_GENERAL_ERROR"
        fi
        die "rebase onto upstream/$FORK_UPSTREAM_BRANCH failed" "$EXIT_GENERAL_ERROR"
    fi
    echo "Rebased $CURRENT_BRANCH onto upstream/$FORK_UPSTREAM_BRANCH"
fi

COUNTS="$(git -C "$REPO_ROOT" rev-list --left-right --count "$UPSTREAM_REF...HEAD")" || die "failed to compare HEAD with upstream/$FORK_UPSTREAM_BRANCH" "$EXIT_GENERAL_ERROR"
read -r BEHIND AHEAD <<< "$COUNTS"

echo "Upstream: upstream/$FORK_UPSTREAM_BRANCH"
echo "Current: $CURRENT_BRANCH"
echo "Behind: $BEHIND"
echo "Ahead: $AHEAD"
if [ "$BEHIND" -eq 0 ] && [ "$AHEAD" -eq 0 ]; then
    echo "No divergent commits."
else
    echo "Divergent commits (< upstream-only, > local-only):"
    git -C "$REPO_ROOT" --no-pager log --oneline --left-right --no-color "$UPSTREAM_REF...HEAD" || die "failed to list divergent commits" "$EXIT_GENERAL_ERROR"
fi

if [ "$PUSH" -eq 1 ]; then
    [ "$CURRENT_BRANCH" != "HEAD" ] || die "cannot push while HEAD is detached" "$EXIT_GENERAL_ERROR"
    ORIGIN_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
    [ -n "$ORIGIN_URL" ] || die "origin remote is missing" "$EXIT_GENERAL_ERROR"
    UPSTREAM_DESTINATION="$(normalize_git_url "$FORK_UPSTREAM_REPO")"
    while IFS= read -r origin_push_url; do
        [ -n "$origin_push_url" ] || continue
        if [ "$(normalize_git_url "$origin_push_url")" = "$UPSTREAM_DESTINATION" ]; then
            die "origin push destination matches configured upstream; refusing to push" "$EXIT_MISUSE"
        fi
    done < <(git -C "$REPO_ROOT" remote get-url --push --all origin)
    git -C "$REPO_ROOT" fetch --prune origin || die "failed to fetch origin" "$EXIT_GENERAL_ERROR"

    ORIGIN_REF="refs/remotes/origin/$CURRENT_BRANCH"
    git -C "$REPO_ROOT" show-ref --verify --quiet "$ORIGIN_REF" || die "origin branch '$CURRENT_BRANCH' was not fetched; cannot establish a push lease" "$EXIT_GENERAL_ERROR"
    ORIGIN_EXPECTED_SHA="$(git -C "$REPO_ROOT" rev-parse "$ORIGIN_REF")" || die "failed to resolve origin/$CURRENT_BRANCH" "$EXIT_GENERAL_ERROR"
    ORIGIN_COUNTS="$(git -C "$REPO_ROOT" rev-list --left-right --count "$ORIGIN_EXPECTED_SHA...HEAD")" || die "failed to compare HEAD with origin/$CURRENT_BRANCH" "$EXIT_GENERAL_ERROR"
    read -r ORIGIN_AHEAD LOCAL_AHEAD <<< "$ORIGIN_COUNTS"

    echo "Origin: origin/$CURRENT_BRANCH"
    echo "Origin ahead: $ORIGIN_AHEAD"
    echo "Local ahead of origin: $LOCAL_AHEAD"
    if [ "$ORIGIN_AHEAD" -gt 0 ]; then
        echo "Origin-only commits (< origin-only, > local-only):"
        git -C "$REPO_ROOT" --no-pager log --oneline --left-right --no-color "$ORIGIN_EXPECTED_SHA...HEAD" || die "failed to list origin divergence" "$EXIT_GENERAL_ERROR"
        [ "$REWRITE_ORIGIN" -eq 1 ] || die "origin contains commits absent locally; use --rewrite-origin with --push-to-origin to replace them" "$EXIT_MISUSE"
        echo "WARNING: --rewrite-origin will replace origin-only commits on origin/$CURRENT_BRANCH."
    fi

    if [ "$LOCAL_AHEAD" -eq 0 ]; then
        echo "No push needed; origin already contains the current branch."
        exit 0
    fi

    if [ "$YES" -eq 0 ]; then
        PUSH_CONFIRM=""
        if [ "$ORIGIN_AHEAD" -gt 0 ]; then
            read -r -p "Replace origin-only commits on origin/$CURRENT_BRANCH? [y/N] " PUSH_CONFIRM < /dev/tty
        else
            read -r -p "Proceed with push? [y/N] " PUSH_CONFIRM < /dev/tty
        fi
        case "$PUSH_CONFIRM" in
            [Yy]*) ;;
            *) echo "Push cancelled."; exit 0 ;;
        esac
    fi

    if [ "$ORIGIN_AHEAD" -gt 0 ]; then
        git -C "$REPO_ROOT" push "--force-with-lease=refs/heads/$CURRENT_BRANCH:$ORIGIN_EXPECTED_SHA" origin "HEAD:refs/heads/$CURRENT_BRANCH" || die "lease-protected rewrite of origin/$CURRENT_BRANCH failed" "$EXIT_GENERAL_ERROR"
        echo "Rewrote origin/$CURRENT_BRANCH with --force-with-lease"
    else
        git -C "$REPO_ROOT" push origin "HEAD:refs/heads/$CURRENT_BRANCH" || die "fast-forward push to origin/$CURRENT_BRANCH failed" "$EXIT_GENERAL_ERROR"
        echo "Pushed current branch to origin/$CURRENT_BRANCH"
    fi
fi
