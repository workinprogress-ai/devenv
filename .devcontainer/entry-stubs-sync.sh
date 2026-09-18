#!/bin/bash
# entry-stubs-sync.sh — single idempotent owner of the tools/ depth-1 entries.
#
# Contract (Plan-005): every file in tools/scripts/ gets a depth-1 stub in
# tools/, and every depth-1 entry backed by a tools/scripts/ file is a stub.
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

make_stub() {
    local entry="$1" target_file="$2"
    cat > "$entry" <<EOF
#!/bin/bash
exec bash "\$(dirname "\$0")/scripts/$(basename "$target_file")" "\$@"
EOF
    chmod +x "$entry"
}

# Only .sh scripts and git-* scripts get depth-1 entries (mirrors the old
# bootstrap sets); everything else in tools/scripts/ is support content.
for script in "$scripts_dir"/*.sh "$scripts_dir"/git-*; do
    [ -f "$script" ] || continue
    base=$(basename "$script")
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
        make_stub "$entry" "$script"
        converted=$((converted + 1))
    elif [ -f "$entry" ]; then
        if grep -qF "$expected_stub_line" "$entry" 2>/dev/null; then
            already=$((already + 1))
        else
            # drifted real-file copy of a tools/scripts/ twin — scripts/ is canonical
            make_stub "$entry" "$script"
            converted=$((converted + 1))
        fi
    else
        make_stub "$entry" "$script"
        created=$((created + 1))
    fi
done

echo "entry-stubs-sync: created=$created converted=$converted already-ok=$already"
