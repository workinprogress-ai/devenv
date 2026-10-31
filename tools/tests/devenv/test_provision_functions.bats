#!/usr/bin/env bats
# Guard for the emitted bash-functions file (15.107/F6 class): every script
# path the emitted functions reference must resolve in the tree. The deleted
# tools/scripts/repo-get.sh shadowing slipped through because nothing checked.

bats_require_minimum_version 1.5.0

load ../test_helper

@test "repo-get function targets the depth-1 stub (tools/repo-get), not a deleted .sh" {
    grep -q 'bash "$DEVENV_ROOT/tools/repo-get"' "$PROJECT_ROOT/tools/lib/provision.bash"
    ! grep -q 'tools/scripts/repo-get.sh' "$PROJECT_ROOT/tools/lib/provision.bash"
}

@test "every literal tools/ script path referenced in provision.bash resolves in the tree" {
    local bad=""
    local ref path
    while IFS= read -r ref; do
        path="$(printf '%s' "$ref" | sed -E 's/^"\$DEVENV_ROOT\///; s/"$//')"
        # Skip runtime-interpolated roots ($toolbox_root, $provider, editor
        # env fallbacks) — these resolve at runtime, not from the repo tree.
        case "$path" in
            *'$'*|*tools/lib/providers/*key-update*) continue ;;
        esac
        [ -e "$PROJECT_ROOT/$path" ] || bad="$bad $path"
    done < <(grep -oE '"[^"]*tools/[^"]+"' "$PROJECT_ROOT/tools/lib/provision.bash" | tr -d '"' | sort -u)
    [ -z "$bad" ] || { echo "dangling script refs:$bad"; false; }
}
