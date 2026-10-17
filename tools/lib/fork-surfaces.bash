#!/bin/bash
# fork-surfaces.bash - Machine-readable fork-stable surfaces contract.
#
# Parses tools/config/fork-surfaces.yml (the machine form of
# docs/Forking.md § The fork-stable surfaces contract) and classifies repo
# paths into surface classes: fork-stable, upstream-stable, fork-replaced.
# Any path matching no declared entry is upstream-stable — the default rule
# the contract itself states.
#
# Requires yq (same dependency as issues-config.bash).

# Resolve the surfaces declaration path: explicit override, then
# FORK_SURFACES_CONFIG, then the in-tree default.
#
# Usage: fork_surfaces_config_path [override]
fork_surfaces_config_path() {
    local override="${1:-}"
    if [ -n "$override" ]; then
        printf '%s\n' "$override"
        return 0
    fi
    if [ -n "${FORK_SURFACES_CONFIG:-}" ]; then
        printf '%s\n' "$FORK_SURFACES_CONFIG"
        return 0
    fi
    printf '%s\n' "${DEVENV_TOOLS:?}/config/fork-surfaces.yml"
}

# Validate the declaration: parseable, version present, every class key
# known, every entry carries description + non-empty paths. Prints errors,
# returns 1 when invalid.
#
# Usage: fork_surfaces_validate [config_path]
fork_surfaces_validate() {
    local config
    config="$(fork_surfaces_config_path "${1:-}")"
    [ -f "$config" ] || { echo "surfaces declaration not found: $config" >&2; return 1; }

    local errors=0
    local version
    version="$(yq eval '.version' "$config" 2>/dev/null)"
    if [ -z "$version" ] || [ "$version" = "null" ]; then
        echo "surfaces declaration missing version: $config" >&2
        errors=$((errors + 1))
    fi

    local entry_count class_key
    for class_key in fork-stable fork-replaced upstream-stable; do
        # upstream-stable is the default rule, never a declared list; entries
        # there would be silently ignored by classify.
        if [ "$class_key" = "upstream-stable" ]; then
            local us_count
            us_count="$(yq eval ".classes.\"$class_key\" | length" "$config" 2>/dev/null)"
            if [ -n "$us_count" ] && [ "$us_count" != "null" ] && [ "$us_count" -gt 0 ]; then
                echo "surfaces declaration must not list upstream-stable paths (it is the default rule)" >&2
                errors=$((errors + 1))
            fi
            continue
        fi
        entry_count="$(yq eval ".classes.\"$class_key\" | length" "$config" 2>/dev/null)"
        if [ -z "$entry_count" ] || [ "$entry_count" = "null" ]; then
            echo "surfaces declaration missing class: $class_key" >&2
            errors=$((errors + 1))
            continue
        fi
        [ "$entry_count" -gt 0 ] || continue
        local i desc first_path
        for ((i = 0; i < entry_count; i++)); do
            desc="$(yq eval ".classes.\"$class_key\"[$i].description" "$config" 2>/dev/null)"
            if [ -z "$desc" ] || [ "$desc" = "null" ]; then
                echo "class $class_key entry $i missing description" >&2
                errors=$((errors + 1))
            fi
            first_path="$(yq eval ".classes.\"$class_key\"[$i].paths[0]" "$config" 2>/dev/null)"
            if [ -z "$first_path" ] || [ "$first_path" = "null" ]; then
                echo "class $class_key entry $i has no paths" >&2
                errors=$((errors + 1))
            fi
        done
    done

    return "$errors"
}

# Classify one repo-root-relative path. Prints the class name:
# fork-stable | fork-replaced | upstream-stable (the default rule).
# First match wins when several globs hit; declaration order is the tiebreak.
# Fails (return 1) when the declaration cannot be read or parsed — an
# unreadable contract must NOT silently classify everything upstream-stable.
#
# Usage: fork_surfaces_classify <path> [config_path]
fork_surfaces_classify() {
    local path="$1"
    local config
    config="$(fork_surfaces_config_path "${2:-}")"
    if ! fork_surfaces_validate "$config" >/dev/null 2>&1; then
        echo "fork-surfaces: declaration unreadable or invalid: $config" >&2
        return 1
    fi

    # upstream-stable is deliberately absent: it is the undeclared default
    # (the yml documents it as an empty list; validate rejects entries there).
    local class_key entry_count i glob
    for class_key in fork-stable fork-replaced; do
        entry_count="$(yq eval ".classes.\"$class_key\" | length" "$config" 2>/dev/null)" || entry_count=0
        [ -n "$entry_count" ] && [ "$entry_count" != "null" ] || entry_count=0
        for ((i = 0; i < entry_count; i++)); do
            while IFS= read -r glob; do
                [ -n "$glob" ] || continue
                # $glob is intentionally unquoted: path matching IS globbing.
                # shellcheck disable=SC2254
                case "$path" in
                    $glob) printf '%s\n' "$class_key"; return 0 ;;
                esac
            done < <(yq eval ".classes.\"$class_key\"[$i].paths[]" "$config" 2>/dev/null)
        done
    done
    printf '%s\n' "upstream-stable"
}

# List every declared path glob with its class, one per line:
# "<class> <glob>". upstream-stable is absent — it is the undeclared default.
#
# Usage: fork_surfaces_list [config_path]
fork_surfaces_list() {
    local config
    config="$(fork_surfaces_config_path "${1:-}")"
    # upstream-stable is deliberately absent: it is the undeclared default
    # (the yml documents it as an empty list; validate rejects entries there).
    local class_key entry_count i glob
    for class_key in fork-stable fork-replaced; do
        entry_count="$(yq eval ".classes.\"$class_key\" | length" "$config" 2>/dev/null)" || entry_count=0
        [ -n "$entry_count" ] && [ "$entry_count" != "null" ] || entry_count=0
        for ((i = 0; i < entry_count; i++)); do
            while IFS= read -r glob; do
                [ -n "$glob" ] || continue
                printf '%s %s\n' "$class_key" "$glob"
            done < <(yq eval ".classes.\"$class_key\"[$i].paths[]" "$config" 2>/dev/null)
        done
    done
}
