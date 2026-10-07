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

@test "no script depends on the file command, so nothing needs installing after create" {
    run grep -nE '\$\(file ' "$PROJECT_ROOT/.devcontainer/bootstrap.sh" "$PROJECT_ROOT/setup" "$PROJECT_ROOT/.devcontainer/container-start.sh"
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
    run devcontainer "'postCreateCommand' in d"
    [ "$output" = "False" ]
}

@test "workspace paths use containerWorkspaceFolder, not a hard-coded folder name" {
    run grep -n '/workspaces/' "$PROJECT_ROOT/.devcontainer/devcontainer.json"
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
}

# Commands approved to run without a prompt. This is an allowlist on purpose: a
# new entry fails the test until it is reviewed against the bar below, and then added
# here. The bar: the command reads, never executes arbitrary code, never writes a file
# or repository state, and does not print the environment. The git inspection commands
# that have an output-writing or program-running flag (diff, show, log and friends) are a
# regular expression that excludes those flags. Named exceptions: markdown-plan-complete-ac
# and -task, which only tick checkboxes in a plan file. (cat, grep, head and tail can
# read a file such as the token seed; an approval key is a command prefix, so it cannot
# be narrowed by path.)
APPROVED_TERMINAL_COMMANDS=(
    "/^git (diff|show|log|diff-tree|diff-index)( (--|--stat|--name-only|--name-status|--oneline|--graph|--no-color|--patch|-p|--shortstat|--numstat|--summary|--cached|--staged|-r|--no-commit-id|--root|--decorate|--abbrev-commit|-[0-9]+|-U[0-9]+|-n|--max-count=[0-9]+|--unified=[0-9]+|(?!(?:[^ /]*/)*\\.\\.(?:/| |$))[A-Za-z0-9_./^~@{}:][A-Za-z0-9_./^~@{}:-]*))*$/"
    "artifacts-list"
    "cat"
    "command -v"
    "cs-dependencies-trace"
    "cut"
    "date"
    "diff"
    "docker images"
    "docker ps"
    "docker version"
    "dotnet --info"
    "dotnet --version"
    "dotnet list package"
    "file"
    "get-services-config"
    "git cat-file"
    "git describe"
    "git for-each-ref"
    "git ls-files"
    "git merge-base"
    "git name-rev"
    "git rev-list"
    "git rev-parse"
    "git shortlog"
    "git status"
    "git-graph"
    "git-graph-all"
    "grep"
    "head"
    "id"
    "issue-comment-list"
    "issue-get"
    "issue-list"
    "jq"
    "kube-list-pods"
    "kube-logs"
    "lint-documentation"
    "lint-tools-scripts"
    "ls"
    "lsof"
    "markdown-plan-complete-ac"
    "markdown-plan-complete-task"
    "metrics-count-code-lines"
    "node --version"
    "pnpm list"
    "pnpm outdated"
    "pr-diff"
    "pr-get"
    "pr-list"
    "pr-threads-get"
    "repo-calc-version"
    "repo-get-web-url"
    "repo-version-list"
    "rg"
    "ss"
    "stat"
    "tail"
    "tree"
    "uname"
    "uniq"
    "wc"
    "which"
    "whoami"
)

@test "terminal auto-approve holds only reviewed, read-only commands" {
    run devcontainer "'\n'.join(sorted(d['customizations']['vscode']['settings']['chat.tools.terminal.autoApprove']))"
    [ "$status" -eq 0 ]
    local actual="$output" extra="" key
    while IFS= read -r key; do
        printf '%s\n' "${APPROVED_TERMINAL_COMMANDS[@]}" | grep -qxF -- "$key" || extra="$extra [$key]"
    done <<< "$actual"
    [ -z "$extra" ] || { echo "approved without review:$extra"; false; }
}

@test "terminal auto-approve does not include test runners, repo cloning or environment dumps" {
    run devcontainer "' '.join(k for k in d['customizations']['vscode']['settings']['chat.tools.terminal.autoApprove'] if k in ('bats','run-tests','bash run-tests','git-repo','env','printenv','docker inspect','docker logs','find','awk','sort','ps','git branch','dotnet build','dotnet restore'))"
    [ "$status" -eq 0 ]
    [ -z "$output" ] || { echo "too permissive: $output"; false; }
}

# The regular-expression approvals are checked as patterns: JSON gives the string
# between the slashes, which Python's re accepts the same way the editor's engine does.
_approval_regex() {
    devcontainer "[k for k in d['customizations']['vscode']['settings']['chat.tools.terminal.autoApprove'] if k.startswith('/')][0][1:-1]"
}

@test "the git inspection approval admits only fixed read forms, and quoting, continuations and output flags cannot get through" {
    local re ok bad
    re="$(_approval_regex)"
    ok=("git diff" "git diff --stat HEAD~1" "git diff --name-only HEAD..origin/master" "git show HEAD:tools/x.sh" "git log --oneline -n 5" "git log -5 --stat" "git diff-tree --name-only -r HEAD" "git diff HEAD -- docs/Forking.md" "git log --max-count=3 origin/master" "git diff HEAD..origin/master" "git diff HEAD~3..HEAD -- ./tools/x.sh" "git show origin/master:docs/a..b.md")
    for c in "${ok[@]}"; do
        python3 -c 'import re,sys; sys.exit(0 if re.fullmatch(sys.argv[1], sys.argv[2]) else 1)' "$re" "$c" || { echo "should be approved: $c"; false; }
    done
    bad=("git diff --output=/tmp/x" "git diff --output /tmp/x" "git log -p --output=x" "git show --output x HEAD"
         "git diff --out''put=q.txt" 'git diff --ou"tput"=x' "git diff --ext-diff" "git diff --ext-d''iff" "git show --textconv HEAD:f" "git show --text''conv HEAD:f"
         $'git diff \\\n--output=/tmp/x' $'git diff\n--output=/tmp/x' "git diff; rm -rf x" "git diff && touch x" 'git diff $(touch x)' 'git diff `touch x`' "git diff | tee x" "git diff > x" "git diff --no-index /etc/passwd /dev/null"
         "git branch -D x" "git symbolic-ref HEAD refs/heads/x" "git -c core.pager=x diff"
         "git diff ../../etc/hostname ../../etc/hosts" "git diff -- ../../etc/hostname ../../etc/hosts" "git diff .." "git diff a/../../b c" "git diff ../a ../b" "git log -p -- docs/../../x")
    for c in "${bad[@]}"; do
        if python3 -c 'import re,sys; sys.exit(0 if re.fullmatch(sys.argv[1], sys.argv[2]) else 1)' "$re" "$c"; then
            echo "must not be approved: $c"; false
        fi
    done
}
