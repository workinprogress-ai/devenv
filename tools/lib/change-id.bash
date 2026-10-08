#!/usr/bin/env bash
# change-id.bash - Stable commit identity for fork-export: the Change-Id trailer,
# the Fork-Only marker and the local skip list. See docs/Forking.md.

# Guard against multiple sourcing
if [ -n "${_CHANGE_ID_LIB_LOADED:-}" ]; then
    return 0
fi
_CHANGE_ID_LIB_LOADED=1

readonly CHANGE_ID_LENGTH=12
readonly CHANGE_ID_GENERATED_PATTERN='^[0-9A-Za-z]{12}$'
readonly CHANGE_ID_PATTERN='^[0-9A-Za-z._-]{8,64}$'
readonly SKIP_LIST_FILE_NAME="fork-export-skip"

# Print a new Change-Id: CHANGE_ID_LENGTH random base62 characters.
# tr keeps only accepted bytes, so every character is uniformly distributed.
change_id_generate() {
    local id
    id="$(LC_ALL=C tr -dc '0-9A-Za-z' < /dev/urandom 2>/dev/null | head -c "$CHANGE_ID_LENGTH" || true)"
    [[ "$id" =~ $CHANGE_ID_GENERATED_PATTERN ]] || {
        echo "could not generate a Change-Id" >&2
        return 1
    }
    printf '%s\n' "$id"
}

# Whether a value is usable as a Change-Id: the generated format, or a foreign one (such
# as a Gerrit ID) of 8 to 64 characters from A-Za-z0-9._-. Matching is case-sensitive.
change_id_is_valid() {
    [[ "${1:-}" =~ $CHANGE_ID_PATTERN ]]
}

# Print the value of the last trailer KEY in a commit message (nothing when absent).
# The key match is exact and case-sensitive.
#
# Usage: change_id_get_trailer MESSAGE KEY
change_id_get_trailer() {
    local message="$1" key="$2"
    printf '%s\n' "$message" | git interpret-trailers --parse 2>/dev/null |
        awk -v key="$key" 'index($0, key ": ") == 1 { value = substr($0, length(key) + 3) } END { if (value != "") print value }'
}

# Print the Change-Id of a commit message; fails when it has none or it is malformed.
change_id_get_from_message() {
    local value
    value="$(change_id_get_trailer "$1" "Change-Id")"
    change_id_is_valid "$value" || return 1
    printf '%s\n' "$value"
}

# Print the Change-Id of a commit.
#
# Usage: change_id_get_from_commit REPO COMMIT
change_id_get_from_commit() {
    local message
    message="$(git -C "$1" log -1 --format=%B "$2" 2>/dev/null)" || return 1
    change_id_get_from_message "$message"
}

# Whether a commit message carries `Fork-Only: yes`.
change_id_is_fork_only() {
    local value
    value="$(change_id_get_trailer "$1" "Fork-Only")"
    [ "${value,,}" = "yes" ]
}

# Path of the skip list: one file in the git common directory, shared by worktrees
# and never part of the working tree.
#
# Usage: skip_list_get_path REPO
skip_list_get_path() {
    local common
    common="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
    printf '%s/%s\n' "$common" "$SKIP_LIST_FILE_NAME"
}

# Run a command while holding the skip-list lock, so concurrent writers (another
# fork-export, a picker session) serialize instead of overwriting each other.
#
# Usage: _skip_list_locked REPO COMMAND [ARG...]
_skip_list_locked() {
    local path lock_fd status=0
    path="$(skip_list_get_path "$1")" || return 1
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

# Add an entry; adding one that is already listed changes nothing. A sha is
# resolved to its full object ID.
#
# Usage: skip_list_add REPO change-id|sha VALUE [NOTE]
skip_list_add() {
    _skip_list_locked "$1" _skip_list_add_unlocked "$@"
}

_skip_list_add_unlocked() {
    local repo="$1" kind="$2" value="$3" note="${4:-}" path full awk_status=0
    case "$kind" in
        change-id)
            change_id_is_valid "$value" || {
                echo "invalid Change-Id: $value" >&2
                return 1
            }
            ;;
        sha)
            full="$(git -C "$repo" rev-parse --verify --quiet "$value^{commit}" 2>/dev/null)" || {
                echo "not a commit: $value" >&2
                return 1
            }
            value="$full"
            ;;
        *)
            echo "unknown skip-list entry kind: $kind" >&2
            return 1
            ;;
    esac
    path="$(skip_list_get_path "$repo")" || return 1
    if [ -f "$path" ]; then
        awk -v k="$kind" -v v="$value" '$1 == k && $2 == v { found = 1 } END { exit !found }' "$path" || awk_status=$?
        case "$awk_status" in
            0) return 0 ;;
            1) ;;
            *)
                echo "could not read the skip list: $path" >&2
                return 1
                ;;
        esac
    fi
    note="${note//$'\n'/ }"
    if [ -n "$note" ]; then
        printf '%s %s # %s\n' "$kind" "$value" "$note" >> "$path" || return 1
    else
        printf '%s %s\n' "$kind" "$value" >> "$path" || return 1
    fi
}

# Remove every entry naming VALUE. A Change-Id also removes the sha entries of the
# commits carrying it; a commit ref (resolved to its SHA) also removes the entry for
# its Change-Id. Fails when nothing matched.
#
# Usage: skip_list_remove REPO VALUE
skip_list_remove() {
    _skip_list_locked "$1" _skip_list_remove_unlocked "$@"
}

_skip_list_remove_unlocked() {
    local repo="$1" value="$2" path full="" id="" linked="" candidates commit tmp
    path="$(skip_list_get_path "$repo")" || return 1
    [ -f "$path" ] || return 1
    if change_id_is_valid "$value"; then
        id="$value"
        candidates="$(git -C "$repo" log --all -F --grep="Change-Id: $id" --format=%H 2>/dev/null)" || return 1
        while IFS= read -r commit; do
            [ -n "$commit" ] || continue
            if [ "$(change_id_get_from_commit "$repo" "$commit" 2>/dev/null || true)" = "$id" ]; then
                linked+="$commit"$'\n'
            fi
        done <<< "$candidates"
    fi
    full="$(git -C "$repo" rev-parse --verify --quiet "$value^{commit}" 2>/dev/null || true)"
    if [ -n "$full" ]; then
        id="$(change_id_get_from_commit "$repo" "$full" 2>/dev/null || true)"
    fi
    tmp="$(mktemp "$path.XXXXXX")" || return 1
    LINKED="$linked" awk -v v="$value" -v f="$full" -v i="$id" '
        BEGIN { n = split(ENVIRON["LINKED"], parts, "\n"); for (k = 1; k <= n; k++) if (parts[k] != "") drop[parts[k]] = 1 }
        /^[[:space:]]*(#|$)/ { print; next }
        $2 == v || (f != "" && $2 == f) || (i != "" && $2 == i) || ($2 in drop) { removed = 1; next }
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

# Load the skip list into SKIP_LIST_IDS and SKIP_LIST_SHAS (value => 1). A missing list
# is empty; a list that cannot be read is an error, never an empty list.
#
# Usage: skip_list_load REPO
skip_list_load() {
    local path content kind value _rest
    declare -gA SKIP_LIST_IDS=()
    declare -gA SKIP_LIST_SHAS=()
    path="$(skip_list_get_path "$1")" || return 1
    [ -f "$path" ] || return 0
    content="$(cat "$path")" || {
        echo "could not read the skip list: $path" >&2
        return 1
    }
    while read -r kind value _rest; do
        [ -n "$value" ] || continue
        case "$kind" in
            change-id) SKIP_LIST_IDS["$value"]=1 ;;
            sha) SKIP_LIST_SHAS["$value"]=1 ;;
        esac
    done <<< "$content"
    return 0
}

# Whether a commit is skipped, by its SHA or by its Change-Id. Needs skip_list_load.
#
# Usage: skip_list_has SHA [CHANGE_ID]
skip_list_has() {
    local sha="$1" id="${2:-}"
    [ -z "${SKIP_LIST_SHAS[$sha]:-}" ] || return 0
    [ -n "$id" ] && [ -n "${SKIP_LIST_IDS[$id]:-}" ]
}

# Print the entries, first dropping stale ones: a sha whose commit no longer exists
# in the repository, or a Change-Id that no commit reachable from any ref carries.
# Pruned entries are reported on stderr.
#
# Usage: skip_list_list REPO
skip_list_list() {
    _skip_list_locked "$1" _skip_list_list_unlocked "$@"
}

_skip_list_list_unlocked() {
    local repo="$1" path tmp content line kind value _rest stale=0 git_status found pruned=""
    path="$(skip_list_get_path "$repo")" || return 1
    [ -f "$path" ] || return 0
    content="$(cat "$path")" || {
        echo "could not read the skip list: $path" >&2
        return 1
    }
    tmp="$(mktemp "$path.XXXXXX")" || return 1
    while IFS= read -r line; do
        if [[ "$line" =~ ^[[:space:]]*(#|$) ]]; then
            printf '%s\n' "$line" >> "$tmp" || {
                rm -f "$tmp"
                return 1
            }
            continue
        fi
        read -r kind value _rest <<< "$line"
        git_status=0
        case "$kind" in
            sha | change-id)
                if [ -z "$value" ]; then
                    git_status=1
                elif [ "$kind" = "sha" ]; then
                    git -C "$repo" rev-parse --verify --quiet "$value^{commit}" > /dev/null 2>&1 || git_status=$?
                else
                    found="$(git -C "$repo" log --all -1 --format=%H -F --grep="Change-Id: $value" 2>/dev/null)" || git_status=$?
                    if [ "$git_status" -eq 0 ] && [ -z "$found" ]; then
                        git_status=1
                    fi
                fi
                ;;
        esac
        case "$git_status" in
            0) ;;
            1)
                pruned+="pruned stale entry: $line"$'\n'
                stale=1
                continue
                ;;
            *)
                rm -f "$tmp"
                echo "could not check the skip list against the repository; it was left untouched" >&2
                return 1
                ;;
        esac
        printf '%s\n' "$line" >> "$tmp" || {
            rm -f "$tmp"
            return 1
        }
    done <<< "$content"
    if [ "$stale" -eq 1 ]; then
        mv "$tmp" "$path" || {
            rm -f "$tmp"
            return 1
        }
        printf '%s' "$pruned" >&2
    else
        rm -f "$tmp"
    fi
    awk '!/^[[:space:]]*(#|$)/' "$path"
}
