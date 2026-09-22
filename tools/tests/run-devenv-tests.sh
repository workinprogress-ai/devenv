#!/usr/bin/env bash
# Run all BATS tests (parallel by default, sequential escape hatch)

set -euo pipefail

# Resolve the tools root from this script's own location (self-root contract:
# self-location wins; an exported DEVENV_TOOLS is honored only when it points
# at this same checkout). Export for child bats processes, which read it from
# the environment; without export, a CI-like invocation leaves them unset.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
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

# Collect every test file across the three directories. A single bats
# invocation over the whole set is what makes the run parallel: bats --jobs
# schedules files across a worker pool; three separate invocations would
# serialize the groups.
test_files=()
for dir in lib scripts devenv; do
    if [ -d "$TESTS_DIR/$dir" ]; then
        while IFS= read -r -d '' f; do
            test_files+=("$f")
        done < <(find "$TESTS_DIR/$dir" -maxdepth 1 -name '*.bats' -print0 | sort -z)
    fi
done

if [ "${#test_files[@]}" -eq 0 ]; then
    echo "Error: No test files found under $TESTS_DIR"
    exit 1
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
echo "Test files: ${#test_files[@]}"
start_time=$(date +%s)

if ! bats "${bats_args[@]}" "${test_files[@]}"; then
    end_time=$(date +%s)
    echo "======================================"
    echo "❌ Test suite failed! (duration: $((end_time - start_time))s, mode: $mode_label)"
    exit 1
fi

end_time=$(date +%s)
echo "======================================"
echo "✅ All tests passed! (duration: $((end_time - start_time))s, mode: $mode_label)"
exit 0
