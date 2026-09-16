#!/usr/bin/env bash
# cli-stubs.bash - Shared PATH-stub factories for bats suites (Plan-001 task 1.3)
#
# Each stub_* function creates a fake CLI executable in TEST_TEMP_DIR/stub-bin
# and prepends that directory to PATH. Stubs are mode-driven: export the
# corresponding STUB_* variable before invoking the system under test.
#
# Conventions:
#   - Every stub logs its argv (one shell-quoted invocation per line) to
#     $TEST_TEMP_DIR/stub-calls.log so suites can assert "destructive command
#     NOT issued" by counting lines.
#   - Mode variables are read at invocation time, so a test can flip behavior
#     between run calls.
#   - mktemp-scratch via test_helper_setup is assumed (TEST_TEMP_DIR exists).

# Ensure stub bin dir exists and leads PATH. Called by every stub factory.
_stubs_ensure_bin_dir() {
    STUB_BIN_DIR="$TEST_TEMP_DIR/stub-bin"
    mkdir -p "$STUB_BIN_DIR"
    if [[ ":$PATH:" != *":$STUB_BIN_DIR:"* ]]; then
        PATH="$STUB_BIN_DIR:$PATH"
        export PATH
    fi
    STUB_CALL_LOG="$TEST_TEMP_DIR/stub-calls.log"
    export STUB_CALL_LOG
    : > "$STUB_CALL_LOG"
}

# Append a quoted argv record to the call log.
_stub_log() {
    printf '%s\n' "$*" >> "$STUB_CALL_LOG"
}

# Count invocations of a stub command recorded so far.
stub_call_count() {
    local cmd="$1"
    grep -c "^$cmd " "$STUB_CALL_LOG" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# kubectl stub
#
# Modes (export before run):
#   STUB_KUBECTL_PODS      newline-separated pod names for `get pods`
#   STUB_KUBECTL_DEPLOYS   newline-separated deployment names
#   STUB_KUBECTL_FAIL=1    every command exits 1
#   STUB_KUBECTL_DELETED   file to touch on `delete pod <name>` (records target)
#   STUB_KUBECTL_SCALED    file to touch on `scale deployment <name>` (records)
# ---------------------------------------------------------------------------
stub_kubectl() {
    _stubs_ensure_bin_dir
    cat > "$STUB_BIN_DIR/kubectl" << 'EOF'
#!/usr/bin/env bash
echo "kubectl $*" >> "${STUB_CALL_LOG:?}"
if [[ "${STUB_KUBECTL_FAIL:-0}" == "1" ]]; then
    echo "stub-kubectl: simulated failure" >&2
    exit 1
fi
case "$1 $2" in
    "get pods")
        [[ -n "${STUB_KUBECTL_PODS:-}" ]] && printf '%s\n' "${STUB_KUBECTL_PODS}" >&1
        exit 0 ;;
    "get deployments")
        [[ -n "${STUB_KUBECTL_DEPLOYS:-}" ]] && printf '%s\n' "${STUB_KUBECTL_DEPLOYS}" >&1
        exit 0 ;;
    "delete pod")
        shift 2; local_name=""; for a in "$@"; do [[ "$a" != -* ]] && { local_name="$a"; break; }; done
        [[ -n "${STUB_KUBECTL_DELETED:-}" ]] && echo "$local_name" >> "$STUB_KUBECTL_DELETED"
        exit 0 ;;
    "scale deployment")
        name="$3"
        [[ -n "${STUB_KUBECTL_SCALED:-}" ]] && echo "$name" >> "$STUB_KUBECTL_SCALED"
        exit 0 ;;
    *)
        exit 0 ;;
esac
EOF
    chmod +x "$STUB_BIN_DIR/kubectl"
}

# Convenience: emit pods/deployments as the -o json shape kube-selection
# actually consumes (name-only jq extraction is what the lib performs today;
# these fixtures provide the JSON the lib's jq program selects from).
stub_kubectl_json() {
    _stubs_ensure_bin_dir
    cat > "$STUB_BIN_DIR/kubectl" << 'EOF'
#!/usr/bin/env bash
echo "kubectl $*" >> "${STUB_CALL_LOG:?}"
if [[ "${STUB_KUBECTL_FAIL:-0}" == "1" ]]; then
    echo "stub-kubectl: simulated failure" >&2
    exit 1
fi
emit() {
    local items="" n
    for n in $1; do
        items="${items}{\"metadata\":{\"name\":\"$n\"}},"
    done
    printf '{"items":[%s]}\n' "${items%,}"
}
case "$1 $2" in
    "get pods")
        if [[ "$*" == *"-o json"* ]]; then emit "${STUB_KUBECTL_PODS:-}"; else
            [[ -n "${STUB_KUBECTL_PODS:-}" ]] && printf '%s\n' ${STUB_KUBECTL_PODS}
        fi
        exit 0 ;;
    "get deployments")
        if [[ "$*" == *"-o json"* ]]; then emit "${STUB_KUBECTL_DEPLOYS:-}"; else
            [[ -n "${STUB_KUBECTL_DEPLOYS:-}" ]] && printf '%s\n' ${STUB_KUBECTL_DEPLOYS}
        fi
        exit 0 ;;
    "delete pod")
        shift 2; for a in "$@"; do [[ "$a" != -* ]] && { [[ -n "${STUB_KUBECTL_DELETED:-}" ]] && echo "$a" >> "$STUB_KUBECTL_DELETED"; break; }; done
        exit 0 ;;
    "scale deployment")
        name="$3"
        [[ -n "${STUB_KUBECTL_SCALED:-}" ]] && echo "$name" >> "$STUB_KUBECTL_SCALED"
        exit 0 ;;
    *) exit 0 ;;
esac
EOF
    chmod +x "$STUB_BIN_DIR/kubectl"
}

# ---------------------------------------------------------------------------
# gh stub
#
# Modes:
#   STUB_GH_API_RESPONSE   file whose contents are printed for `gh api`
#   STUB_GH_FAIL=1         every invocation exits 1
#   STUB_GH_MUTATIONS      file recording `api -X PATCH/POST` argv lines
#   STUB_GH_PAGES          file holding a newline-ordered queue of page-file
#                          paths; each `gh api` call pops the first entry and
#                          prints that file's contents; an empty/exhausted
#                          queue exits 1 (simulates end of pagination)
# ---------------------------------------------------------------------------
stub_gh() {
    _stubs_ensure_bin_dir
    cat > "$STUB_BIN_DIR/gh" << 'EOF'
#!/usr/bin/env bash
echo "gh $*" >> "${STUB_CALL_LOG:?}"
if [[ "${STUB_GH_FAIL:-0}" == "1" ]]; then
    echo "stub-gh: simulated failure" >&2
    exit 1
fi
if [[ "$1" == "api" ]]; then
    # Paginated mode only when STUB_GH_PAGES points at an existing file; the
    # variable can leak into later tests in the same suite, and an absent or
    # removed queue file must fall through to the canned-response modes.
    if [[ -n "${STUB_GH_PAGES:-}" && -f "${STUB_GH_PAGES}" ]]; then
        if [[ -s "$STUB_GH_PAGES" ]]; then
            page_file=$(head -n 1 "$STUB_GH_PAGES")
            tail -n +2 "$STUB_GH_PAGES" > "$STUB_GH_PAGES.tmp" && mv "$STUB_GH_PAGES.tmp" "$STUB_GH_PAGES"
            [[ -f "$page_file" ]] && cat "$page_file"
            exit 0
        fi
        echo "stub-gh: pagination queue exhausted" >&2
        exit 1
    fi
    if [[ "$*" == *"-X PATCH"* || "$*" == *"-X POST"* ]]; then
        [[ -n "${STUB_GH_MUTATIONS:-}" ]] && echo "gh $*" >> "$STUB_GH_MUTATIONS"
        printf '{"id": 111, "html_url": "https://example.invalid/comment/111"}'
    else
        [[ -f "${STUB_GH_API_RESPONSE:-/nonexistent}" ]] && cat "$STUB_GH_API_RESPONSE"
    fi
    exit 0
fi
exit 0
EOF
    chmod +x "$STUB_BIN_DIR/gh"
}

# ---------------------------------------------------------------------------
# mongorestore / mongosh / mongodump stubs
#
# Modes:
#   STUB_MONGORESTORE_FAIL=1      restore exits 1
#   STUB_MONGORESTORE_LOG         file recording full argv
#   STUB_MONGOSH_DATABASES        newline-separated db names for the list eval
#   STUB_MONGOSH_FAIL=1           list exits 1
#   STUB_MONGODUMP_FAIL=1         dump exits 1
#   STUB_MONGODUMP_LOG            file recording full argv
# ---------------------------------------------------------------------------
stub_mongo() {
    _stubs_ensure_bin_dir
    cat > "$STUB_BIN_DIR/mongorestore" << 'EOF'
#!/usr/bin/env bash
echo "mongorestore $*" >> "${STUB_CALL_LOG:?}"
[[ -n "${STUB_MONGORESTORE_LOG:-}" ]] && echo "mongorestore $*" >> "$STUB_MONGORESTORE_LOG"
if [[ "${STUB_MONGORESTORE_FAIL:-0}" == "1" ]]; then
    echo "stub-mongorestore: simulated failure" >&2
    exit 1
fi
exit 0
EOF
    cat > "$STUB_BIN_DIR/mongosh" << 'EOF'
#!/usr/bin/env bash
echo "mongosh $*" >> "${STUB_CALL_LOG:?}"
if [[ "${STUB_MONGOSH_FAIL:-0}" == "1" ]]; then
    echo "stub-mongosh: simulated failure" >&2
    exit 1
fi
if [[ "${STUB_MONGOSH_DATABASES:-}" ]]; then
    printf '%s\n' "${STUB_MONGOSH_DATABASES}"
fi
exit 0
EOF
    cat > "$STUB_BIN_DIR/mongodump" << 'EOF'
#!/usr/bin/env bash
echo "mongodump $*" >> "${STUB_CALL_LOG:?}"
[[ -n "${STUB_MONGODUMP_LOG:-}" ]] && echo "mongodump $*" >> "$STUB_MONGODUMP_LOG"
if [[ "${STUB_MONGODUMP_FAIL:-0}" == "1" ]]; then
    echo "stub-mongodump: simulated failure" >&2
    exit 1
fi
exit 0
EOF
    chmod +x "$STUB_BIN_DIR/mongorestore" "$STUB_BIN_DIR/mongosh" "$STUB_BIN_DIR/mongodump"
}

# ---------------------------------------------------------------------------
# git stub (scenario-driven; used for unwip/prune wizard tests)
#
# Modes:
#   STUB_GIT_SCRIPT  file containing a bash `case` body executed for each git
#                    invocation; $1..$N are the git args; stub logs and exits.
#   STUB_GIT_FAIL=1  catch-all failure mode when no script given.
# ---------------------------------------------------------------------------
stub_git() {
    _stubs_ensure_bin_dir
    cat > "$STUB_BIN_DIR/git" << 'EOF'
#!/usr/bin/env bash
echo "git $*" >> "${STUB_CALL_LOG:?}"
if [[ -n "${STUB_GIT_SCRIPT:-}" && -f "$STUB_GIT_SCRIPT" ]]; then
    bash "$STUB_GIT_SCRIPT" "$@"
    exit $?
fi
if [[ "${STUB_GIT_FAIL:-0}" == "1" ]]; then
    exit 1
fi
case "$1" in
    status)  printf '' ;;
    log)     printf 'abc1234 initial commit\n' ;;
    rev-parse) printf 'abc1234' ;;
    merge-base) exit 0 ;;
    *) exit 0 ;;
esac
EOF
    chmod +x "$STUB_BIN_DIR/git"
}

# Convenience: did any recorded invocation contain the given substring?
stub_calls_contain() {
    grep -qF -- "$1" "$STUB_CALL_LOG" 2>/dev/null
}
