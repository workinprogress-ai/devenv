#!/bin/bash
# check-update-devenv-repo.sh - Checks for updates and, if found, interacts with the user to perform an update.
#
# After pulling, the required post-update action comes from the "Devenv-Action"
# trailers on the new commits; see post-update.bash, shared with devenv-update.

# ── Setup ──────────────────────────────────────────────────────────────────
script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
cd "$script_folder" || exit 1
devenv=$(dirname "$script_folder")

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_HASH=$(git rev-parse "$CURRENT_BRANCH")
REMOTE_HASH=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null)
BASE_HASH=$(git merge-base "$CURRENT_BRANCH" "origin/$CURRENT_BRANCH" 2>/dev/null)

# Up to date — nothing to do.
if [ "$LOCAL_HASH" == "$REMOTE_HASH" ]; then
    exit 0
fi

# Local is ahead of the remote: nothing to pull, nothing to say.
if [ "$REMOTE_HASH" == "$BASE_HASH" ]; then
    exit 0
fi

# Both sides moved. Say so only when the remote's history was rewritten (a
# force-pushed fork master): an earlier tip of the remote-tracking branch (from its
# reflog) is still reachable from the local branch but no longer from the remote.
# Local commits that were never on the remote (ordinary divergence) have no such tip
# and stay silent: that is normal for a fork, and the check runs from every new shell.
# Objects missing from a shallow clone make the reachability test fail, which reads as
# "not rewritten".
if [ "$LOCAL_HASH" != "$BASE_HASH" ]; then
    REWRITTEN=0
    while IFS= read -r PAST_REMOTE_HASH; do
        [ -n "$PAST_REMOTE_HASH" ] && [ "$PAST_REMOTE_HASH" != "$REMOTE_HASH" ] || continue
        if git merge-base --is-ancestor "$PAST_REMOTE_HASH" "$LOCAL_HASH" 2>/dev/null \
            && ! git merge-base --is-ancestor "$PAST_REMOTE_HASH" "$REMOTE_HASH" 2>/dev/null \
            && git cat-file -e "${PAST_REMOTE_HASH}^{commit}" 2>/dev/null; then
            REWRITTEN=1
            break
        fi
    done < <(git reflog show --format=%H "origin/${CURRENT_BRANCH}" 2>/dev/null | head -n 50)
    if [ "$REWRITTEN" -eq 1 ]; then
        echo "The remote history of ${CURRENT_BRANCH} was rewritten: your branch and origin/${CURRENT_BRANCH} have diverged."
        echo "If you have no local commits to keep, reset to the remote: git fetch origin && git reset --hard origin/${CURRENT_BRANCH}"
        echo "If you do, move them onto the new history: git rebase origin/${CURRENT_BRANCH}  (see docs/Forking.md)."
    fi
    exit 0
fi

# ── Non-master branch ──────────────────────────────────────────────────────
if [ "$CURRENT_BRANCH" != "master" ]; then
    echo "WARNING: The current branch ${CURRENT_BRANCH} is different on the remote."
    echo "You must manually update this branch (e.g., by running 'git pull') to get the latest changes."
    exit 0;
fi

# ── Master branch ──────────────────────────────────────────────────────────
# Uncommitted changes: refuse only now that an update is actually on offer, so a
# dirty tree does not nag on every start while the repo is up to date.
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Changes are available on the remote master branch, but there are uncommitted changes in the devenv repo."
    echo "Please commit or stash them before updating."
    exit 1
fi

echo "Changes detected on the remote master branch for the development environment."
read -rp "Do you want to update? (y/n): " answer
case $answer in
    [Yy]* ) ;;
    * )
        exit 1;;
esac

# Capture HEAD before pulling so we can scan only the new commits.
PRE_UPDATE_HASH=$(git rev-parse HEAD)

if ! "$devenv/tools/git-update"; then
    echo "Error updating the repository. Please update manually (e.g., run 'git pull')."
    echo "You may also need to rebuild the dev container or re-run the bootstrap."
    exit 1
fi

# Carry out the action the new commits call for.
# shellcheck source=./post-update.bash
source "$script_folder/post-update.bash"
devenv_post_update "$PRE_UPDATE_HASH" || exit 1

exit 0
