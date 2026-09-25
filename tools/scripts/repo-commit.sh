#!/usr/bin/env bash
# repo-commit.sh - The single sanctioned commit wrapper. Interactive-only by design.
#
# Contract (copilot-instructions.md §7):
#   - Suggested message comes in on argv or via --file; the user's configured git editor ALWAYS opens.
#   - The commit is created from the EXISTING index only, and only if the editor session
#     produces a non-empty message (i.e. the user saved). Abort (empty message) = no commit.
#   - There is NO non-interactive path. -m/--message/--yes and editor-bypass env are refused.
#   - --wip delegates to git-wip (stage-all, hooks bypassed, WIP: prefix, push, refs/wip/last);
#     WIP commit shape lives in git-wip alone. The editor gate does not apply to this lane:
#     git-wip has no editor step, so invoking --wip IS the confirmation.
#   - This tool never stages (except via the --wip delegation), never tests, never checks hooks.
#
# Only /devenv-commit may invoke this tool (governance rule; not technically enforceable).

set -euo pipefail


usage() {
    cat <<'EOF'
Usage: repo-commit "<suggested commit message>"
       repo-commit --file <message-file>
       repo-commit --wip ["<wip message words...>"] [--file <message-file>] [--staged-only]

Opens the user's configured git editor pre-loaded with the suggested message.
Commits the existing index only if the editor session yields a non-empty message.

  --file <path>   Read the suggested message from a file (verbatim; use for long
                  messages instead of a giant argv string).
  --wip           WIP snapshot lane: delegates to git-wip (stages everything unless
                  --staged-only, hooks bypassed, "WIP: " prefix added by git-wip,
                  pushes, records refs/wip/last). No editor step — the invocation is
                  the confirmation.

Refuses (normal lane):
  - any option other than --file (there is no -m, no --yes, no non-interactive path)
  - a finally resolved editor that is a non-interactive command (true, :, echo, cat, exit)
  - an empty index (nothing staged)

A non-interactive GIT_EDITOR/core.editor value inherited from the environment is
TREATED AS UNSET (resolution falls through to the next source) — automation hosts
inject no-op editors like ':' into terminals; the user's own git config must
outrank them. Only when the RESOLVED editor is non-interactive is the commit
refused: the editor save is the permission gate.

Never stages (except via the --wip delegation to git-wip), never runs tests, never
inspects hooks.
Only /devenv-commit may invoke this tool.
EOF
}

die() {
    echo "repo-commit: $*" >&2
    exit 1
}

# True when the editor's BASE command is a known non-interactive no-op (an env
# sentinel or config value that would bypass the editor gate entirely).
editor_is_noninteractive() {
    local editor_base
    editor_base="$(printf '%s' "${1:-}" | awk '{print $1}')"
    editor_base="$(basename "${editor_base:-}")"
    case "$editor_base" in
        true|':'|'.'|exit|echo|cat|tee|touch|rm|sleep) return 0 ;;
        *) return 1 ;;
    esac
}

# --- Argument parsing: message via argv or --file; --wip delegates to git-wip. -
msgfile_arg=""
wip_lane=false
wip_args=()
rest=()
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --file)
            [ -n "${2:-}" ] || die "--file requires a path argument"
            msgfile_arg="$2"
            shift
            ;;
        --wip)
            wip_lane=true
            ;;
        --staged-only)
            if [ "$wip_lane" = true ]; then
                wip_args+=("$1")
            else
                die "options are refused by design ('$1'); there is no non-interactive path"
            fi
            ;;
        -*)
            die "options are refused by design ('$1'); there is no non-interactive path"
            ;;
        *)
            if [ "$wip_lane" = true ]; then
                wip_args+=("$1")
            else
                rest+=("$1")
            fi
            ;;
    esac
    shift
done

# --- WIP lane: delegate to git-wip; WIP commit shape lives there alone. -------
if [ "$wip_lane" = true ]; then
    if [ -n "$msgfile_arg" ]; then
        wip_args+=(--file "$msgfile_arg")
    fi
    GIT_WIP="$(dirname "$0")/git-wip"
    [ -x "$GIT_WIP" ] || GIT_WIP="git-wip"   # fall back to PATH entry
    exec bash "$GIT_WIP" "${wip_args[@]}"
fi

if [ -n "$msgfile_arg" ]; then
    [ ${#rest[@]} -eq 0 ] || die "--file and a positional message are mutually exclusive"
    [ -f "$msgfile_arg" ] || die "message file not found: $msgfile_arg"
    suggested="$(cat "$msgfile_arg")"
    [ -n "$suggested" ] || die "message file is empty: $msgfile_arg"
else
    if [ ${#rest[@]} -eq 0 ]; then
        usage >&2
        die "a suggested commit message is required as the only argument (or pass --file <message-file>)"
    fi
    [ ${#rest[@]} -eq 1 ] || die "exactly one argument (the suggested message) or --file is required"
    suggested="${rest[0]}"
fi

# --- Refuse an empty index (staging stays 100% manual). -----------------------
if git diff --cached --quiet; then
    die "nothing is staged — staging is manual; use git add yourself, then re-run"
fi

# --- Resolve the editor: VS Code first, nano fallback (user ruling). ----------
# Non-interactive values are treated as UNSET: automation hosts inject no-op
# editors (GIT_EDITOR=:) into terminals; the user's own core.editor must outrank
# them. The gate below still refuses if EVERY source resolves non-interactive.
editor=""
for candidate in \
    "${GIT_EDITOR:-}" \
    "$(git config --get core.editor 2>/dev/null || true)" \
    "$(command -v code >/dev/null 2>&1 && printf 'code --wait')" \
    "$(command -v nano >/dev/null 2>&1 && printf 'nano')" \
    "${VISUAL:-}" \
    "${EDITOR:-}"; do
    [ -n "$candidate" ] || continue
    if ! editor_is_noninteractive "$candidate"; then
        editor="$candidate"
        break
    fi
done

if [ -z "$editor" ]; then
    die "refusing non-interactive editor — the editor save is the permission gate"
fi
# --- Launch the editor with the suggested message; commit only on save. -------
# msgfile is a temp file for the editor session — removed on exit via the trap below.
msgfile="$(mktemp "${TMPDIR:-/tmp}/repo-commit-msg.XXXXXX")"
trap 'rm -f "$msgfile"' EXIT
printf '%s\n' "$suggested" > "$msgfile"

# GIT_EDITOR must win over any config for this invocation; export explicitly.
if [ -n "$editor" ]; then
    export GIT_EDITOR="$editor"
else
    export GIT_EDITOR=''  # git falls back to its own defaults (vi etc.)
fi

# --edit forces the editor open on the supplied message; without it git skips the
# editor entirely — the editor open IS the permission gate. git aborts the commit
# when the editor session empties the message; that abort IS the cancel path.
# git's stdout/stderr are passed through UNREDIRECTED: terminal editors (nano, vi)
# draw their UI on the TTY, and discarding output makes the editor run invisibly —
# indistinguishable from a hang. The one-line notice tells the user which editor
# is taking over the terminal.
echo "repo-commit: opening editor: $editor  (save & close to commit; empty/abort cancels)"
if ! git commit --cleanup=strip --edit -F "$msgfile"; then
    die "commit did not complete (editor session aborted or git failed) — index left untouched"
fi

# --- Confirm outcome honestly. ------------------------------------------------
if git diff --cached --quiet; then
    echo "repo-commit: commit created."
    git log -1 --format='repo-commit: %h %s'
else
    die "commit did not complete — index left untouched"
fi
