#!/bin/bash
# entry-stubs-sync.sh — single idempotent owner of the tools/ depth-1 entries.
#
# Contract: every file in tools/scripts/ gets a depth-1 stub in tools/, and
# every depth-1 entry backed by a tools/scripts/ file is a stub.
# Exceptions:
#   - Underscore-prefixed scripts (_*.sh) are internal: NO depth-1 entry is
#     created for them — they are never called directly; callers reference
#     tools/scripts/<name>.sh directly. Stale stubs for them are removed.
#   - tools/tests/run-devenv-tests.sh also gets a depth-1 entry (the one
#     non-scripts/ script with a public entry point).
# Anything else at depth-1 is not ours and is left untouched.
#
# Stub template (one line of dispatch, then exec):
#   #!/bin/bash
#   exec bash "$(dirname "$0")/scripts/<file>" "$@"
#
# Idempotent: a re-run on a synchronized tree changes nothing (verified no-op).
# Handles: missing entries (created), stale symlinks (converted), drifted
# real-file copies (converted — tools/scripts/ is canonical).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
toolbox_root="$(cd "$script_dir/.." && pwd)"
scripts_dir="$toolbox_root/tools/scripts"
tools_dir="$toolbox_root/tools"

created=0
converted=0
already=0
removed=0

make_stub() {
    local entry="$1" target_rel="$2"
    cat > "$entry" <<EOF
#!/bin/bash
exec bash "\$(dirname "\$0")/$target_rel" "\$@"
EOF
    chmod +x "$entry"
}

# Only .sh scripts and git-* scripts get depth-1 entries (mirrors the old
# bootstrap sets); everything else in tools/scripts/ is support content.
for script in "$scripts_dir"/*.sh "$scripts_dir"/git-*; do
    [ -f "$script" ] || continue
    base=$(basename "$script")
    # Internal tooling: underscore-prefixed scripts never get depth-1
    # entries — callers reference tools/scripts/<name>.sh directly.
    case "$base" in
        _*) continue ;;
    esac
    # Depth-1 entry name = script stem for .sh files (alpha.sh -> alpha);
    # non-.sh files (git-*) keep their full name.
    if [[ "$base" == *.sh ]]; then
        name="${base%.sh}"
    else
        name="$base"
    fi
    entry="$tools_dir/$name"
    expected_stub_line="exec bash \"\$(dirname \"\$0\")/scripts/$base\" \"\$@\""

    if [ -L "$entry" ]; then
        rm -f "$entry"
        make_stub "$entry" "scripts/$base"
        converted=$((converted + 1))
    elif [ -f "$entry" ]; then
        if grep -qF "$expected_stub_line" "$entry" 2>/dev/null; then
            already=$((already + 1))
        else
            # drifted real-file copy of a tools/scripts/ twin — scripts/ is canonical
            make_stub "$entry" "scripts/$base"
            converted=$((converted + 1))
        fi
    else
        make_stub "$entry" "scripts/$base"
        created=$((created + 1))
    fi
done

# Purge stale stubs for underscore-prefixed scripts (created under the old
# contract): only exact stub-template matches are removed — anything else
# at depth-1 is foreign and left alone.
for entry in "$tools_dir"/_*; do
    [ -f "$entry" ] || [ -L "$entry" ] || continue
    if grep -qE '^exec bash "\$\(dirname "\$0"\)/scripts/_[A-Za-z0-9_-]+\.sh" "\$@"$' "$entry" 2>/dev/null; then
        rm -f "$entry"
        removed=$((removed + 1))
    fi
done

# Public entry point for the test runner (the one non-scripts/ script).
runner_src="$toolbox_root/tools/tests/run-devenv-tests.sh"
runner_entry="$tools_dir/run-devenv-tests"
if [ -f "$runner_src" ]; then
    expected_runner_line='exec bash "$(dirname "$0")/tests/run-devenv-tests.sh" "$@"'
    if [ -L "$runner_entry" ]; then
        rm -f "$runner_entry"
        make_stub "$runner_entry" "tests/run-devenv-tests.sh"
        converted=$((converted + 1))
    elif [ -f "$runner_entry" ]; then
        if grep -qF "$expected_runner_line" "$runner_entry" 2>/dev/null; then
            already=$((already + 1))
        else
            make_stub "$runner_entry" "tests/run-devenv-tests.sh"
            converted=$((converted + 1))
        fi
    else
        make_stub "$runner_entry" "tests/run-devenv-tests.sh"
        created=$((created + 1))
    fi
fi

echo "entry-stubs-sync: created=$created converted=$converted already-ok=$already removed=$removed"
