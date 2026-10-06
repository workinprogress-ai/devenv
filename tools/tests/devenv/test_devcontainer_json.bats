#!/usr/bin/env bats
# .devcontainer/devcontainer.json (JSON with comments): reproducible base image,
# no duplicated entries, and ports/installs that match what the rest of the
# environment actually uses.

bats_require_minimum_version 1.5.0

load ../test_helper

# The file as plain JSON (full-line // comments dropped), as a python expression
# context: prints the value of a python expression over the parsed document `d`.
devcontainer() {
    python3 - "$PROJECT_ROOT/.devcontainer/devcontainer.json" "$1" <<'PY'
import json, sys
raw = open(sys.argv[1]).read()
d = json.loads("\n".join(l for l in raw.split("\n") if not l.strip().startswith("//")))
print(eval(sys.argv[2]))
PY
}

@test "devcontainer.json parses as JSON once comments are dropped" {
    run devcontainer "d['name']"
    [ "$status" -eq 0 ]
    [ -n "$output" ]
}

@test "no VS Code extension is listed twice" {
    run devcontainer "'\n'.join(sorted(e for e in set(d['customizations']['vscode']['extensions']) if d['customizations']['vscode']['extensions'].count(e) > 1))"
    [ "$status" -eq 0 ]
    [ -z "$output" ] || { echo "duplicated: $output"; return 1; }
}

@test "the base image is pinned to a content digest, not just a moving tag" {
    run devcontainer "d['image']"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^mcr\.microsoft\.com/devcontainers/base:[a-z0-9.-]+@sha256:[0-9a-f]{64}$ ]] || { echo "image: $output"; return 1; }
}

@test "every forwarded port is one a configured feature actually serves" {
    run devcontainer "' '.join(str(p) for p in d['forwardPorts'] if p not in (d['features']['ghcr.io/devcontainers/features/desktop-lite']['webPort'], d['features']['ghcr.io/devcontainers/features/desktop-lite']['vncPort']))"
    [ "$status" -eq 0 ]
    [ -z "$output" ] || { echo "forwarded but not served: $output"; return 1; }
}

@test "the desktop is reached in a browser on the documented web port, which is forwarded" {
    run devcontainer "d['features']['ghcr.io/devcontainers/features/desktop-lite']['webPort'] in d['forwardPorts']"
    [ "$output" = "True" ]
    grep -q "localhost:6090" "$PROJECT_ROOT/docs/Dev-container-environment.md"
}

@test "the file package is installed after create, because the CRLF self-heal preamble needs it" {
    # bootstrap.sh and setup run `file` before bootstrap installs anything, and
    # bootstrap's own package list does not include it: dropping the
    # postCreateCommand install would break the first bootstrap.
    grep -q 'file' <(devcontainer "d['postCreateCommand']")
    grep -q '\$(file ' "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
    grep -q '\$(file ' "$PROJECT_ROOT/setup"
}
