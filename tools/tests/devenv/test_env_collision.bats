#!/usr/bin/env bats
# Meta-test: exported convenience variables must not collide with bash locals.
#
# Bash locals inherit the export attribute of a same-named exported global,
# so a `local repos` in a tool that runs with the devenv `repos` export set
# silently re-exports the local's value. Past MAX_ARG_STRLEN (128KB per env
# string) every child process fails with E2BIG. The convention: same-named
# locals are banned — name locals distinctly (repos_list, not repos).
# (E2BIG hazard class, fork-reported; 15.2.)

bats_require_minimum_version 1.5.0

load ../test_helper

# The devenv convenience exports a bash tool may see in its environment.
CONVENIENCE_EXPORTS=(
    repos
    playground
    debug
)

@test "env-collision: no bash local redeclares a devenv convenience export" {
    local offenders=""
    for name in "${CONVENIENCE_EXPORTS[@]}"; do
        while IFS= read -r hit; do
            offenders+="${hit}"$'\n'
        done < <(grep -rEn "local[[:space:]]+\"?${name}\"?([[:space:]=]|$)" \
            "$PROJECT_ROOT/tools/lib" "$PROJECT_ROOT/tools/scripts" \
            "$PROJECT_ROOT/.devcontainer" \
            --include='*.bash' --include='*.sh' 2>/dev/null || true)
    done
    if [ -n "$offenders" ]; then
        fail "same-named locals inherit the export attribute and can E2BIG child processes past MAX_ARG_STRLEN — rename the local (e.g. ${offenders}%s_list form)" "$(printf '%s' "$offenders" | head -1 | cut -d: -f1-2)"
    fi
}
