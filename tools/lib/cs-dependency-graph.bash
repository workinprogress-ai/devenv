#!/usr/bin/env bash
# cs-dependency-graph.bash - C# reverse dependency tree for organization packages
# Version: 1.0.0
# Description: Builds and queries a reverse dependency graph across all cached
#              organization repositories. Scans .csproj files for PackageReference
#              entries, builds indexes mapping packages to repos and repos to
#              dependencies, then performs BFS to find all transitive dependents.
# Requirements: Bash 4.0+, grep, sed, md5sum
# Author: WorkInProgress.ai

# Guard against multiple sourcing
if [ -n "${_CS_DEPENDENCY_GRAPH_LOADED:-}" ]; then
    return 0
fi
readonly _CS_DEPENDENCY_GRAPH_LOADED=1

# Source dependencies
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/error-handling.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/error-handling.bash"
fi

if [ -z "${_REPO_CACHE_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/repo-cache.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/repo-cache.bash"
fi

# Organization package prefix used to filter org packages from third-party ones
readonly CS_DEP_ORG_PREFIX="${CS_DEP_ORG_PREFIX:-WorkInProgress.}"

# Index directory inside the cache
readonly CS_DEP_INDEX_DIR="${REPO_CACHE_DIR}/.index"

# ============================================================================
# Index Staleness Detection
# ============================================================================

# Check if the dependency index is stale relative to the repo cache
#
# Compares the cache timestamp written by refresh_repo_cache with the index
# timestamp written by build_dependency_index. The index is stale if:
#   - The cache timestamp file does not exist (cache never built)
#   - The index timestamp file does not exist (index never built)
#   - The two timestamps differ (cache was refreshed since last index build)
#
# Usage:
#   if is_index_stale; then
#       build_dependency_index
#   fi
#
# Returns:
#   0 if stale (rebuild needed), 1 if fresh
#
is_index_stale() {
    local cache_ts_file="$REPO_CACHE_DIR/.cache_timestamp"
    local index_ts_file="$CS_DEP_INDEX_DIR/.index_timestamp"

    if [ ! -f "$cache_ts_file" ]; then
        log_debug "No cache timestamp found — index is stale"
        return 0
    fi

    if [ ! -f "$index_ts_file" ]; then
        log_debug "No index timestamp found — index is stale"
        return 0
    fi

    local cache_ts index_ts
    cache_ts=$(cat "$cache_ts_file")
    index_ts=$(cat "$index_ts_file")

    if [ "$cache_ts" != "$index_ts" ]; then
        log_debug "Cache timestamp differs from index — index is stale"
        return 0
    fi

    return 1
}

# ============================================================================
# Index Building
# ============================================================================

# Build the dependency index from cached repositories
#
# Scans all .csproj files under src/ directories in the repo cache (skipping
# test/ and tests/ directories). Produces three TSV index files:
#
#   package_to_repo.tsv   — Maps each org package name to its source repo
#   repo_packages.tsv     — Lists packages produced by each repo
#   repo_dependencies.tsv — Lists org packages consumed by each repo
#                            (3 columns: repo, package, version)
#
# Also writes .index_timestamp to match the current .cache_timestamp so that
# is_index_stale can detect when a rebuild is needed.
#
# Usage:
#   build_dependency_index
#
# Returns:
#   0 on success, 1 on error
#
build_dependency_index() {
    if [ ! -d "$REPO_CACHE_DIR" ]; then
        log_error "Repo cache directory does not exist: $REPO_CACHE_DIR"
        return 1
    fi

    mkdir -p "$CS_DEP_INDEX_DIR" || {
        log_error "Failed to create index directory: $CS_DEP_INDEX_DIR"
        return 1
    }

    local pkg_to_repo="$CS_DEP_INDEX_DIR/package_to_repo.tsv"
    local repo_pkgs="$CS_DEP_INDEX_DIR/repo_packages.tsv"
    local repo_deps="$CS_DEP_INDEX_DIR/repo_dependencies.tsv"

    # Clear previous index
    : > "$pkg_to_repo"
    : > "$repo_pkgs"
    : > "$repo_deps"

    local known_packages=""

    # Phase 1: Scan for packages produced by each repo
    log_info "Building package index from cached repositories..."
    local repo_dir
    for repo_dir in "$REPO_CACHE_DIR"/*/; do
        [ -d "$repo_dir" ] || continue
        local repo_name
        repo_name=$(basename "$repo_dir")

        # Skip hidden directories (like .index)
        [[ "$repo_name" == .* ]] && continue

        # Find csproj files under src/, excluding test/ and tests/ directories
        while IFS= read -r csproj; do
            [ -z "$csproj" ] && continue
            local pkg_name
            pkg_name=$(basename "$csproj" .csproj)

            # Only index org packages
            if [[ "$pkg_name" == ${CS_DEP_ORG_PREFIX}* ]]; then
                printf '%s\t%s\n' "$pkg_name" "$repo_name" >> "$pkg_to_repo"
                printf '%s\t%s\n' "$repo_name" "$pkg_name" >> "$repo_pkgs"
                known_packages="${known_packages}${pkg_name}"$'\n'
            fi
        done < <(find "$repo_dir" -path "*/src/*.csproj" \
                    ! -path "*/test/*" ! -path "*/tests/*" 2>/dev/null)
    done

    if [ -z "$known_packages" ]; then
        log_warn "No org packages found in cache"
    fi

    # Phase 2: Scan for dependencies consumed by each repo
    log_info "Building dependency index..."
    for repo_dir in "$REPO_CACHE_DIR"/*/; do
        [ -d "$repo_dir" ] || continue
        local repo_name
        repo_name=$(basename "$repo_dir")
        [[ "$repo_name" == .* ]] && continue

        # Extract PackageReference Include + Version from src/ csproj files
        local refs
        refs=$(find "$repo_dir" -path "*/src/*.csproj" \
                    ! -path "*/test/*" ! -path "*/tests/*" \
                    -exec grep -oP 'PackageReference Include="[^"]+"\s+Version="[^"]+"' {} \; 2>/dev/null \
               | sed -E 's/PackageReference Include="([^"]*)"\s+Version="([^"]*)"/\1\t\2/' \
               | sort -u) || true

        while IFS=$'\t' read -r ref ver; do
            [ -z "$ref" ] && continue
            [ -z "$ver" ] && ver="*"
            # Only record org package dependencies
            if [[ "$ref" == ${CS_DEP_ORG_PREFIX}* ]]; then
                # Exclude self-references (packages from the same repo)
                local ref_repo
                ref_repo=$(grep -F "$ref" "$pkg_to_repo" 2>/dev/null | head -1 | cut -f2)
                if [ -n "$ref_repo" ] && [ "$ref_repo" != "$repo_name" ]; then
                    printf '%s\t%s\t%s\n' "$repo_name" "$ref" "$ver" >> "$repo_deps"
                fi
            fi
        done <<< "$refs"
    done

    # Write index timestamp to match cache timestamp
    local cache_ts_file="$REPO_CACHE_DIR/.cache_timestamp"
    if [ -f "$cache_ts_file" ]; then
        cp "$cache_ts_file" "$CS_DEP_INDEX_DIR/.index_timestamp"
    fi

    local pkg_count dep_count
    pkg_count=$(wc -l < "$pkg_to_repo")
    dep_count=$(wc -l < "$repo_deps")
    log_info "Index built: $pkg_count packages, $dep_count dependency edges"

    return 0
}

# Ensure the dependency index is current, rebuilding if stale
#
# Convenience wrapper that checks staleness and rebuilds only when needed.
# Call this before any query function to guarantee fresh results.
#
# Usage:
#   ensure_dependency_index || return 1
#
# Returns:
#   0 on success, 1 if rebuild fails
#
ensure_dependency_index() {
    if is_index_stale; then
        log_info "Dependency index is stale, rebuilding..."
        build_dependency_index || return 1
    fi
    return 0
}

# ============================================================================
# Query Functions
# ============================================================================

# List all packages produced by a repository
#
# Looks up the repo_packages.tsv index for all packages that belong to the
# given repository.
#
# Usage:
#   list_repo_packages "lib.cs.common.essentials"
#
# Arguments:
#   $1 - Repository name (required)
#
# Returns:
#   0 on success, 1 on error
#   Outputs package names (one per line) on stdout
#
list_repo_packages() {
    local repo_name="${1:-}"
    if [ -z "$repo_name" ]; then
        log_error "Repository name is required"
        return 1
    fi

    ensure_dependency_index || return 1

    local repo_pkgs="$CS_DEP_INDEX_DIR/repo_packages.tsv"
    if [ ! -f "$repo_pkgs" ]; then
        log_error "Index file not found: $repo_pkgs"
        return 1
    fi

    awk -F'\t' -v repo="$repo_name" '$1 == repo { print $2 }' "$repo_pkgs"
}

# List org-internal dependencies consumed by a repository
#
# Looks up the repo_dependencies.tsv index for all organization packages
# that the given repository references.
#
# Usage:
#   list_repo_dependencies "lib.cs.services.chassis"
#
# Arguments:
#   $1 - Repository name (required)
#
# Returns:
#   0 on success, 1 on error
#   Outputs package names (one per line) on stdout
#
list_repo_dependencies() {
    local repo_name="${1:-}"
    if [ -z "$repo_name" ]; then
        log_error "Repository name is required"
        return 1
    fi

    ensure_dependency_index || return 1

    local repo_deps="$CS_DEP_INDEX_DIR/repo_dependencies.tsv"
    if [ ! -f "$repo_deps" ]; then
        log_error "Index file not found: $repo_deps"
        return 1
    fi

    awk -F'\t' -v repo="$repo_name" '$1 == repo { print $2 }' "$repo_deps"
}

# Build a reverse dependency tree for a repository
#
# Given a root repository, finds all repositories that transitively depend on
# it via BFS. The output is a TSV table suitable for further processing or
# rendering as a tree.
#
# Output columns (tab-separated):
#   DEPTH        — 0 = direct dependents of root, 1 = their dependents, etc.
#   REPO         — repository that has the dependency
#   PACKAGE_REF  — the PackageReference name that creates the dependency edge
#   VERSION      — the version of the referenced package
#   PATH         — full chain from root through intermediaries (> delimited)
#
# The root repo itself is excluded from output. A repository may appear
# multiple times if it depends on the root via different paths (diamond
# dependencies). Cycles are prevented by not re-entering a repo already
# present in the current path.
#
# Usage:
#   get_reverse_dependency_tree "lib.cs.common.essentials"
#   get_reverse_dependency_tree "/path/to/repos/lib.cs.common.essentials"
#
# Arguments:
#   $1 - Repository name or path to a repository directory (required)
#
# Returns:
#   0 on success (even if no dependents found), 1 on error
#   Outputs TSV lines on stdout
#
# Examples:
#   # By repo name
#   get_reverse_dependency_tree "lib.cs.common.essentials"
#
#   # By path (extracts basename as repo name)
#   get_reverse_dependency_tree "$HOME/repos/lib.cs.common.essentials"
#
#   # Pipe to filter for specific depth
#   get_reverse_dependency_tree "lib.cs.common.essentials" | awk -F'\t' '$1 == 0'
#
get_reverse_dependency_tree() {
    local input="${1:-}"
    if [ -z "$input" ]; then
        log_error "Repository name or path is required"
        return 1
    fi

    # Accept either a path or a bare repo name
    local root_repo
    if [ -d "$input" ]; then
        root_repo=$(basename "$input")
    else
        root_repo="$input"
    fi

    ensure_dependency_index || return 1

    local pkg_to_repo="$CS_DEP_INDEX_DIR/package_to_repo.tsv"
    local repo_pkgs="$CS_DEP_INDEX_DIR/repo_packages.tsv"
    local repo_deps="$CS_DEP_INDEX_DIR/repo_dependencies.tsv"

    for f in "$pkg_to_repo" "$repo_pkgs" "$repo_deps"; do
        if [ ! -f "$f" ]; then
            log_error "Index file not found: $f"
            return 1
        fi
    done

    # Verify the root repo is known
    if ! grep -q "^${root_repo}"$'\t' "$repo_pkgs"; then
        log_error "Repository '$root_repo' not found in package index"
        return 1
    fi

    # Preload indexes into associative arrays to avoid per-iteration awk calls.
    # repo_to_pkgs_map: repo -> space-separated list of packages it produces
    # pkg_to_consumers_map: package -> space-separated list of consuming repos
    declare -A repo_to_pkgs_map
    declare -A pkg_to_consumers_map

    while IFS=$'\t' read -r repo pkg; do
        repo_to_pkgs_map["$repo"]+="${pkg} "
    done < "$repo_pkgs"

    # pkg_to_consumers_map: package -> space-separated "consumer@version" pairs
    while IFS=$'\t' read -r consumer pkg ver; do
        pkg_to_consumers_map["$pkg"]+="${consumer}@${ver:-*} "
    done < "$repo_deps"

    # BFS queue arrays (parallel arrays to avoid string packing/unpacking)
    local -a q_depth=() q_repo=() q_path=()
    q_depth+=(0)
    q_repo+=("${root_repo}")
    q_path+=("${root_repo}")

    local head=0

    while [ "$head" -lt "${#q_depth[@]}" ]; do
        local depth="${q_depth[$head]}"
        local repo_in_queue="${q_repo[$head]}"
        local path_in_queue="${q_path[$head]}"
        head=$((head + 1))

        local pkgs_str="${repo_to_pkgs_map[$repo_in_queue]:-}"
        [ -z "$pkgs_str" ] && continue

        local pkg
        for pkg in $pkgs_str; do
            [ -z "$pkg" ] && continue

            local consumers_str="${pkg_to_consumers_map[$pkg]:-}"
            [ -z "$consumers_str" ] && continue

            # Deduplicate consumer@version pairs for this package
            declare -A _seen_entries=()
            local entry
            for entry in $consumers_str; do
                [ -z "$entry" ] && continue
                local consumer="${entry%%@*}"
                local ver="${entry#*@}"
                [ -z "$consumer" ] && continue
                [ -n "${_seen_entries[$entry]:-}" ] && continue
                _seen_entries["$entry"]=1

                # Exclude root repo from output
                [ "$consumer" = "$root_repo" ] && continue

                # Cycle detection: skip if consumer already in this path
                if [[ ">$path_in_queue>" == *">${consumer}>"* ]]; then
                    continue
                fi

                local new_path="${path_in_queue}>${consumer}"
                printf '%s\t%s\t%s\t%s\t%s\n' "$depth" "$consumer" "$pkg" "$ver" "$new_path"

                local next_depth=$((depth + 1))
                q_depth+=("$next_depth")
                q_repo+=("$consumer")
                q_path+=("$new_path")
            done
            unset _seen_entries
        done
    done

    return 0
}

# Build a global topological ordering of all C# repositories in the cache
#
# Computes dependency generations across ALL cached repositories using Kahn's
# algorithm on the org-internal dependency graph. This is the basis for a
# global "update everything" pass.
#
# Generation 0 contains repositories with no org-internal dependencies (i.e.,
# foundational libraries and any repo that only uses external packages).
# Generation N contains repositories whose org-internal dependencies all
# belong to generations < N.
#
# NOTE: Repositories within the same generation are independent of each other
# and could in theory be processed in parallel. The current callers process
# them sequentially to keep interactive error-recovery simple.
#
# Output columns (tab-separated):
#   GENERATION   — 0-based topological depth
#   REPO         — repository name (basename of cache directory)
#
# Within each generation, repositories are sorted alphabetically.
#
# Usage:
#   get_topological_generations
#
# Returns:
#   0 on success (even if cache is empty), 1 on index error
#   Outputs TSV lines on stdout
#   Emits log_warn if a dependency cycle is detected
#
get_topological_generations() {
    ensure_dependency_index || return 1

    local pkg_to_repo="$CS_DEP_INDEX_DIR/package_to_repo.tsv"
    local repo_pkgs="$CS_DEP_INDEX_DIR/repo_packages.tsv"
    local repo_deps="$CS_DEP_INDEX_DIR/repo_dependencies.tsv"

    for f in "$pkg_to_repo" "$repo_pkgs" "$repo_deps"; do
        if [ ! -f "$f" ]; then
            log_error "Index file not found: $f"
            return 1
        fi
    done

    # ── Step 1: Collect all C# repos present in the cache ─────────────────

    declare -A all_repos=()
    local repo_dir
    for repo_dir in "$REPO_CACHE_DIR"/*/; do
        [ -d "$repo_dir" ] || continue
        local repo_name
        repo_name=$(basename "$repo_dir")
        [[ "$repo_name" == .* ]] && continue
        # Only include repos that contain at least one .csproj file
        local first_csproj
        first_csproj=$(find "$repo_dir" -name "*.csproj" -print -quit 2>/dev/null)
        if [ -n "$first_csproj" ]; then
            all_repos["$repo_name"]=1
        fi
    done

    if [ "${#all_repos[@]}" -eq 0 ]; then
        return 0
    fi

    # ── Step 2: Build repo-level dependency edges ─────────────────────────

    # pkg_owner[package] = repo that produces it
    declare -A pkg_owner=()
    while IFS=$'\t' read -r pkg repo; do
        [ -z "$pkg" ] && continue
        pkg_owner["$pkg"]="$repo"
    done < "$pkg_to_repo"

    # forward_deps[repo]  = space-separated list of upstream repos it depends on
    # reverse_deps[upstream] = space-separated list of downstream repos
    declare -A forward_deps=()
    declare -A reverse_deps=()
    while IFS=$'\t' read -r consumer pkg _ver; do
        [ -z "$consumer" ] && continue
        [ -z "$pkg" ] && continue
        local upstream="${pkg_owner[$pkg]:-}"
        [ -z "$upstream" ] && continue
        [ "$upstream" = "$consumer" ] && continue               # skip self-deps
        [ -z "${all_repos[$upstream]:-}" ] && continue          # skip uncached upstreams
        [ -z "${all_repos[$consumer]:-}" ] && continue          # skip uncached consumers
        # Add edge only once (space-delimited set membership check)
        if [[ " ${forward_deps[$consumer]:-} " != *" ${upstream} "* ]]; then
            forward_deps["$consumer"]+="${upstream} "
            reverse_deps["$upstream"]+="${consumer} "
        fi
    done < "$repo_deps"

    # ── Step 3: Compute initial in-degrees ────────────────────────────────

    declare -A in_degree=()
    local repo
    for repo in "${!all_repos[@]}"; do
        local deps_str="${forward_deps[$repo]:-}"
        if [ -n "$deps_str" ]; then
            read -ra _dep_arr <<< "$deps_str"
            in_degree["$repo"]="${#_dep_arr[@]}"
        else
            in_degree["$repo"]=0
        fi
    done

    # ── Step 4: Kahn's algorithm ──────────────────────────────────────────

    local generation=0
    local -a current_gen=()
    for repo in "${!all_repos[@]}"; do
        if [ "${in_degree[$repo]}" -eq 0 ]; then
            current_gen+=("$repo")
        fi
    done

    while [ "${#current_gen[@]}" -gt 0 ]; do
        local -a sorted_gen
        mapfile -t sorted_gen < <(printf '%s\n' "${current_gen[@]}" | sort)

        for repo in "${sorted_gen[@]}"; do
            printf '%s\t%s\n' "$generation" "$repo"
        done

        local -a next_gen=()
        for repo in "${sorted_gen[@]}"; do
            local downstreams="${reverse_deps[$repo]:-}"
            [ -z "$downstreams" ] && continue
            local downstream
            for downstream in $downstreams; do
                [ -z "$downstream" ] && continue
                in_degree["$downstream"]=$(( in_degree["$downstream"] - 1 ))
                if [ "${in_degree[$downstream]}" -eq 0 ]; then
                    next_gen+=("$downstream")
                fi
            done
        done

        current_gen=("${next_gen[@]+"${next_gen[@]}"}")
        generation=$(( generation + 1 ))
    done

    # ── Step 5: Warn about cycles ─────────────────────────────────────────

    local cycled_repos=""
    for repo in "${!all_repos[@]}"; do
        if [ "${in_degree[$repo]:-0}" -gt 0 ]; then
            cycled_repos="${cycled_repos}${repo} "
        fi
    done
    if [ -n "$cycled_repos" ]; then
        log_warn "Cycle detected in dependency graph — these repositories were excluded: ${cycled_repos% }"
    fi

    return 0
}
