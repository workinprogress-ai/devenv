#!/usr/bin/env bats
# tools/lib/fork.bash: the URL normalizer and [fork] config loader the three fork
# scripts share.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
}

teardown() {
    test_helper_teardown
}

norm() {
    bash -c "source '$DEVENV_TOOLS/lib/fork.bash'; fork_normalize_git_url '$1'"
}

@test "fork_normalize_git_url makes ssh, scp-style, https and file forms comparable" {
    [ "$(norm git@Example.com:Org/Repo.git)" = "example.com/org/repo" ]
    [ "$(norm https://user@Example.com/Org/Repo/)" = "example.com/org/repo" ]
    [ "$(norm ssh://git@example.com/org/repo.git)" = "example.com/org/repo" ]
    [ "$(norm file:///tmp/Repo.git)" = "/tmp/repo" ]
}

@test "the same repository by differently-cased URLs normalizes to one value" {
    [ "$(norm https://dev.azure.com/Acme/Proj/_git/Repo)" = "$(norm https://DEV.azure.com/acme/proj/_git/repo)" ]
}

@test "no fork script keeps its own copy of the normalizer" {
    run ! grep -ln '^normalize_git_url()\|^[[:space:]]*normalize_git_url()' "$DEVENV_TOOLS"/scripts/fork-*.sh
}

@test "fork_load_config fails naming the missing key" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/fork.bash'
        DEVENV_ROOT='$TEST_TEMP_DIR'; printf '[fork]\nupstream_repo=x\n' > \"\$DEVENV_ROOT/devenv.config\"
        fork_load_config
    "
    [ "$status" -ne 0 ]
    [[ "$output" == *"upstream_branch"* ]]
}

@test "fork_load_config reads both keys" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/fork.bash'
        DEVENV_ROOT='$TEST_TEMP_DIR'; printf '[fork]\nupstream_repo=https://h/o/r\nupstream_branch=main\n' > \"\$DEVENV_ROOT/devenv.config\"
        fork_load_config; echo \"\$FORK_UPSTREAM_REPO \$FORK_UPSTREAM_BRANCH\"
    "
    [ "$output" = "https://h/o/r main" ]
}

@test "fork_normalize_git_url handles ports, any scp user, host:path, path-less and leading-slash forms" {
    [ "$(norm ssh://git@github.com:22/org/repo)" = "github.com/org/repo" ]
    [ "$(norm https://h.example:8443/a/b.git)" = "h.example/a/b" ]
    [ "$(norm deploy@github.com:org/repo.git)" = "github.com/org/repo" ]
    [ "$(norm github.com:org/repo)" = "github.com/org/repo" ]
    [ "$(norm ssh://github.com:org/repo)" = "github.com/org/repo" ]
    [ "$(norm https://github.com)" = "github.com" ]
    [ "$(norm git@github.com:/org/repo)" = "github.com/org/repo" ]
}

_upstream_repo_with_remote() {   # <stored url> <configured url> [base=replacement insteadOf rule]
    UP_REPO="$TEST_TEMP_DIR/up-repo"
    rm -rf "$UP_REPO"; git init -q "$UP_REPO"
    git -C "$UP_REPO" remote add upstream "$1"
    [ -z "${3:-}" ] || git -C "$UP_REPO" config "url.${3%%=*}.insteadOf" "${3#*=}"
    FORK_UPSTREAM_REPO="$2"
}

@test "fork_upstream_matches ignores .git, case and scheme differences" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    _upstream_repo_with_remote https://github.com/Org/Repo.git https://github.com/org/repo
    fork_upstream_matches "$UP_REPO"
    _upstream_repo_with_remote git@github.com:org/repo https://github.com/org/repo
    fork_upstream_matches "$UP_REPO"
}

@test "fork_upstream_matches follows an insteadOf rewrite of the stored URL" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    # stored https://github.com/org/repo, rewritten to the ssh form; configured ssh form
    _upstream_repo_with_remote https://github.com/org/repo git@github.com:org/repo 'git@github.com:=https://github.com/'
    fork_upstream_matches "$UP_REPO"
}

@test "fork_upstream_matches rejects a different repository" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    _upstream_repo_with_remote https://github.com/org/other https://github.com/org/repo
    run fork_upstream_matches "$UP_REPO"
    [ "$status" -ne 0 ]
}

@test "fork_upstream_matches rejects a stored URL that an insteadOf rule sends to a different repository" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    # stored URL equals the configured one, but git contacts https://github.com/org/other
    _upstream_repo_with_remote https://github.com/org/repo https://github.com/org/repo 'https://github.com/org/other=https://github.com/org/repo'
    [ "$(git -C "$UP_REPO" remote get-url upstream)" = "https://github.com/org/other" ]
    run fork_upstream_matches "$UP_REPO"
    [ "$status" -ne 0 ]
}

@test "the Azure DevOps ssh, vs-ssh, visualstudio.com and https spellings of one repository normalize alike" {
    local want
    want="$(norm https://dev.azure.com/Org/Proj/_git/Repo)"
    [ "$want" = "dev.azure.com/org/proj/_git/repo" ]
    [ "$(norm git@ssh.dev.azure.com:v3/org/proj/repo)" = "$want" ]
    [ "$(norm ssh://git@ssh.dev.azure.com:22/v3/org/proj/repo)" = "$want" ]
    [ "$(norm vs-ssh.visualstudio.com:v3/org/proj/repo)" = "$want" ]
    [ "$(norm https://org.visualstudio.com/Proj/_git/Repo)" = "$want" ]
    [ "$(norm https://tok@org.visualstudio.com/DefaultCollection/proj/_git/repo)" = "$want" ]
}

@test "a different Azure DevOps repository, project or organization does not normalize alike" {
    local want
    want="$(norm https://dev.azure.com/org/proj/_git/repo)"
    [ "$(norm git@ssh.dev.azure.com:v3/org/proj/other)" != "$want" ]
    [ "$(norm git@ssh.dev.azure.com:v3/org/other/repo)" != "$want" ]
    [ "$(norm https://dev.azure.com/other/proj/_git/repo)" != "$want" ]
}

@test "fork_upstream_matches accepts the ssh form of an Azure DevOps upstream configured as https" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    _upstream_repo_with_remote git@ssh.dev.azure.com:v3/org/proj/repo https://dev.azure.com/org/proj/_git/repo
    fork_upstream_matches "$UP_REPO"
}

@test "a project name with a space normalizes alike whether the remote spells it %20 or literally" {
    [ "$(norm 'https://dev.azure.com/Org/Proj%20X/_git/Repo')" = "$(norm 'git@ssh.dev.azure.com:v3/Org/Proj X/Repo')" ]
    [ "$(norm 'https://dev.azure.com/Org/Proj%20X/_git/Repo')" = "dev.azure.com/org/proj x/_git/repo" ]
    [ "$(norm 'https://org.visualstudio.com/Proj%20X/_git/Repo')" = "$(norm 'https://dev.azure.com/org/Proj X/_git/Repo')" ]
}

@test "a different project that differs only past an encoded space does not match" {
    [ "$(norm 'https://dev.azure.com/org/Proj%20X/_git/repo')" != "$(norm 'https://dev.azure.com/org/Proj%20Y/_git/repo')" ]
}

@test "an encoded slash stays encoded and a stray percent sign is left alone" {
    [ "$(norm 'https://h/a%2Fb/c')" = "h/a%2fb/c" ]
    [ "$(norm 'https://h/100%')" = "h/100%" ]
}

@test "a project named DefaultCollection is a project, not the collection segment" {
    [ "$(norm 'https://org.visualstudio.com/DefaultCollection/_git/Repo')" = "dev.azure.com/org/defaultcollection/_git/repo" ]
}

@test "the push-to-upstream guard sees through the two spellings of a project with a space" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    _upstream_repo_with_remote 'git@ssh.dev.azure.com:v3/Org/Proj X/Repo' 'https://dev.azure.com/Org/Proj%20X/_git/Repo'
    fork_upstream_matches "$UP_REPO"
}

_selection_repo() {
    SEL_REPO="$TEST_TEMP_DIR/sel"
    git init -q -b main "$SEL_REPO"
    git -C "$SEL_REPO" config user.email t@t
    git -C "$SEL_REPO" config user.name t
    for n in base a b c; do
        echo "$n" > "$SEL_REPO/$n"
        git -C "$SEL_REPO" add "$n"
        git -C "$SEL_REPO" commit -q -m "$n"
    done
    SEL_BASE="$(git -C "$SEL_REPO" rev-parse HEAD~3)"
    SEL_END="$(git -C "$SEL_REPO" rev-parse HEAD)"
}

@test "fork_get_selection_slug is stable and differs for different selections" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    one="$(fork_get_selection_slug aaa1111 bbb2222 1111 2222)"
    [ "$one" = "$(fork_get_selection_slug aaa1111 bbb2222 1111 2222)" ]
    [ "$one" != "$(fork_get_selection_slug aaa1111 bbb2222 1111 3333)" ]
    [[ "$one" =~ ^aaa1111-sel[0-9a-f]{7}-bbb2222$ ]]
}

@test "fork_is_full_range_selection is true only for every commit of base..end" {
    source "$DEVENV_TOOLS/lib/fork.bash"
    _selection_repo
    mapfile -t all < <(git -C "$SEL_REPO" rev-list "$SEL_BASE..$SEL_END")
    fork_is_full_range_selection "$SEL_REPO" "$SEL_BASE" "$SEL_END" "${all[@]}"
    run ! fork_is_full_range_selection "$SEL_REPO" "$SEL_BASE" "$SEL_END" "${all[0]}" "${all[2]}"
    ! fork_is_full_range_selection "$SEL_REPO" "$SEL_BASE" "$SEL_END" "${all[0]}" "${all[1]}" "$SEL_BASE" "${all[2]}"
}
