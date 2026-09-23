#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
# cs-references-update.sh - Update NuGet dependencies in a repository tree
# Version: 2.0.0
# Description: For every .csproj under the target directory, optionally rewrites
#              <TargetFramework>/<TargetFrameworks> and <LangVersion> declarations,
#              gates on `dotnet restore`, then runs `dotnet outdated --upgrade`.
# Usage: cs-references-update.sh [REPO_DIR] [--framework <tfm>] [--lang-version <ver>] [--lang-default]
# Requirements: bash, dotnet, dotnet-outdated
# Author: WorkInProgress.ai

# ============================================================================
# Exit Codes
# ============================================================================

readonly EXIT_OK=0
readonly EXIT_MISUSE=2   # bad flag / conflicting flags / unknown TFM mapping
readonly EXIT_DIR_NOT_FOUND=3      # target directory does not exist
readonly EXIT_RESTORE_FAILED=10    # dotnet restore failed after a TFM/LangVersion rewrite

# ============================================================================
# Configuration
# ============================================================================

# TFM major -> default C# language version for that TFM. When --framework is
# passed without a language flag, existing <LangVersion> tags are rewritten to
# the mapped value. A TFM missing from this map combined with present tags is
# an argument error rather than a guess.
declare -A TFM_DEFAULT_LANG=(
    ["net8.0"]="12.0"
    ["net9.0"]="13.0"
    ["net10.0"]="14.0"
)

# ============================================================================
# Usage
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [REPO_DIR] [OPTIONS]

For every .csproj under REPO_DIR (default: current directory), runs
'dotnet outdated --upgrade' to update NuGet package references.

Options:
    -h, --help              Show this help message and exit
    --framework TFM         Rewrite <TargetFramework> (and every entry of
                            <TargetFrameworks> lists) to TFM (e.g. net10.0)
                            before updating packages. Framework-first: the
                            rewrite and a 'dotnet restore' gate run before
                            'dotnet outdated'.
    --lang-version VER      Set <LangVersion> to VER (e.g. 14.0) in every
                            csproj, updating existing tags and adding the tag
                            where absent. Conflicts with --lang-default.
    --lang-default          Remove existing <LangVersion> tags (never adds) so
                            the TFM default language version applies
                            implicitly. Conflicts with --lang-version.

LangVersion rules:
    * --lang-version given  -> explicit version wins; tags updated or added.
    * --framework only      -> existing <LangVersion> tags are rewritten to the
                               TFM's default language version (net8.0 -> 12.0,
                               net9.0 -> 13.0, net10.0 -> 14.0). An unmapped
                               TFM with tags present is an argument error.
    * --lang-default given  -> tags are removed; the default applies silently.

Exits:
    0    success
    2    invalid arguments (bad flag values, conflicting flags, unknown TFM
         mapping with LangVersion tags present)
    3    target directory not found
    10   'dotnet restore' failed after a rewrite (invalid TFM or packages
         without assets for the new target)
EOF
    exit 0
}

# ============================================================================
# Argument Parsing
# ============================================================================

set -u

SCRIPT_NAME="$(basename "$0")"
target_dir=""
framework=""
lang_version=""
lang_default=0
rewrote_anything=0

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        --framework)
            [[ $# -ge 2 && -n "${2:-}" ]] || { echo "ERROR: --framework requires a value (e.g. net10.0)" >&2; exit "$EXIT_MISUSE"; }
            framework="$2"
            shift 2
            ;;
        --lang-version)
            [[ $# -ge 2 && -n "${2:-}" ]] || { echo "ERROR: --lang-version requires a value (e.g. 14.0)" >&2; exit "$EXIT_MISUSE"; }
            lang_version="$2"
            shift 2
            ;;
        --lang-default)
            lang_default=1
            shift
            ;;
        -*)
            echo "ERROR: Unknown option: $1. Use --help for usage." >&2
            exit "$EXIT_MISUSE"
            ;;
        *)
            if [ -z "$target_dir" ]; then
                target_dir="$1"
            else
                echo "ERROR: Too many arguments. Use --help for usage." >&2
                exit "$EXIT_MISUSE"
            fi
            shift
            ;;
    esac
done

target_dir="${target_dir:-$(pwd)}"

# ── Value validation ─────────────────────────────────────────────────────

if [ -n "$framework" ] && ! [[ "$framework" =~ ^net[0-9]+\.0$ ]]; then
    echo "ERROR: --framework value '$framework' does not look like a TFM (expected net<N>.0, e.g. net10.0)" >&2
    exit "$EXIT_MISUSE"
fi

if [ -n "$lang_version" ] && ! [[ "$lang_version" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "ERROR: --lang-version value '$lang_version' does not look like a C# version (expected <N>[.<M>], e.g. 14.0)" >&2
    exit "$EXIT_MISUSE"
fi

if [ "$lang_default" -eq 1 ] && [ -n "$lang_version" ]; then
    echo "ERROR: --lang-default and --lang-version are mutually exclusive." >&2
    exit "$EXIT_MISUSE"
fi

if [ ! -d "$target_dir" ]; then
    echo "ERROR: Directory not found: $target_dir" >&2
    exit "$EXIT_DIR_NOT_FOUND"
fi

# ── Resolve the effective LangVersion mode ───────────────────────────────
#
# Three modes:
#   mode=explicit : $lang_version is the target; tags updated or added.
#   mode=tfm-map  : $lang_version is the mapped TFM default; tags rewritten,
#                   never added (repos without tags stay without).
#   mode=remove   : tags are removed, never added.

lang_mode="none"
if [ -n "$lang_version" ]; then
    lang_mode="explicit"
elif [ "$lang_default" -eq 1 ]; then
    lang_mode="remove"
elif [ -n "$framework" ]; then
    # --framework without a language flag: check the map before touching files.
    if [ -z "${TFM_DEFAULT_LANG[$framework]+x}" ]; then
        if grep -rql --include='*.csproj' '<LangVersion>' "$target_dir" 2>/dev/null; then
            echo "ERROR: TFM '$framework' has no mapped default C# language version, but <LangVersion> tags exist in the tree. Supported TFMs: ${!TFM_DEFAULT_LANG[*]}. Pass --lang-version or --lang-default explicitly." >&2
            exit "$EXIT_MISUSE"
        fi
    else
        lang_version="${TFM_DEFAULT_LANG[$framework]}"
        lang_mode="tfm-map"
    fi
fi

cd "$target_dir" || { echo "Directory not found: $target_dir" >&2; exit "$EXIT_DIR_NOT_FOUND"; }

# ============================================================================
# TFM / LangVersion Rewrite
# ============================================================================

# Escape a replacement string for the right-hand side of a sed s||| expression
# (escapes | and &).
sed_escape_replacement() {
    printf '%s' "$1" | sed -e 's/[|&]/\\&/g'
}

# Rewrite <TargetFramework> and every entry of <TargetFrameworks> lists in one
# csproj. Only called when --framework was passed.
rewrite_tfm() {
    local csproj="$1"
    create_temp_file tmp cs-ref-update
    # shellcheck disable=SC2154  # tmp assigned by create_temp_file (printf -v)
    sed -E "s|<TargetFrameworks?>([^<]*)</TargetFrameworks?>|$(sed_escape_replacement "<TargetFramework>$framework</TargetFramework>")|g" "$csproj" > "$tmp"
    # shellcheck disable=SC2154  # tmp assigned by create_temp_file (printf -v)
    if ! cmp -s "$csproj" "$tmp"; then
        cp "$tmp" "$csproj"
        rewrote_anything=1
        echo "  $csproj: TargetFramework -> $framework"
    fi
}

# Rewrite <LangVersion> per the active mode (explicit / tfm-map / remove).
rewrite_lang() {
    local csproj="$1"
    create_temp_file tmp cs-ref-update

    if [ "$lang_mode" = "remove" ]; then
        sed -E '/^[[:space:]]*<LangVersion>[^<]*<\/LangVersion>[[:space:]]*$/d' "$csproj" > "$tmp"
    else
        # Replace existing tags (any value) with the target version.
        sed -E "s|<LangVersion>[^<]*</LangVersion>|$(sed_escape_replacement "<LangVersion>$lang_version</LangVersion>")|g" "$csproj" > "$tmp"
        # Explicit mode only: add the tag after <TargetFramework…> when absent,
        # preserving the element's indentation.
        if ! grep -q '<LangVersion>' "$tmp" && [ "$lang_mode" = "explicit" ]; then
            sed -E "s|^([[:space:]]*)(<TargetFrameworks?>[^<]*</TargetFrameworks?>)|\1\2\n\1<LangVersion>$lang_version</LangVersion>|" "$tmp" > "$tmp.add"
            mv "$tmp.add" "$tmp"
        fi
    fi

    if ! cmp -s "$csproj" "$tmp"; then
        cp "$tmp" "$csproj"
        rewrote_anything=1
        case "$lang_mode" in
            remove)  echo "  $csproj: LangVersion tag removed" ;;
            *)       echo "  $csproj: LangVersion -> $lang_version" ;;
        esac
    fi
}

if [ -n "$framework" ] || [ "$lang_mode" != "none" ]; then
    echo "Rewriting target framework / language version declarations..."
    while IFS= read -r -d '' csproj; do
        [ -n "$framework" ] && rewrite_tfm "$csproj"
        [ "$lang_mode" != "none" ] && rewrite_lang "$csproj"
    done < <(find . -name '*.csproj' \
        -not -path '*/obj/*' -not -path '*/bin/*' -print0)
fi

# ============================================================================
# Restore Gate
# ============================================================================

if [ "$rewrote_anything" -eq 1 ]; then
    echo "Running 'dotnet restore' gate after rewrite..."
    if ! dotnet restore; then
        echo "ERROR: 'dotnet restore' failed after rewriting TFM/LangVersion — the new target is invalid or some packages have no assets for it. No package updates were attempted." >&2
        exit "$EXIT_RESTORE_FAILED"
    fi
fi

# ============================================================================
# Package Updates
# ============================================================================

# Capture the tree state before updating: the boilerplate chain below must
# only fire when THIS script changed something — not when the tree was
# already dirty with unrelated in-flight work.
tree_was_dirty_before=0
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    tree_was_dirty_before=1
fi

updates_output="$(mktemp)"
trap 'rm -f "$updates_output"' EXIT

# Per-project loop: tag each csproj's output with its path so the summary can
# classify updates as src/ vs test/. Pre-upgrade "Pkg  cur -> latest" lines are
# parsed per file: dotnet-outdated prints the latest-available table BEFORE
# upgrading, so classification (major/minor/patch) reflects what was applied.
find . -name '*.csproj' -not -path '*/obj/*' -not -path '*/bin/*' -print0 | while IFS= read -r -d '' csproj; do
  echo "<<<PROJECT $csproj>>>"
  dotnet outdated "$csproj" --upgrade
done | tee "$updates_output"

updated_anything=$(grep -cE 'upgraded successfully|is up to date with [a-f0-9]{7
,}' "$updates_output" 2>/dev/null || true)
# The per-project dotnet-outdated banner repeats per csproj; collapse it.
if [ "${updated_anything:-0}" -eq 0 ] && grep -q "No outdated dependencies" "$updates_output"; then
    echo "No package updates applied."
fi

# ============================================================================
# Update summary — colored classification + src/ (non-test) digest
# ============================================================================
#
# dotnet-outdated strips its own ANSI colors when stdout is not a TTY (our
# capture), so classification is computed here from the version triple the
# tool prints per package: "Package  current -> latest". Colors: red = major
# (breaking), yellow = minor, green = patch. Emojis: 💥 / ✨ / 🩹. The digest
# covers only packages from projects under src/ — test-tree updates don't
# change what package consumers see.

summarize_updates() {
    grep '<<<PROJECT ' "$updates_output" >/dev/null 2>&1 || return 0

    python3 - "$updates_output" <<'PYEOF'
import os
import re
import sys

log_path = sys.argv[1]
with open(log_path, encoding="utf-8", errors="replace") as fh:
    lines = fh.read().splitlines()

# Semantic version bump classification: compares the numeric components of
# the current and latest versions. Returns "major", "minor", or "patch".
def classify(current: str, latest: str) -> str:
    def nums(v: str):
        return [int(x) for x in re.findall(r"\d+", v)[:3]]
    cur, lat = nums(current), nums(latest)
    while len(cur) < 3:
        cur.append(0)
    while len(lat) < 3:
        lat.append(0)
    if lat[0] != cur[0]:
        return "major"
    if lat[1] != cur[1]:
        return "minor"
    return "patch"

RED, YELLOW, GREEN, BOLD, RESET = "\033[31m", "\033[33m", "\033[32m", "\033[1m", "\033[0m"
EMOJI = {"major": "💥", "minor": "✨", "patch": "🩹"}
COLOR = {"major": RED, "minor": YELLOW, "patch": GREEN}

# Package line under --upgrade: "  PackageName  1.2.3 -> 4.5.6" (indent 2+).
pkg_re = re.compile(r"^\s{2,}(\S+)\s+(\S+)\s+->\s+(\S+)\s*$")

# Blast radius = unique package updates from src/ projects. The same package
# version bump appears once per consuming project (and again in test/
# projects); the summary reports each distinct package+version-transition
# once. Test-tree updates are consumers, not deliverables — excluded entirely.
src_counts = {"major": 0, "minor": 0, "patch": 0}
current_proj = ""
seen_src = {}  # (package, current, latest) -> kind

for line in lines:
    m = re.match(r"^<<<PROJECT (.+?)>>>$", line)
    if m:
        current_proj = m.group(1).replace("\\", "/")
        continue
    pm = pkg_re.match(line)
    if not pm:
        continue
    package, current, latest = pm.group(1), pm.group(2), pm.group(3)
    if not "/src/" in f"/{current_proj}":
        continue  # test (and any non-src) consumers are excluded
    key = (package, current, latest)
    if key in seen_src:
        continue  # same package bump already reported from another project
    kind = classify(current, latest)
    seen_src[key] = kind
    src_counts[kind] += 1

# Unique src/ package updates, colored by blast radius, alphabetical so the
# same package family groups together.
if seen_src:
    print()
    print(f"{BOLD}Package updates this run (src/):{RESET}")
    for (package, current, latest), kind in sorted(seen_src.items()):
        print(f"  {EMOJI[kind]} {COLOR[kind]}{package}: {current} -> {latest}{RESET} ({kind})")

print()
print(f"{BOLD}Blast radius — {len(seen_src)} unique package update(s) in src/:{RESET}")
if src_counts["major"] == 0 and src_counts["minor"] == 0 and src_counts["patch"] == 0:
    print("  ✅ No src/ package updates")
else:
    if src_counts["major"]:
        print(f"  💥 {RED}{src_counts['major']} breaking (major){RESET}")
    if src_counts["minor"]:
        print(f"  ✨ {YELLOW}{src_counts['minor']} feature (minor){RESET}")
    if src_counts["patch"]:
        print(f"  🩹 {GREEN}{src_counts['patch']} fix (patch){RESET}")
PYEOF
}

summarize_updates

# ============================================================================
# Boilerplate sync chain
# ============================================================================

# Chain the repo's boilerplate updater (if present) so dependency updates and
# template sync happen in one pass. Always delegate the run/don't-run decision
# to update.sh itself, via --force when needed: its dirty-tree guard runs in
# its main() before any sync work, so a tree dirtied by THIS script's own
# upgrades would otherwise kill the chain mid-run — pass --force so the sync
# proceeds (the changes mixed into the tree are this run's own upgrades).
# Pre-existing dirt (before this script ran) means the sync would mix
# unrelated local work, so the chain is skipped with a NOTE instead.
# Unattended-safe: non-fatal when absent or failing.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$repo_root" ] && [ -x "$repo_root/.repo/update.sh" ]; then
    chain_args=(--no-refresh)
    if [ "$tree_was_dirty_before" -eq 1 ]; then
        echo "Chaining .repo/update.sh — note: tree was dirty before this run, so its boilerplate sync will be skipped (its lockfile migration still runs)."
    else
        # Tree was clean before this run; any dirt now is from this script's
        # own upgrades, so --force is safe and keeps the chain alive.
        chain_args+=(--force)
    fi
    chain_output="$(mktemp)"
    if ! "$repo_root/.repo/update.sh" "${chain_args[@]}" >"$chain_output" 2>&1; then
        if grep -q "Working tree is not clean" "$chain_output"; then
            echo "NOTE: .repo/update.sh deferred its boilerplate sync (dirty tree) — its lockfile migration ran. Re-run it after committing to complete the sync."
        else
            echo "WARNING: .repo/update.sh failed — output:" >&2
            cat "$chain_output" >&2
        fi
    fi
    rm -f "$chain_output"
fi

exit "$EXIT_OK"

