#!/usr/bin/env bash
# skill-orient.sh - Shared orientation stanza for devenv skills.
#
# Returns a compact JSON blob: active plan (path + census), scoped TODO markers
# in the declared scope, git staging counts, and a working-tree provenance hint.
# Read-only and bounded: one git-status parse, one marker scan, one plan-parse
# census. No exploration, no network.
#
# Usage: skill-orient [--scope <paths...>] [--plan <plan-file>]
#   --scope  paths for the marker scan and status focus (default: repo root)
#   --plan   plan file to census (default: newest Plan-*.md in .local-artifacts/)

set -euo pipefail

SCOPE=()
PLAN=""

while [ $# -gt 0 ]; do
    case "$1" in
        --scope) shift; SCOPE+=("$1"); shift ;;
        --plan)  shift; PLAN="$1"; shift ;;
        -h|--help)
            cat <<'EOF'
Usage: skill-orient [--scope <paths...>] [--plan <plan-file>]

Emits a JSON orientation blob:
  { "plan": {...}|null, "todos": [...], "staged": N, "unstaged": N,
    "untracked": N, "provenance_hint": "..." }

Read-only. No exploration, no network.
EOF
            exit 0 ;;
        *) SCOPE+=("$1"); shift ;;
    esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || repo_root="$PWD"
scope_args=()
if [ ${#SCOPE[@]} -gt 0 ]; then
    scope_args=("${SCOPE[@]}")
else
    scope_args=("$repo_root")
fi

# --- git staging counts --------------------------------------------------------
staged=$(git -C "$repo_root" diff --cached --name-only | wc -l)
unstaged=$(git -C "$repo_root" diff --name-only | wc -l)
untracked=$(git -C "$repo_root" ls-files --others --exclude-standard | wc -l)
provenance="run files plus $( [ "$untracked" -gt 0 ] && echo "$untracked untracked" || echo "no untracked") paths; review with git status"

# --- plan discovery ------------------------------------------------------------
plan_json="null"
if [ -z "$PLAN" ]; then
    newest="$(ls -t "$repo_root"/.local-artifacts/Plan-*.md 2>/dev/null | head -1 || true)"
    [ -n "$newest" ] && PLAN="$newest"
fi
if [ -n "$PLAN" ] && [ -f "$PLAN" ]; then
    census="$(plan-parse "$PLAN" --census 2>/dev/null || echo '{}')"
    plan_json=$(python3 - "$PLAN" "$census" <<'PYEOF'
import json, sys
plan, census = sys.argv[1], sys.argv[2]
try:
    c = json.loads(census).get("totals", {})
except Exception:
    c = {}
print(json.dumps({"path": plan, "done": c.get("done", 0),
                  "total": c.get("tasks", 0), "open": c.get("open", 0)}))
PYEOF
)
fi

# --- scoped TODO markers --------------------------------------------------------
todos_json="[]"
marker_out="$(devenv-marker-check --todo-report "${scope_args[@]}" 2>/dev/null || true)"
todos_json=$(python3 - "$marker_out" <<'PYEOF'
import json, re, sys
out = sys.argv[1]
hits = re.findall(r"^(\S+?):(\d+):(.+)$", out, re.M)
print(json.dumps([{"file": f, "line": int(l), "text": t.strip()[:120]} for f, l, t in hits]))
PYEOF
)

cat <<EOF
{
  "plan": $plan_json,
  "todos": $todos_json,
  "staged": $staged,
  "unstaged": $unstaged,
  "untracked": $untracked,
  "provenance_hint": "$provenance"
}
EOF
