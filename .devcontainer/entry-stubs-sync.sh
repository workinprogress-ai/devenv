#!/bin/bash
# entry-stubs-sync.sh — single idempotent owner of the tools/ depth-1 entries.
#
# Contract: every script in tools/scripts/, tools/fork/ and tools/custom/ gets a
# depth-1 stub in tools/, and every depth-1 entry backed by one of them is a stub.
#
# Override model: the three directories are three layers of one tool set.
#   tools/scripts/  the provided tools
#   tools/fork/     a fork's own or overriding tools (committed in the fork)
#   tools/custom/   a user's own or overriding tools (gitignored, machine-local)
# A file with the same name in a higher layer replaces the lower one:
# custom over fork over provided. Each stub is written at sync time and points at
# the winning file, so adding or removing an override needs a re-run of this
# script (bootstrap runs it).
#
# Exceptions:
#   - Underscore-prefixed scripts (_*.sh) are internal: NO depth-1 entry is
#     created for them, so they cannot be overridden through this mechanism;
#     callers reference tools/scripts/<name>.sh directly. Stale stubs for them
#     are removed.
#   - tools/tests/run-devenv-tests.sh also gets a depth-1 entry (the one
#     non-scripts/ script with a public entry point).
# Anything else at depth-1 is not ours and is left untouched.
#
# Stub template (one line of dispatch, then exec; <dir> is scripts, fork or custom):
#   #!/bin/bash
#   exec bash "$(dirname "$0")/<dir>/<file>" "$@"
#
# Idempotent: a re-run on a synchronized tree changes nothing (verified no-op).
# Handles: missing entries (created), stale symlinks (converted), drifted
# real-file copies of a script, recognised by their shebang (converted: the
# winning source is canonical). A document or data file that merely shares a
# tool's name is not a copy and is left alone with a warning.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
toolbox_root="$(cd "$script_dir/.." && pwd)"
tools_dir="$toolbox_root/tools"

created=0
converted=0
already=0
removed=0

make_stub() {
    local entry="$1" target_rel="$2" tmp
    # Write a temporary file and rename it over the entry. The rename replaces the
    # directory entry without ever writing through the old inode (a hardlink to a source
    # script shares it), leaves no moment with the entry missing, and keeps the old entry
    # when the write fails.
    tmp="$entry.tmp.$$"
    if ! { cat > "$tmp" <<EOF
#!/bin/bash
exec bash "\$(dirname "\$0")/$target_rel" "\$@"
EOF
    } || ! chmod 755 "$tmp" || ! mv -f "$tmp" "$entry"; then
        rm -f "$tmp"
        echo "entry-stubs-sync: could not write $entry" >&2
        return 1
    fi
}

# Only .sh scripts and git-* scripts get depth-1 entries; everything else in
# these directories is support content. Layers are applied lowest first so a
# higher layer's file replaces the same-named one below it.
declare -A winner=()
for layer in scripts fork custom; do
    for script in "$tools_dir/$layer"/*.sh "$tools_dir/$layer"/git-*; do
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
        # A name is written into a generated script and becomes a path under tools/:
        # only plain names qualify (letters, digits, dot, dash, underscore, not
        # starting with a dot), so a filename can never be interpreted by the stub.
        if ! [[ "$base" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || [ -z "$name" ]; then
            echo "entry-stubs-sync: skipping $layer/$base: not a plain tool name" >&2
            continue
        fi
        # A tool whose name is an existing tools/ directory (lib, config, tests, ...)
        # cannot have an entry there.
        if [ -d "$tools_dir/$name" ] && [ ! -L "$tools_dir/$name" ]; then
            echo "entry-stubs-sync: skipping $layer/$base: tools/$name is a directory" >&2
            continue
        fi
        winner["$name"]="$layer/$base"
    done
done

for name in "${!winner[@]}"; do
    target_rel="${winner[$name]}"
    entry="$tools_dir/$name"
    expected_stub_line="exec bash \"\$(dirname \"\$0\")/$target_rel\" \"\$@\""

    if [ -L "$entry" ]; then
        rm -f "$entry"
        make_stub "$entry" "$target_rel"
        converted=$((converted + 1))
    elif [ -f "$entry" ]; then
        if grep -qF "$expected_stub_line" "$entry" 2>/dev/null; then
            already=$((already + 1))
        elif grep -qE '^exec bash ' "$entry" 2>/dev/null || [ "$(head -c 2 "$entry" 2>/dev/null)" = "#!" ]; then
            # a stub for a source that no longer wins, or a drifted copy of a script —
            # the winning source is canonical
            make_stub "$entry" "$target_rel"
            converted=$((converted + 1))
        else
            # a document or data file that happens to share the tool's name is not ours
            echo "entry-stubs-sync: leaving tools/$name alone: it is a file that is not a script or stub" >&2
        fi
    else
        make_stub "$entry" "$target_rel"
        created=$((created + 1))
    fi
done

# Purge stale stubs: any depth-1 file whose content is an exact stub template
# pointing at a scripts/, fork/ or custom/ target that no longer exists (renamed
# or deleted script, removed override) is removed. This covers the extensionless
# git-* tools as well as the .sh ones, and the underscore-prefixed entries made
# under an earlier contract. Non-stub files are foreign and left alone.
for entry in "$tools_dir"/*; do
    [ -f "$entry" ] || [ -L "$entry" ] || continue
    # Exact-stub contract: the file must be ONLY the exec line (header plus
    # one stub line, nothing else). Multi-line hand-rolled wrappers are
    # foreign and left alone even when their target has vanished.
    [ "$(wc -l < "$entry")" -le 2 ] || continue
    grep -qE '^exec bash "\$\(dirname "\$0"\)/(scripts|fork|custom)/[^"]+" "\$@"$' "$entry" 2>/dev/null || continue
    target_rel=$(grep -oE '(scripts|fork|custom)/[^"]+' "$entry" | head -n 1)
    [ -n "$target_rel" ] || continue
    if [ ! -f "$tools_dir/$target_rel" ] || [[ "$(basename "$target_rel")" == _* ]]; then
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
