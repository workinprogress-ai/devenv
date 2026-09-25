#!/usr/bin/env bats
# Tests for tools/scripts/repo-commit.sh — the single sanctioned commit wrapper.
# Contract under test: interactive-only (editor = permission gate), existing index
# only, hard refusal of every non-interactive path.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    REPO_COMMIT="$DEVENV_TOOLS/scripts/repo-commit.sh"
    TESTREPO="$(mktemp -d)"
    git -C "$TESTREPO" init -q
    git -C "$TESTREPO" config user.email test@example.com
    git -C "$TESTREPO" config user.name Test
    # A repo needs at least one commit for diff-tree checks; make one with a
    # non-interactive editor for determinism.
    echo "init" > "$TESTREPO/init.txt"
    git -C "$TESTREPO" add init.txt
    GIT_EDITOR=true git -C "$TESTREPO" commit -q -m init
    export GIT_EDITOR="true"
    # The wrapper operates on the CURRENT repo — every test must run inside the
    # throwaway repo so the devenv working tree is never touched.
    cd "$TESTREPO"
}

teardown() {
    cd "$BATS_TEST_ROOT" 2>/dev/null || true
    rm -rf "$TESTREPO"
}

stage_one_file() {
    echo "hello" > "$TESTREPO/a.txt"
    git -C "$TESTREPO" add a.txt
}

# Build a PATH shadow that omits interactive editors (code/code-insiders/nano)
# so the auto-resolve candidates come back empty and refusal paths are
# deterministic regardless of what the container has installed.
shadow_path_without_editors() {
    SHADOW_BIN="$TESTREPO/shadow-bin"
    mkdir -p "$SHADOW_BIN"
    for dir in $(printf '%s' "$PATH" | tr ':' ' '); do
        [ -d "$dir" ] || continue
        for entry in "$dir"/*; do
            [ -e "$entry" ] || continue
            base="$(basename "$entry")"
            case "$base" in code|code-insiders|nano) continue ;; esac
            [ -e "$SHADOW_BIN/$base" ] || ln -s "$entry" "$SHADOW_BIN/$base" 2>/dev/null || true
        done
    done
}

@test "--help exits 0 and mentions the interactive contract" {
    run bash "$REPO_COMMIT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"interactive"* ]]
}

@test "refuses invocation with no arguments" {
    run bash "$REPO_COMMIT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"only argument"* || "$output" == *"suggested commit message"* ]]
}

@test "refuses -m (no non-interactive path)" {
    run bash "$REPO_COMMIT" -m "sneaky message"
    [ "$status" -ne 0 ]
    [[ "$output" == *"refused"* ]]
}

@test "refuses --yes and any option-shaped first argument" {
    run bash "$REPO_COMMIT" --yes
    [ "$status" -ne 0 ]
    run bash "$REPO_COMMIT" --message "x"
    [ "$status" -ne 0 ]
}

@test "refuses more than one argument" {
    stage_one_file
    run bash "$REPO_COMMIT" "msg one" "extra"
    [ "$status" -ne 0 ]
    [[ "$output" == *"exactly one argument"* ]]
}

@test "refuses when nothing is staged" {
    unset GIT_EDITOR
    run bash "$REPO_COMMIT" "orphan message"
    [ "$status" -ne 0 ]
    [[ "$output" == *"nothing is staged"* ]]
}

@test "non-interactive GIT_EDITOR sentinel falls through to core.editor" {
    # THE regression case: automation hosts inject GIT_EDITOR=: into terminals;
    # the user's own core.editor must outrank it and the commit proceeds.
    stage_one_file
    SAVE_EDITOR="$TESTREPO/save-editor.sh"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$SAVE_EDITOR"
    chmod +x "$SAVE_EDITOR"
    git config core.editor "$SAVE_EDITOR"
    GIT_EDITOR=: run bash "$REPO_COMMIT" "sentinel overridden by config"
    [ "$status" -eq 0 ]
    [ "$(git -C "$TESTREPO" log -1 --format=%s)" = "sentinel overridden by config" ]
}

@test "refuses when every editor source resolves non-interactive" {
    stage_one_file
    shadow_path_without_editors
    git config core.editor true
    run env PATH="$SHADOW_BIN" GIT_EDITOR=true VISUAL=true EDITOR=true \
        bash "$REPO_COMMIT" "should be refused"
    [ "$status" -ne 0 ]
    [[ "$output" == *"refusing non-interactive editor"* ]]
}

@test "refuses non-interactive editor via core.editor config" {
    stage_one_file
    shadow_path_without_editors
    git config core.editor true
    run env -u GIT_EDITOR -u VISUAL -u EDITOR PATH="$SHADOW_BIN" \
        bash "$REPO_COMMIT" "should be refused"
    [ "$status" -ne 0 ]
    [[ "$output" == *"refusing non-interactive editor"* ]]
}

@test "refuses when a lone no-op sentinel is the only editor source" {
    # GIT_EDITOR=: with nothing else available: no fall-through target exists,
    # so the wrapper refuses rather than launching git's vi default.
    stage_one_file
    shadow_path_without_editors
    run env -u VISUAL -u EDITOR GIT_EDITOR=: PATH="$SHADOW_BIN" \
        bash "$REPO_COMMIT" "refused"
    [ "$status" -ne 0 ]
    [[ "$output" == *"refusing non-interactive editor"* ]]
}

@test "editor session with saved message commits the staged index" {
    stage_one_file
    # A "user who saves": editor script that keeps the file (cat overwrites in place
    # with the same content — deterministic, non-empty).
    SAVE_EDITOR="$TESTREPO/save-editor.sh"
    printf '#!/usr/bin/env bash\ncp "$1" "$1" 2>/dev/null || true\nexit 0\n' > "$SAVE_EDITOR"
    chmod +x "$SAVE_EDITOR"
    GIT_EDITOR="$SAVE_EDITOR" run bash "$REPO_COMMIT" "add greeting file"
    [ "$status" -eq 0 ]
    commit_subject="$(git -C "$TESTREPO" log -1 --format=%s)"
    [ "$commit_subject" = "add greeting file" ]
    # Exactly one commit beyond the initial state, containing our staged file.
    [ "$(git -C "$TESTREPO" diff-tree --no-commit-id --name-only -r HEAD | grep -c a.txt)" -eq 1 ]
}

@test "user editing the message in the editor wins over the suggestion" {
    stage_one_file
    EDIT_EDITOR="$TESTREPO/edit-editor.sh"
    cat > "$EDIT_EDITOR" <<'EOF'
#!/usr/bin/env bash
printf 'user-edited subject\n' > "$1"
EOF
    chmod +x "$EDIT_EDITOR"
    GIT_EDITOR="$EDIT_EDITOR" run bash "$REPO_COMMIT" "suggested subject"
    [ "$status" -eq 0 ]
    [ "$(git -C "$TESTREPO" log -1 --format=%s)" = "user-edited subject" ]
}

@test "editor emptying the message aborts the commit (cancel path)" {
    stage_one_file
    EMPTY_EDITOR="$TESTREPO/empty-editor.sh"
    printf '#!/usr/bin/env bash\n: > "$1"\nexit 0\n' > "$EMPTY_EDITOR"
    chmod +x "$EMPTY_EDITOR"
    GIT_EDITOR="$EMPTY_EDITOR" run bash "$REPO_COMMIT" "do not commit me"
    [ "$status" -ne 0 ]
    # Nothing committed; staged state preserved.
    run git -C "$TESTREPO" diff --cached --quiet
    [ "$status" -eq 1 ]   # diff --quiet exit 1 = staged changes still present
    [ "$(git -C "$TESTREPO" rev-list --count HEAD 2>/dev/null || echo 0)" -le 1 ]
}

@test "unstaged files are never swept into the commit" {
    echo "staged" > "$TESTREPO/staged.txt"
    echo "unstaged" > "$TESTREPO/unstaged.txt"
    git -C "$TESTREPO" add staged.txt
    SAVE_EDITOR="$TESTREPO/save-editor.sh"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$SAVE_EDITOR"
    chmod +x "$SAVE_EDITOR"
    GIT_EDITOR="$SAVE_EDITOR" run bash "$REPO_COMMIT" "only staged file"
    [ "$status" -eq 0 ]
    run git -C "$TESTREPO" show --name-only --format= HEAD
    [[ "$output" == *"staged.txt"* ]]
    [[ "$output" != *"unstaged.txt"* ]]
}
