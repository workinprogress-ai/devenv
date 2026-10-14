#!/usr/bin/env bash
# fork-twin.bash - Twin classification for fork-sync: decides whether a local
# commit is already on upstream (twin), carries an adaptation (twin with
# residue), or is genuinely fork-only. Also hosts the adoption map — recorded
# local<->upstream SHA pairs for twins that predate Change-Ids.
#
# Classification precedence (first match wins):
#   1. recorded adoption link (local SHA <-> upstream SHA pair)
#   2. Change-Id trailer match
#   3. patch-id equivalence
#   4. subject + reachability heuristics (weakest signal; reported, never
#      auto-dropped by the replay)
#
# See docs/Forking.md.

# Guard against multiple sourcing
if [ -n "${_FORK_TWIN_LIB_LOADED:-}" ]; then
    return 0
fi
_FORK_TWIN_LIB_LOADED=1

if [ -z "${_CHANGE_ID_LIB_LOADED:-}" ] && [ -n "${DEVENV_TOOLS:-}" ] && [ -f "${DEVENV_TOOLS}/lib/change-id.bash" ]; then
    source "${DEVENV_TOOLS}/lib/change-id.bash"
fi

readonly TWIN_VERDICT_FORK_ONLY="fork-only"
readonly TWIN_VERDICT_TWIN="twin"
readonly TWIN_VERDICT_TWIN_RESIDUE="twin-residue"
# Weakest-signal verdict: looks like a twin but the evidence is subject-level
# only. The replay replays it (a wrong drop loses work); the dry-run names it.
readonly TWIN_VERDICT_SUSPECT="suspect-twin"

# ---------------------------------------------------------------------------
# Twin classification
# ---------------------------------------------------------------------------

# Print the stable patch-id of a commit (nothing when it cannot be computed).
#
# Usage: fork_twin_patch_id REPO COMMIT
fork_twin_patch_id() {
    local repo="$1" commit="$2"
    git -C "$repo" show "$commit" 2>/dev/null | git patch-id --stable 2>/dev/null | awk '{print $1}'
}

# Print the upstream twin SHA for a local commit, matched by Change-Id, using
# an ID index of the form "<id> <sha>" lines. Nothing when no twin exists.
#
# Usage: fork_twin_find_by_change_id LOCAL_SHA ID_INDEX
fork_twin_find_by_change_id() {
    local local_sha="$1" index="$2" id line index_id index_sha
    id="$(change_id_get_from_commit "${FORK_TWIN_LOCAL_REPO:?}" "$local_sha" 2>/dev/null || true)"
    [ -n "$id" ] || return 1
    while read -r index_id index_sha; do
        [ -n "$index_id" ] || continue
        if [ "$index_id" = "$id" ]; then
            printf '%s\n' "$index_sha"
            return 0
        fi
    done < "$index"
    return 1
}

# Whether the two commits' trees differ only inside files that the target
# side's later commits also touched — i.e. the difference plausibly came from
# upstream evolving the same lines rather than from a target-side adaptation.
# A cheap approximation used only to label residue, never to drop a commit.
#
# Usage: fork_twin_residue_paths REPO_A SHA_A REPO_B SHA_B
fork_twin_residue_paths() {
    local repo_a="$1" sha_a="$2" repo_b="$3" sha_b="$4"
    local names_a names_b
    names_a="$(git -C "$repo_a" show --name-only --format= "$sha_a" 2>/dev/null | sort)"
    names_b="$(git -C "$repo_b" show --name-only --format= "$sha_b" 2>/dev/null | sort)"
    comm -12 <(printf '%s\n' "$names_a") <(printf '%s\n' "$names_b")
}

# Classify one local commit against the upstream side. Prints one line:
#   <verdict> <local-sha> [upstream-sha] [signal]
# Verdicts: fork-only | twin | twin-residue | suspect-twin
#   twin          = dropped by the replay (Change-Id match, no patch drift)
#   twin-residue  = twin with a patch difference; residue shown, never
#                   silently replayed or dropped
#   suspect-twin  = subject+reachability match only; replayed, named in output
#   fork-only     = replayed
# Empty upstream side (nothing to match against) is always fork-only.
#
# Environment: FORK_TWIN_LOCAL_REPO, FORK_TWIN_UPSTREAM_REPO (repos holding
# the objects).
#
# Usage: fork_twin_classify_commit LOCAL_SHA UPSTREAM_TIP ADOPTION_MAP_PATH
fork_twin_classify_commit() {
    local local_sha="$1" upstream_tip="$2" map_path="${3:-}"
    local upstream_repo="${FORK_TWIN_UPSTREAM_REPO:?}"
    local upstream_sha=""

    # 1. Recorded adoption link (strongest: a human confirmed the pair).
    if [ -n "$map_path" ] && [ -f "$map_path" ]; then
        upstream_sha="$(fork_twin_map_lookup_local "$map_path" "$local_sha" 2>/dev/null || true)"
        if [ -n "$upstream_sha" ]; then
            if fork_twin_patches_identical "$local_sha" "$upstream_sha"; then
                printf '%s %s %s adoption-link\n' "$TWIN_VERDICT_TWIN" "$local_sha" "$upstream_sha"
            else
                printf '%s %s %s adoption-link\n' "$TWIN_VERDICT_TWIN_RESIDUE" "$local_sha" "$upstream_sha"
            fi
            return 0
        fi
    fi

    # 2. Change-Id match.
    upstream_sha="$(fork_twin_upstream_commit_by_change_id "$local_sha" "$upstream_tip" || true)"
    if [ -n "$upstream_sha" ]; then
        if fork_twin_patches_identical "$local_sha" "$upstream_sha"; then
            printf '%s %s %s change-id\n' "$TWIN_VERDICT_TWIN" "$local_sha" "$upstream_sha"
        else
            # A target copy declaring Fork-Adapted: yes owns the difference:
            # the match is authoritative (plain twin, dropped), the adaptation
            # is deliberate. Otherwise the drift is unexplained residue.
            local upstream_msg
            upstream_msg="$(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" log -1 --format=%B "$upstream_sha" 2>/dev/null || true)"
            if change_id_is_fork_adapted "$upstream_msg"; then
                printf '%s %s %s change-id-adapted\n' "$TWIN_VERDICT_TWIN" "$local_sha" "$upstream_sha"
            else
                printf '%s %s %s change-id\n' "$TWIN_VERDICT_TWIN_RESIDUE" "$local_sha" "$upstream_sha"
            fi
        fi
        return 0
    fi

    # 3. Patch-id equivalence (what stock rebase already drops).
    upstream_sha="$(fork_twin_upstream_commit_by_patch_id "$local_sha" "$upstream_tip" || true)"
    if [ -n "$upstream_sha" ]; then
        printf '%s %s %s patch-id\n' "$TWIN_VERDICT_TWIN" "$local_sha" "$upstream_sha"
        return 0
    fi

    # 4. Subject + reachability (weakest): upstream has a commit with the same
    # subject and the local commit is reachable from some other local ref —
    # the shape of one's own work coming back reworked. Never auto-dropped.
    upstream_sha="$(fork_twin_upstream_commit_by_subject "$local_sha" "$upstream_tip" || true)"
    if [ -n "$upstream_sha" ]; then
        printf '%s %s %s subject\n' "$TWIN_VERDICT_SUSPECT" "$local_sha" "$upstream_sha"
        return 0
    fi

    printf '%s %s\n' "$TWIN_VERDICT_FORK_ONLY" "$local_sha"
}

# Whether both repos' object stores agree the two commits' patches are
# identical. Uses patch-id over the union of both object stores so either
# repo can hold either commit.
#
# Usage: fork_twin_patches_identical LOCAL_SHA UPSTREAM_SHA
fork_twin_patches_identical() {
    local local_sha="$1" upstream_sha="$2" local_repo upstream_repo a b
    local_repo="${FORK_TWIN_LOCAL_REPO:?}"
    upstream_repo="${FORK_TWIN_UPSTREAM_REPO:?}"
    export GIT_ALTERNATE_OBJECT_DIRECTORIES
    GIT_ALTERNATE_OBJECT_DIRECTORIES="$(git -C "$upstream_repo" rev-parse --path-format=absolute --git-path objects)"
    a="$(git -C "$local_repo" show "$local_sha" 2>/dev/null | git patch-id --stable 2>/dev/null | awk 'NR==1{print $1}')"
    b="$(git -C "$local_repo" show "$upstream_sha" 2>/dev/null | git patch-id --stable 2>/dev/null | awk 'NR==1{print $1}')"
    unset GIT_ALTERNATE_OBJECT_DIRECTORIES
    [ -n "$a" ] && [ "$a" = "$b" ]
}

# Upstream commit carrying the same Change-Id as the local commit, if any.
#
# Usage: fork_twin_upstream_commit_by_change_id LOCAL_SHA UPSTREAM_TIP
fork_twin_upstream_commit_by_change_id() {
    local local_sha="$1" upstream_tip="$2" id
    id="$(change_id_get_from_commit "${FORK_TWIN_LOCAL_REPO:?}" "$local_sha" 2>/dev/null || true)"
    [ -n "$id" ] || return 1
    # Search the whole upstream history: the twin may sit anywhere upstream
    # imported it, not only below the caller's tip snapshot (stale tips are
    # the norm — upstream moves between a caller's fetch and classify). The
    # local commit itself is excluded — in fallback mode (upstream repo is
    # the fork clone) --all includes the fork's own refs.
    local candidate
    while read -r candidate; do
        [ -n "$candidate" ] || continue
        [ "$candidate" != "$local_sha" ] || continue
        printf '%s\n' "$candidate"
        return 0
    done < <(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" log --format=%H --grep="Change-Id: $id" -F --all 2>/dev/null)
    return 1
}

# Upstream commit patch-identical to the local commit, if any.
#
# Usage: fork_twin_upstream_commit_by_patch_id LOCAL_SHA UPSTREAM_TIP
fork_twin_upstream_commit_by_patch_id() {
    local local_sha="$1" upstream_tip="$2" target_id sha
    target_id="$(fork_twin_patch_id "${FORK_TWIN_LOCAL_REPO:?}" "$local_sha")"
    [ -n "$target_id" ] || return 1
    while read -r sha; do
        [ -n "$sha" ] || continue
        # Never self-match: in fallback mode (upstream repo == the fork clone)
        # rev-list --all includes the fork's own commits, HEAD included.
        [ "$sha" != "$local_sha" ] || continue
        if fork_twin_patches_identical "$local_sha" "$sha"; then
            printf '%s\n' "$sha"
            return 0
        fi
    done < <(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" rev-list --reverse --all 2>/dev/null)
    return 1
}

# Upstream commit with the same subject as the local commit, if any.
#
# Usage: fork_twin_upstream_commit_by_subject LOCAL_SHA UPSTREAM_TIP
fork_twin_upstream_commit_by_subject() {
    local local_sha="$1" upstream_tip="$2" subject
    subject="$(git -C "${FORK_TWIN_LOCAL_REPO:?}" log -1 --format=%s "$local_sha" 2>/dev/null || true)"
    [ -n "$subject" ] || return 1
    local sha sha_subject
    while read -r sha; do
        [ -n "$sha" ] || continue
        [ "$sha" != "$local_sha" ] || continue
        sha_subject="$(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" log -1 --format=%s "$sha" 2>/dev/null || true)"
        if [ "$sha_subject" = "$subject" ]; then
            printf '%s\n' "$sha"
            return 0
        fi
    done < <(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" log --format=%H --all 2>/dev/null)
    return 1
}

# Render the residue between a local commit and its upstream twin: the
# difference between the two patches, not the whole-commit diffs. Prints a
# unified diff of the two patch texts (empty output = no residue, which the
# classifier would have labeled plain twin). Cross-repo safe via alternates.
#
# Usage: fork_twin_residue_diff LOCAL_SHA UPSTREAM_SHA
fork_twin_residue_diff() {
    local local_sha="$1" upstream_sha="$2" local_repo upstream_repo a b
    local_repo="${FORK_TWIN_LOCAL_REPO:?}"
    upstream_repo="${FORK_TWIN_UPSTREAM_REPO:?}"
    export GIT_ALTERNATE_OBJECT_DIRECTORIES
    GIT_ALTERNATE_OBJECT_DIRECTORIES="$(git -C "$upstream_repo" rev-parse --path-format=absolute --git-path objects)"
    a="$(mktemp "${TMPDIR:-/tmp}/fork-twin-residue-a.XXXXXX")"
    b="$(mktemp "${TMPDIR:-/tmp}/fork-twin-residue-b.XXXXXX")"
    git -C "$local_repo" show --format= "$local_sha" > "$a" 2>/dev/null || { unset GIT_ALTERNATE_OBJECT_DIRECTORIES; rm -f "$a" "$b"; return 1; }
    git -C "$local_repo" show --format= "$upstream_sha" > "$b" 2>/dev/null || { unset GIT_ALTERNATE_OBJECT_DIRECTORIES; rm -f "$a" "$b"; return 1; }
    unset GIT_ALTERNATE_OBJECT_DIRECTORIES
    # diff exits 1 on differences — expected, not an error. Capture it in a
    # set -e-safe way: callers run with pipefail (fork-sync does), and a bare
    # failing diff would kill the pipeline before the caller reads anything.
    local status=0
    diff -u --label "local $local_sha" --label "upstream $upstream_sha" "$b" "$a" || status=$?
    rm -f "$a" "$b"
    # 0 = identical, 1 = differences (the residue: success here), 2 = error.
    [ "$status" -eq 2 ] && return 2
    return 0
}

# ---------------------------------------------------------------------------
# Adoption map — recorded local<->upstream SHA pairs for pre-Change-Id twins.
#
# Plain file under $GIT_DIR (sibling of the fork-export-skip list): the map
# must bridge two separate clones (fork working clone and the upstream clone),
# and git notes would need notes-ref fetch plumbing across that topology.
# Format: one pair per line, "<local-full-sha> <upstream-full-sha> # note".
# Locking follows the skip-list pattern so concurrent writers serialize.
# ---------------------------------------------------------------------------

readonly ADOPTION_MAP_FILE_NAME="fork-adoption-map"

# Path of the adoption map in the repo's git common directory (shared by
# worktrees, never in the working tree).
#
# Usage: fork_twin_map_get_path REPO
fork_twin_map_get_path() {
    local common
    common="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
    printf '%s/%s\n' "$common" "$ADOPTION_MAP_FILE_NAME"
}

# Run a command holding the map lock.
#
# Usage: _fork_twin_map_locked REPO COMMAND [ARG...]
_fork_twin_map_locked() {
    local path lock_fd status=0
    path="$(fork_twin_map_get_path "$1")" || return 1
    shift
    exec {lock_fd}> "$path.lock" || return 1
    flock "$lock_fd" || {
        exec {lock_fd}>&-
        return 1
    }
    "$@" || status=$?
    exec {lock_fd}>&-
    return "$status"
}

# Record a pair (idempotent). SHAs are resolved to full object IDs.
#
# Usage: fork_twin_map_add REPO LOCAL_SHA UPSTREAM_SHA [NOTE]
fork_twin_map_add() {
    _fork_twin_map_locked "$1" _fork_twin_map_add_unlocked "$@"
}

_fork_twin_map_add_unlocked() {
    local repo="$1" local_sha="$2" upstream_sha="$3" note="${4:-}" path full_local full_upstream
    full_local="$(git -C "$repo" rev-parse --verify --quiet "$local_sha^{commit}" 2>/dev/null)" || {
        echo "not a commit: $local_sha" >&2
        return 1
    }
    # The upstream-side SHA lives in the upstream repo's object store, not the
    # local one — validate there (both repos must be known to the caller).
    full_upstream="$(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" rev-parse --verify --quiet "$upstream_sha^{commit}" 2>/dev/null)" || {
        echo "not a commit in the upstream repo: $upstream_sha" >&2
        return 1
    }
    path="$(fork_twin_map_get_path "$repo")" || return 1
    if [ -f "$path" ] && awk -v l="$full_local" -v u="$full_upstream" '
        $1 == l && $2 == u { found = 1 } END { exit !found }' "$path"; then
        return 0
    fi
    note="${note//$'\n'/ }"
    if [ -n "$note" ]; then
        printf '%s %s # %s\n' "$full_local" "$full_upstream" "$note" >> "$path" || return 1
    else
        printf '%s %s\n' "$full_local" "$full_upstream" >> "$path" || return 1
    fi
}

# Look up the upstream twin of a local SHA. Prints the SHA; fails when absent.
#
# Usage: fork_twin_map_lookup_local MAP_PATH LOCAL_SHA
fork_twin_map_lookup_local() {
    local map_path="$1" local_sha="$2"
    local full
    full="$(git -C "${FORK_TWIN_LOCAL_REPO:?}" rev-parse --verify --quiet "$local_sha^{commit}" 2>/dev/null)" || return 1
    awk -v l="$full" '$1 == l { print $2; found = 1 } END { exit !found }' "$map_path"
}

# Look up the local twin of an upstream SHA (reverse direction). Prints the
# local SHA; fails when absent.
#
# Usage: fork_twin_map_lookup_upstream MAP_PATH UPSTREAM_SHA
fork_twin_map_lookup_upstream() {
    local map_path="$1" upstream_sha="$2"
    local full
    full="$(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" rev-parse --verify --quiet "$upstream_sha^{commit}" 2>/dev/null)" || return 1
    awk -v u="$full" '$2 == u { print $1; found = 1 } END { exit !found }' "$map_path"
}

# Remove every entry naming either SHA. Fails when nothing matched.
#
# Usage: fork_twin_map_remove REPO SHA
fork_twin_map_remove() {
    _fork_twin_map_locked "$1" _fork_twin_map_remove_unlocked "$@"
}

_fork_twin_map_remove_unlocked() {
    local repo="$1" sha="$2" path tmp full
    path="$(fork_twin_map_get_path "$repo")" || return 1
    [ -f "$path" ] || return 1
    full="$(git -C "$repo" rev-parse --verify --quiet "$sha^{commit}" 2>/dev/null || true)"
    tmp="$(mktemp "$path.XXXXXX")" || return 1
    awk -v s="$sha" -v f="$full" '
        /^[[:space:]]*(#|$)/ { print; next }
        $1 == s || $2 == s || (f != "" && ($1 == f || $2 == f)) { removed = 1; next }
        { print }
        END { exit removed ? 0 : 1 }
    ' "$path" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }
    mv "$tmp" "$path" || {
        rm -f "$tmp"
        return 1
    }
}

# Print entries, dropping stale ones: a pair whose either side no longer
# resolves to a commit in the respective repo. Pruned entries go to stderr.
# Runs under the map lock (mutates the file when pruning).
# Environment: FORK_TWIN_LOCAL_REPO, FORK_TWIN_UPSTREAM_REPO.
#
# Usage: fork_twin_map_list MAP_PATH
fork_twin_map_list() {
    local map_path="$1"
    local repo="${FORK_TWIN_LOCAL_REPO:?}"
    _fork_twin_map_locked "$repo" _fork_twin_map_list_unlocked "$map_path"
}

_fork_twin_map_list_unlocked() {
    local map_path="$1" line local_sha upstream_sha
    [ -f "$map_path" ] || return 0
    local tmp
    tmp="$(mktemp "$map_path.XXXXXX")" || return 1
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*(#|$) ]]; then
            printf '%s\n' "$line" >> "$tmp"
            continue
        fi
        read -r local_sha upstream_sha _ <<< "$line"
        if git -C "${FORK_TWIN_LOCAL_REPO:?}" cat-file -e "${local_sha}^{commit}" 2>/dev/null \
            && git -C "${FORK_TWIN_UPSTREAM_REPO:?}" cat-file -e "${upstream_sha}^{commit}" 2>/dev/null; then
            printf '%s\n' "$line" >> "$tmp"
        else
            printf 'pruned stale adoption entry: %s\n' "$line" >&2
        fi
    done < "$map_path"
    mv "$tmp" "$map_path"
    awk '!/^[[:space:]]*(#|$)/' "$map_path"
}

# Propose adoption candidates: local commits (no Change-Id) paired with
# upstream commits by subject, then author date proximity, then file-set
# overlap. Prints ranked candidates as:
#   <score> <local-sha> <upstream-sha> <subject>
# A score of 3 = subject + same author date + identical file set.
#
# UPSTREAM_RANGE must span the upstream commits to match against — typically
# <base>..<upstream-tip> where tip includes the imported copies. A bare base
# SHA matches nothing (the copies do not exist below it).
#
# Usage: fork_twin_map_propose LOCAL_RANGE UPSTREAM_RANGE [UPSTREAM_TIP]
fork_twin_map_propose() {
    local local_range="$1" upstream_range="$2" upstream_tip="${3:-$2}"
    local local_repo="${FORK_TWIN_LOCAL_REPO:?}" upstream_repo="${FORK_TWIN_UPSTREAM_REPO:?}"
    local sha l_subject l_date l_files score u_line u_sha u_subject u_date u_files
    while read -r sha; do
        [ -n "$sha" ] || continue
        # Skip commits carrying a Change-Id: the trailer matches them already.
        if change_id_get_from_commit "$local_repo" "$sha" >/dev/null 2>&1; then
            continue
        fi
        l_subject="$(git -C "$local_repo" log -1 --format=%s "$sha")"
        l_date="$(git -C "$local_repo" log -1 --format=%ad "$sha")"
        l_files="$(git -C "$local_repo" show --name-only --format= "$sha" | sort | tr '\n' ' ')"
        while IFS= read -r u_line; do
            [ -n "$u_line" ] || continue
            u_sha="${u_line%% *}"
            u_subject="${u_line#* }"
            score=0
            [ "$u_subject" = "$l_subject" ] && score=$((score + 1))
            u_date="$(git -C "$upstream_repo" log -1 --format=%ad "$u_sha")"
            [ "$u_date" = "$l_date" ] && score=$((score + 1))
            u_files="$(git -C "$upstream_repo" show --name-only --format= "$u_sha" | sort | tr '\n' ' ')"
            [ "$u_files" = "$l_files" ] && score=$((score + 1))
            if [ "$score" -gt 0 ]; then
                printf '%s %s %s %s\n' "$score" "$sha" "$u_sha" "$l_subject"
            fi
        done < <(git -C "$upstream_repo" log --format='%H %s' "$upstream_range")
    done < <(git -C "$local_repo" rev-list "$local_range")
}
