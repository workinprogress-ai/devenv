#!/usr/bin/env bash
# Run the full devenv test suite: the vitest lane under tools/tests/ts/ —
# one command is the whole gate; `pnpm test` aliases this script.
#
# The bats lane retired with the Phase-11 port (fork×3 + the isolation
# canary joined vitest; the manual-only live/ bats suite is NOT collected
# here — see tools/tests/README.md for its explicit invocation).

set -euo pipefail

# Resolve the tools root from this script's own location (self-root contract,
# inlined from the retired self-root.bash: self-location wins; an exported
# DEVENV_TOOLS is honored only when it realpath-matches this checkout — a
# foreign checkout's export never redirects the runner onto the wrong tree).
# Export for child bats processes, which read it from the environment;
# without export, a CI-like invocation leaves them unset.
devenv_resolve_tools_root() {
    local script_dir tools_root exported_real self_real
    script_dir="$(cd "$(dirname "$1")" && pwd -P)" || return 1
    tools_root="$(dirname "$script_dir")"
    if [ -n "${DEVENV_TOOLS:-}" ]; then
        exported_real="$(realpath "$DEVENV_TOOLS" 2>/dev/null || printf '%s' "$DEVENV_TOOLS")"
        self_real="$(realpath "$tools_root" 2>/dev/null || printf '%s' "$tools_root")"
        if [ "$exported_real" = "$self_real" ]; then
            printf '%s\n' "$tools_root"
            return 0
        fi
    fi
    printf '%s\n' "$tools_root"
}

# Tests spawn provider-sourcing bash fixtures that configure the provider via
# their own devenv.config; an inherited PROVIDER_NAME from the invoking shell
# beats that config (provider_load short-circuits on a non-empty PROVIDER_NAME)
# and poisons provider-fixture assertions. The gate must not depend on the
# caller's shell environment.
unset PROVIDER_NAME AZURE_DEVOPS_ORG AZURE_DEVOPS_PROJECT

DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
export DEVENV_TOOLS

# Worker-pool controls: default = all cores, capped for sanity;
# --sequential falls back to a single worker.
readonly MAX_PARALLEL_JOBS=8
# Declare and assign separately (SC2155): a combined readonly assignment would
# mask nproc's exit status instead of falling back to 2.
DEFAULT_PARALLEL_JOBS="$(nproc 2>/dev/null || echo 2)"
readonly DEFAULT_PARALLEL_JOBS
parallel_jobs=$DEFAULT_PARALLEL_JOBS

usage() {
    echo "Usage: $(basename "$0") [--jobs N] [--sequential]"
    echo ""
    echo "  --jobs N       Run with N parallel workers (default: nproc, max $MAX_PARALLEL_JOBS)"
    echo "  --sequential   Run without parallelism (workers=1)"
}

while [ $# -gt 0 ]; do
    case "$1" in
        -j|--jobs)
            [[ -n "${2:-}" && "$2" =~ ^[0-9]+$ ]] || { echo "ERROR: --jobs requires a numeric argument" >&2; usage >&2; exit 1; }
            parallel_jobs=$2
            shift 2
            ;;
        -s|--sequential)
            parallel_jobs=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [ "$parallel_jobs" -gt "$MAX_PARALLEL_JOBS" ]; then
    echo "WARNING: Requested $parallel_jobs jobs, limiting to $MAX_PARALLEL_JOBS." >&2
    parallel_jobs=$MAX_PARALLEL_JOBS
fi

echo "Running Devenv test suite..."
echo "======================================"

# ── vitest lane ────────────────────────────────────────────────────────────
# The TS corpus under tests/ts/ is the whole gate (the bats corpus retired
# with the Phase-11 port). node_modules is required; the bootstrap and CI
# both install before invoking this script.
# Worker cap: an unbounded pool pthread-exhausts this container — pass
# --sequential through as a single worker, otherwise cap at
# MAX_PARALLEL_JOBS.
vitest_args=()
if [ "$parallel_jobs" -gt 1 ]; then
    vitest_args+=(--maxWorkers="$parallel_jobs")
else
    vitest_args+=(--maxWorkers=1 --minWorkers=1)
fi
echo ""
echo "Running vitest lane (tests/ts/)..."
# pnpm exec resolves the vitest binary from the checkout root's node_modules;
# invoked from a subdirectory (tools/tests) pnpm's cwd-based resolution fails.
# The include path is repo-root-relative, so run from the root.
RUN_ROOT="$(dirname "$DEVENV_TOOLS")"
vitest_start_time=$(date +%s)
if ! (cd "$RUN_ROOT" && pnpm exec vitest run "${vitest_args[@]}"); then
    end_time=$(date +%s)
    echo "======================================"
    echo "❌ Vitest suite failed! (duration: $((end_time - vitest_start_time))s)"
    exit 1
fi
end_time=$(date +%s)
echo "======================================"
echo "✅ All tests passed! (vitest: $((end_time - vitest_start_time))s)"
exit 0
