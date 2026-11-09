#!/usr/bin/env bash
# Run the full devenv test suite: the bats sweep first (parallel by default,
# sequential escape hatch), then the vitest lane — one command is the whole
# gate; `pnpm test` aliases this script.

set -euo pipefail

# Resolve the tools root from this script's own location (self-root contract:
# self-location wins; an exported DEVENV_TOOLS is honored only when it points
# at this same checkout). Export for child bats processes, which read it from
# the environment; without export, a CI-like invocation leaves them unset.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"

# F42: bats suites invoke gitignored depth-1 stubs by absolute path —
# generate them up front via entry-stubs-sync.sh (bootstrap does this too;
# CI needs it explicitly). This runner also self-generates the stubs it
# needs before the bats sweep starts. Resolution is fail-safe: a bare
# checkout (no .devcontainer/) skips stub sync instead of aborting under
# set -e.
DEVCONTAINER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.devcontainer" 2>/dev/null && pwd || true)"
STUB_SYNC="$DEVCONTAINER_DIR/entry-stubs-sync.sh"
if [ -x "$STUB_SYNC" ]; then
    bash "$STUB_SYNC" >/dev/null 2>&1 || true
fi

# Tests spawn provider-sourcing bash fixtures that configure the provider via
# their own devenv.config; an inherited PROVIDER_NAME from the invoking shell
# beats that config (provider_load short-circuits on a non-empty PROVIDER_NAME)
# and poisons provider-fixture assertions. The gate must not depend on the
# caller's shell environment.
unset PROVIDER_NAME AZURE_DEVOPS_ORG AZURE_DEVOPS_PROJECT

DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
export DEVENV_TOOLS

TESTS_DIR="$DEVENV_TOOLS/tests"

# Parallel-job controls (idiom from tools/scripts/repo-update-all.sh):
# default = all cores, capped for sanity; --sequential falls back to jobs=1.
readonly MAX_PARALLEL_JOBS=8
# Declare and assign separately (SC2155): a combined readonly assignment would
# mask nproc's exit status instead of falling back to 2.
DEFAULT_PARALLEL_JOBS="$(nproc 2>/dev/null || echo 2)"
readonly DEFAULT_PARALLEL_JOBS
parallel_jobs=$DEFAULT_PARALLEL_JOBS

usage() {
    echo "Usage: $(basename "$0") [--jobs N] [--sequential]"
    echo ""
    echo "  --jobs N       Run with N parallel jobs (default: nproc, max $MAX_PARALLEL_JOBS)"
    echo "  --sequential   Run without parallelism (jobs=1)"
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

# Collect every test file across the four directories (live/ is deliberately
# absent: it needs real credentials and a scratch project — manual-only, see
# tools/tests/README.md). A single bats
# invocation over the whole set is what makes the run parallel: bats --jobs
# schedules files across a worker pool; three separate invocations would
# serialize the groups.
test_files=()
for dir in lib scripts devenv skills; do
    if [ -d "$TESTS_DIR/$dir" ]; then
        while IFS= read -r -d '' f; do
            test_files+=("$f")
        done < <(find "$TESTS_DIR/$dir" -maxdepth 1 -name '*.bats' -print0 | sort -z)
    fi
done

if [ "${#test_files[@]}" -eq 0 ]; then
    # lib/ is legitimately empty at this point in the migration; the vitest
    # lane below still runs, so an empty bats corpus is not fatal — only a
    # completely empty tests tree is.
    if [ ! -d "$TESTS_DIR/ts" ]; then
        echo "Error: No test files found under $TESTS_DIR"
        exit 1
    fi
    echo "Note: no bats files collected (migration in flight); running the vitest lane only."
fi

mode_label="parallel (jobs=$parallel_jobs)"
bats_args=()
if [ "$parallel_jobs" -gt 1 ]; then
    bats_args+=(--jobs "$parallel_jobs")
else
    mode_label="sequential"
fi

echo "Running Devenv test suite..."
echo "======================================"
echo "Mode: $mode_label"
if [ "${#test_files[@]}" -gt 0 ]; then
    echo "Bats test files: ${#test_files[@]}"
fi
start_time=$(date +%s)

# --verbose-run: failing tests print their captured output — without it a
# failed grep-style assertion hides the actual error text, which is the
# only root-cause signal for environment-dependent failures.
if [ "${#test_files[@]}" -gt 0 ] && ! bats --verbose-run "${bats_args[@]}" "${test_files[@]}"; then
    end_time=$(date +%s)
    echo "======================================"
    echo "❌ Bats suite failed! (duration: $((end_time - start_time))s, mode: $mode_label)"
    exit 1
fi

bats_end_time=$(date +%s)
echo "======================================"
echo "✅ Bats sweep passed (duration: $((bats_end_time - start_time))s, mode: $mode_label)"

# ── vitest lane ────────────────────────────────────────────────────────────
# The TS corpus under tests/ts/ is the other half of the gate: every ported
# suite lives there and grows as the bats→vitest migration lands. node_modules
# is required; the bootstrap and CI both install before invoking this script.
# Worker cap: an unbounded pool pthread-exhausts this container when it runs
# after (or beside) the bats sweep — pass --sequential through as a single
# worker, otherwise cap at the same MAX_PARALLEL_JOBS as bats.
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
# On the runtime workspace (this checkout hosts repos/devenv), the vitest
# config excludes clone-context suites — the dev-clone layout invariants
# they assert cannot hold here. They still run in the dev clone, per the
# nested-clone workflow (docs/Nested-Devenv-Development.md).
if [ -d "$RUN_ROOT/repos/devenv" ]; then
    echo "Runtime workspace detected (this checkout hosts repos/devenv): clone-context vitest suites are skipped here — run the full gate from repos/devenv."
fi
vitest_start_time=$(date +%s)
if ! (cd "$RUN_ROOT" && pnpm exec vitest run "${vitest_args[@]}"); then
    end_time=$(date +%s)
    echo "======================================"
    echo "❌ Vitest suite failed! (duration: $((end_time - vitest_start_time))s)"
    exit 1
fi
end_time=$(date +%s)
echo "======================================"
echo "✅ All tests passed! (bats: $((bats_end_time - start_time))s, vitest: $((end_time - vitest_start_time))s)"
exit 0
