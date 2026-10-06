#!/usr/bin/env bash
# lint-skills.sh - Deterministic contract checker for the copilot/skills tree.
#
# Checks (fail = exit 1):
#   SK001  frontmatter: valid --- block with name:/description:/user-invocable:
#   SK002  frontmatter name: matches the skill's directory name
#   SK003  description length: warn > 1200 chars, fail > 2000 chars
#   SK004  every /devenv-<name> reference resolves to a real skill directory
#          (registry, catalogs, guru, docs); every skill directory appears in
#          the registry (ghosts and orphans both fail)
#   SK005  all relative ../devenv-*/ links in skill files resolve
#   SK006  renamed-name history: none of the retired skill names appear in
#          tracked files
#   SK009  every file under a references/ folder is mentioned (by file name)
#          somewhere else in the skill tree or docs — no orphaned references
#   SK008  cross-file markdown links whose #anchor matches no heading in the
#          target file (same-file anchors are skipped: prose examples abound)
#   SK007  stale path references: a backticked `(docs|copilot|tools|setup)/…`
#          path that the repo's git history contains but the working tree no
#          longer has (renamed/moved without a reference sweep)
#
# PATH invocation: lint-skills (via the tools/lint-skills dispatcher).
# Source lives here; this file is not invoked by path per workspace convention.

set -euo pipefail


# Retired names (skill-renames engagement). Embedded so reintroductions fail
# even if the original plan is long gone.
readonly RETIRED_NAMES=(
    devenv-code-review devenv-chat-with-code devenv-delegation
    devenv-design-discussion devenv-grooming devenv-pair-programming
    devenv-pre-commit devenv-spike devenv-tech-debt-audit devenv-triage-issue
    devenv-bug-hunter devenv-project-manager devenv-create-plan
    devenv-rubber-duck
)

WARN_LIMIT=1200
FAIL_LIMIT=2000

failures=0
warnings=0

err() { printf 'SK-FAIL %s\n' "$*"; failures=$((failures + 1)); }
warn() { printf 'SK-WARN %s\n' "$*"; warnings=$((warnings + 1)); }

usage() {
    cat <<'EOF'
Usage: lint-skills [PATH]

Deterministic contract checker for the copilot/skills tree.

Checks:
  SK001  SKILL.md frontmatter: name:/description:/user-invocable: present
  SK002  frontmatter name matches directory name
  SK003  description length (warn > 1200, fail > 2000 chars)
  SK004  /devenv-<name> references resolve; registry ↔ filesystem bidirectional
  SK005  relative ../devenv-*/ links resolve
  SK006  no retired skill names in tracked files
  SK007  no stale backticked repo-rooted path references (in git history,
         missing from the working tree)
  SK008  cross-file markdown link anchors match a heading in the target
  SK009  every references/ file is linked from somewhere (no orphans)

Exit 0 = clean (warnings allowed); exit 1 = any failure.
EOF
}

# --- locate the tree to lint: optional arg, else this repo --------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_root="$(cd "$script_dir/../.." && pwd)"
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi
repo_root="${1:-$default_root}"
# Accept either a repo root (…/copilot/skills beneath it) or a direct skills dir.
if [ -d "$repo_root/copilot/skills" ]; then
    skills_dir="$repo_root/copilot/skills"
elif [ -d "$repo_root" ] && [ -n "$(find "$repo_root" -maxdepth 1 -type d -name 'devenv-*' -print -quit)" ]; then
    skills_dir="$repo_root"
else
    echo "lint-skills: no skills tree at $repo_root" >&2
    exit 1
fi
registry="$skills_dir/devenv-help/references/skills-registry.md"

# --- SK001/SK002/SK003: per-skill frontmatter ---------------------------------
for skill_path in "$skills_dir"/devenv-*/SKILL.md; do
    [ -f "$skill_path" ] || continue
    dir="$(basename "$(dirname "$skill_path")")"
    fm="$(sed -n '1,/^---$/p' "$skill_path" | sed '1d;$d')"

    name_line="$(printf '%s\n' "$fm" | grep -E '^name: ' | head -1 || true)"
    desc_line="$(printf '%s\n' "$fm" | grep -E '^description:' | head -1 || true)"
    invoc_line="$(printf '%s\n' "$fm" | grep -E '^user-invocable:' | head -1 || true)"

    [ -n "$name_line" ] || err "SK001 $dir/SKILL.md: missing name:"
    [ -n "$desc_line" ] || err "SK001 $dir/SKILL.md: missing description:"
    [ -n "$invoc_line" ] || warn "SK001 $dir/SKILL.md: missing user-invocable: (recommended)"

    if [ -n "$name_line" ]; then
        fm_name="${name_line#name: }"
        [ "$fm_name" = "$dir" ] || err "SK002 $dir/SKILL.md: name: '$fm_name' != directory '$dir'"
    fi

    if [ -n "$desc_line" ]; then
        dlen="${#desc_line}"
        if [ "$dlen" -gt "$FAIL_LIMIT" ]; then
            err "SK003 $dir/SKILL.md: description $dlen chars (limit $FAIL_LIMIT)"
        elif [ "$dlen" -gt "$WARN_LIMIT" ]; then
            warn "SK003 $dir/SKILL.md: description $dlen chars (warn at $WARN_LIMIT)"
        fi
    fi
done

# --- SK004: registry ↔ filesystem bidirectional -------------------------------
if [ ! -f "$registry" ]; then
    err "SK004 registry missing: $registry"
else
    # registry → filesystem: every /devenv-<name> row target exists
    while read -r n; do
        [ -d "$skills_dir/$n" ] || err "SK004 registry ghost: /$n has no copilot/skills/$n directory"
    done < <(grep -oE '`?/devenv-[a-z-]+`?' "$registry" | tr -d '`/' | sort -u)
    # filesystem → registry: every skill dir appears in the registry
    for d in "$skills_dir"/devenv-*/; do
        n="$(basename "$d")"
        grep -q "/$n" "$registry" || err "SK004 registry orphan: $n missing from skills-registry.md"
    done
fi

# --- SK004b: docs/Skills.md must list every skill ------------------------------
# docs/Skills.md is the canonical full listing (reached through the shared docs
# symlink); the shared catalog file is only a pointer and carries no skill names.
skills_doc="$skills_dir/_shared/docs/Skills.md"
if [ -f "$skills_doc" ]; then
    for d in "$skills_dir"/devenv-*/; do
        n="$(basename "$d")"
        grep -q "$n" "$skills_doc" || err "SK004 skill listing: $n missing from docs/Skills.md"
    done
fi

# --- SK005: relative links resolve ---------------------------------------------
link_failures=0
while IFS= read -r -d '' f; do
    base="$(dirname "$f")"
    while IFS= read -r rel; do
        target="${rel%%#*}"
        full="$(realpath -m --relative-to=. "$base/$target" 2>/dev/null || echo "$base/$target")"
        if [ ! -e "$full" ]; then
            # skip code-span examples (backticked) — not live links
            err "SK005 broken link in ${f#$repo_root/}: $rel"
            link_failures=$((link_failures + 1))
        fi
    done < <(grep -oE '\]\((\.\./)+(devenv-[a-z-]+|common|_shared)/[^)#]+' "$f" 2>/dev/null | sed 's/^](//' || true)
done < <(find "$skills_dir" -name "*.md" -not -path "*/node_modules/*" -not -name "_conventions.md" -print0)
[ "$link_failures" -eq 0 ] || true  # counted via err()

# --- SK008: cross-file anchors resolve ------------------------------------------
# A link `](path/to/file.md#anchor)` must name a heading that exists in the
# target (GitHub slug rules: lowercase, punctuation dropped except - and _,
# spaces to hyphens, -N suffix on repeated headings). Same-file anchors and
# anything in a fenced block are not checked: skill prose carries many
# illustrative examples (`[AC-N](#ac-N)`).
declare -A _heading_slugs=()
heading_slugs_of() {
    awk '
        /^```/ { fence = !fence; next }
        fence { next }
        /^#+[[:space:]]+/ {
            t = $0
            sub(/^#+[[:space:]]+/, "", t)
            sub(/[[:space:]]*#*[[:space:]]*$/, "", t)
            t = tolower(t)
            gsub(/[^a-z0-9_ -]/, "", t)
            gsub(/ /, "-", t)
            n = seen[t]++
            print (n == 0 ? t : t "-" n)
        }
    ' "$1"
}
while IFS= read -r -d '' f; do
    base="$(dirname "$f")"
    while IFS= read -r link; do
        rel="${link%%#*}"
        anchor="${link#*#}"
        [ -n "$rel" ] || continue
        target="$base/$rel"
        [ -f "$target" ] || continue   # a missing file is SK005's finding
        if [ -z "${_heading_slugs[$target]+x}" ]; then
            _heading_slugs[$target]="$(heading_slugs_of "$target")"
        fi
        printf '%s\n' "${_heading_slugs[$target]}" | grep -qxF -- "${anchor,,}" \
            || err "SK008 broken anchor in ${f#"$repo_root"/}: $rel#$anchor"
    done < <(awk '/^```/ { fence = !fence; next } !fence' "$f" \
                 | grep -oE '\]\([^)#[:space:]]+\.md#[^)[:space:]]+\)' | sed 's/^](//;s/)$//' | sort -u || true)
done < <(find "$skills_dir" -name "*.md" -not -path "*/node_modules/*" -print0)

# --- SK009: no orphaned reference files ------------------------------------------
# A file under a `references/` folder exists to be read from somewhere. If no
# other markdown file in the skill tree (or docs/) mentions its file name, it is
# dead weight that drifts silently.
while IFS= read -r -d '' ref; do
    ref_name="$(basename "$ref")"
    scope=("$skills_dir")
    [ -d "$repo_root/docs" ] && scope+=("$repo_root/docs")
    if ! grep -rlF --include='*.md' -- "$ref_name" "${scope[@]}" 2>/dev/null | grep -qvxF -- "$ref"; then
        err "SK009 orphaned reference: ${ref#"$repo_root"/} is not linked from anywhere"
    fi
done < <(find "$skills_dir" -path '*/references/*' -name '*.md' -not -path '*/node_modules/*' -print0)

# --- SK006: retired names -------------------------------------------------------
if [ -d "$repo_root/.git" ]; then
    for name in "${RETIRED_NAMES[@]}"; do
        if git -C "$repo_root" grep -qE "\b$name\b" -- ':!*.lock' ':!.local-artifacts' ':!tools/tests' ':!tools/scripts/lint-skills.sh' 2>/dev/null; then
            err "SK006 retired name reintroduced: $name"
        fi
    done
fi

# --- SK007: stale backticked path references ------------------------------------
# A backticked `(docs|copilot|tools|setup)/...` path in a markdown file is a
# reader-facing pointer. If the repo's git history contains the path but the
# working tree no longer does, the reference is stale (renamed or moved
# without a reference sweep). Paths never present in this repo's history
# (consumer-repo template names, placeholders) cannot be validated here and
# are skipped by design — history is the existence oracle, so no hand-maintained
# skip list is needed.
if [ -d "$repo_root/.git" ]; then
    # --no-renames is required: rename detection (the default) would classify a
    # renamed path as R, not D, and the deleted-path oracle would never see it.
    deleted_paths="$(git -C "$repo_root" log --no-renames --diff-filter=D --name-only --pretty=format: -- . 2>/dev/null | sort -u || true)"
    md_scope=("$skills_dir")
    if [ -d "$repo_root/docs" ]; then
        md_scope+=("$repo_root/docs")
    fi
    while IFS= read -r -d '' f; do
        while IFS= read -r p; do
            case "$p" in
                *\**|*/|*[\<\>\~\$…]*|*\ *) continue ;; # glob / bare dir / placeholder
            esac
            if [ ! -e "$repo_root/$p" ] && printf '%s\n' "$deleted_paths" | grep -qxF -- "$p"; then
                err "SK007 stale path reference in ${f#$repo_root/}: $p"
            fi
        done < <(grep -oE '`((docs|copilot|tools|setup)/[^`]+)`' "$f" 2>/dev/null | sed 's/^`//;s/`$//' | sort -u)
    done < <(find "${md_scope[@]}" -name "*.md" -not -path "*/node_modules/*" -print0)
fi

# --- summary --------------------------------------------------------------------
echo "lint-skills: $failures failure(s), $warnings warning(s)"
[ "$failures" -eq 0 ] && [ "${SK_LINT_STRICT:-0}" != "1" ] && exit 0
if [ "$failures" -gt 0 ]; then exit 1; fi
exit 0
