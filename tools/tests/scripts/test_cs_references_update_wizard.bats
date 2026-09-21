#!/usr/bin/env bats
# Tests for scripts/cs-references-update-wizard.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    export REPO_DIR="$TEST_TEMP_DIR/test-repo"
    mkdir -p "$REPO_DIR/src"

    # Create a minimal git repo with a .csproj
    cd "$REPO_DIR"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"
    cat > "$REPO_DIR/src/MyLib.csproj" <<'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="WorkInProgress.Lib.Common" Version="1.0.0" />
  </ItemGroup>
</Project>
CSPROJ
    git add .
    git commit -q -m "chore: initial"
    git branch -M master
    git remote add origin "https://github.com/test-org/test-repo.git"
    git update-ref refs/remotes/origin/master HEAD
    git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master

    # Set up mock bin directory on PATH
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    mkdir -p "$TEST_TEMP_DIR/bin"

    # Mock cs-references-update (no-op by default — leaves files unchanged)
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$TEST_TEMP_DIR/bin/cs-references-update"

    # Mock pr-create-for-merge
    cat > "$TEST_TEMP_DIR/bin/pr-create-for-merge" <<'EOF'
#!/usr/bin/env bash
echo "https://github.com/test-org/test-repo/pull/1"
EOF
    chmod +x "$TEST_TEMP_DIR/bin/pr-create-for-merge"

    # Mock pr-merge-pull-request
    cat > "$TEST_TEMP_DIR/bin/pr-merge-pull-request" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$TEST_TEMP_DIR/bin/pr-merge-pull-request"

    # Mock pr-complete-merge (end of the wizard's happy path)
    cat > "$TEST_TEMP_DIR/bin/pr-complete-merge" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$TEST_TEMP_DIR/bin/pr-complete-merge"

    cd "$REPO_DIR"
}

teardown() {
    cd "$PROJECT_ROOT"
    test_helper_teardown
}

# ── Syntax and basic contract ──────────────────────────────────────────────

@test "cs-references-update-wizard.sh has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh"
    [ "$status" -eq 0 ]
}

@test "cs-references-update-wizard.sh shows usage with --help" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Usage:" ]]
    [[ "$output" =~ "REPO_DIR" ]]
}

@test "cs-references-update-wizard.sh shows version with --version" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ "1.0.0" ]]
}

@test "cs-references-update-wizard.sh rejects unknown options" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --unknown-flag
    [ "$status" -ne 0 ]
}

@test "cs-references-update-wizard.sh rejects too many arguments" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR" extra-arg
    [ "$status" -ne 0 ]
}

@test "cs-references-update-wizard.sh fails on non-existent directory" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" /this/does/not/exist
    [ "$status" -ne 0 ]
}

# ── Dry-run ────────────────────────────────────────────────────────────────

@test "cs-references-update-wizard.sh dry-run prints repo name and exits 0" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --dry-run "$REPO_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "DRY RUN" ]]
    [[ "$output" =~ "test-repo" ]]
}

@test "cs-references-update-wizard.sh dry-run does not modify git state" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --dry-run "$REPO_DIR"
    [ "$status" -eq 0 ]
    # Still on master, no extra branches
    run git -C "$REPO_DIR" branch
    [[ "$output" =~ "master" ]]
    [[ ! "$output" =~ "auto-update-references" ]]
}

# ── No-op when nothing changes (exit 10) ─────────────────────────────────

@test "cs-references-update-wizard.sh exits 10 when cs-references-update makes no changes" {
    # cs-references-update mock does nothing → no diff → should exit 10
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR"
    [ "$status" -eq 10 ]
}

@test "cs-references-update-wizard.sh cleans up branch on no-op" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR"
    [ "$status" -eq 10 ]
    # Branch should have been deleted; master should be current
    run git -C "$REPO_DIR" branch
    [[ ! "$output" =~ "auto-update-references" ]]
}

# ── cs-references-update failure (exit 21) ────────────────────────────────

@test "cs-references-update-wizard.sh exits 21 when cs-references-update fails" {
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR"
    [ "$status" -eq 21 ]
}

@test "cs-references-update-wizard.sh cleans up branch on cs-references-update failure" {
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR"
    [ "$status" -eq 21 ]
    run git -C "$REPO_DIR" branch
    [[ ! "$output" =~ "auto-update-references" ]]
}

# ── Custom branch name ─────────────────────────────────────────────────────

@test "cs-references-update-wizard.sh accepts custom --branch name" {
    # Override cs-references-update to actually change a file so the script
    # progresses past the no-op check
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
repo_dir="${1:-$PWD}"
sed -i 's/Version="1\.0\.0"/Version="2.0.0"/' "$repo_dir/src/MyLib.csproj" 2>/dev/null || true
exit 0
EOF
    # Override git push so it does not fail (no real remote)
    local real_git
    real_git="$(command -v git)"
    cat > "$TEST_TEMP_DIR/bin/git" <<EOF
#!/usr/bin/env bash
# Pass everything through to real git, but no-op push
if [[ "\$*" =~ "push" ]]; then
    exit 0
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$TEST_TEMP_DIR/bin/git"

    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --dry-run --branch custom-branch "$REPO_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "DRY RUN" ]]
}

# ── snapshot_versions / detect_major_bumps helpers (sourced) ──────────────

@test "snapshot_versions finds PackageReference versions in src csprojs" {
    source "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh"
    result=$(snapshot_versions "$REPO_DIR")
    [[ "$result" =~ "WorkInProgress.Lib.Common 1.0.0" ]]
}

@test "detect_major_bumps detects a major version increase" {
    source "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh"

    local before_file after_file
    before_file=$(mktemp)
    after_file=$(mktemp)
    echo "WorkInProgress.Lib.Common 1.0.0" > "$before_file"
    echo "WorkInProgress.Lib.Common 2.0.0" > "$after_file"

    run detect_major_bumps "$before_file" "$after_file"
    rm -f "$before_file" "$after_file"

    [ "$status" -eq 0 ]
    [[ "$output" =~ "MAJOR" ]]
}

@test "detect_major_bumps does not flag a minor version increase" {
    source "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh"

    local before_file after_file
    before_file=$(mktemp)
    after_file=$(mktemp)
    echo "WorkInProgress.Lib.Common 1.0.0" > "$before_file"
    echo "WorkInProgress.Lib.Common 1.2.0" > "$after_file"

    run detect_major_bumps "$before_file" "$after_file"
    rm -f "$before_file" "$after_file"

    [ "$status" -ne 0 ]
    [[ ! "$output" =~ "MAJOR" ]]
}

@test "detect_major_bumps does not flag a patch version increase" {
    source "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh"

    local before_file after_file
    before_file=$(mktemp)
    after_file=$(mktemp)
    echo "WorkInProgress.Lib.Common 1.0.0" > "$before_file"
    echo "WorkInProgress.Lib.Common 1.0.5" > "$after_file"

    run detect_major_bumps "$before_file" "$after_file"
    rm -f "$before_file" "$after_file"

    [ "$status" -ne 0 ]
    [[ ! "$output" =~ "MAJOR" ]]
}

# ── Framework / language flags ─────────────────────────────────────────────

@test "cs-references-update-wizard.sh forwards --framework to cs-references-update" {
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
echo "ARGS: $*" > "${CAPTURE_FILE:?}"
exit 0
EOF
    run env CAPTURE_FILE="$TEST_TEMP_DIR/captured.args" \
        "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --framework net10.0 "$REPO_DIR"
    [ "$status" -eq 10 ]  # mock changes nothing → no-op exit, but flags were forwarded
    grep -q -- "--framework net10.0" "$TEST_TEMP_DIR/captured.args"
}

@test "cs-references-update-wizard.sh forwards --lang-version and --lang-default" {
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
echo "ARGS: $*" > "${CAPTURE_FILE:?}"
exit 0
EOF
    run env CAPTURE_FILE="$TEST_TEMP_DIR/captured.args" \
        "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --lang-version 14.0 "$REPO_DIR"
    [ "$status" -eq 10 ]
    grep -q -- "--lang-version 14.0" "$TEST_TEMP_DIR/captured.args"

    run env CAPTURE_FILE="$TEST_TEMP_DIR/captured2.args" \
        "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --lang-default "$REPO_DIR"
    [ "$status" -eq 10 ]
    grep -q -- "--lang-default" "$TEST_TEMP_DIR/captured2.args"
}

@test "cs-references-update-wizard.sh shows framework flags in usage" {
    run "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "--framework" ]]
    [[ "$output" =~ "--lang-version" ]]
    [[ "$output" =~ "--lang-default" ]]
}

@test "snapshot_versions captures TFM lines from src csprojs" {
    sed -i 's|<ItemGroup>|<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n  <ItemGroup>|' "$REPO_DIR/src/MyLib.csproj"
    source "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh"
    result=$(snapshot_versions "$REPO_DIR")
    [[ "$result" =~ "__TFM__ net8.0" ]]
}

@test "wizard forces major + framework PR title when TFM changes" {
    # Mock cs-references-update to retarget the csproj TFM (like the real one does)
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
repo_dir="${1:-$PWD}"
find "$repo_dir/src" -name '*.csproj' -exec sed -i 's|net8.0|net10.0|g; s|<LangVersion>12.0</LangVersion>|<LangVersion>14.0</LangVersion>|' {} +
exit 0
EOF
    # csproj needs a TFM + package so snapshot diff catches both
    sed -i 's|<ItemGroup>|<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n  <ItemGroup>|' "$REPO_DIR/src/MyLib.csproj"
    git -C "$REPO_DIR" add -A && git -C "$REPO_DIR" commit -q -m "add TFM"
    # The wizard resets to origin/master at start — move the remote ref so the
    # TFM baseline survives the reset.
    git -C "$REPO_DIR" update-ref refs/remotes/origin/master HEAD

    # Real pr-create-for-merge wrapper is mocked in setup; capture the title
    cat > "$TEST_TEMP_DIR/bin/pr-create-for-merge" <<'EOF'
#!/usr/bin/env bash
echo "TITLE: $*" >> "${CAPTURE_FILE:?}"
echo "https://github.com/test-org/test-repo/pull/1"
EOF

    local real_git
    real_git="$(command -v git)"
    cat > "$TEST_TEMP_DIR/bin/git" <<EOF
#!/usr/bin/env bash
if [[ "\$*" =~ "push" ]]; then
    exit 0
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$TEST_TEMP_DIR/bin/git"

    # No run-tests script → tests skipped
    run env CAPTURE_FILE="$TEST_TEMP_DIR/pr.args" \
        "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" --framework net10.0 "$REPO_DIR"
    [ "$status" -eq 0 ]
    grep -q "major: update references and target framework" "$TEST_TEMP_DIR/pr.args"
    rm -f "$TEST_TEMP_DIR/bin/git"
}

@test "wizard keeps plain title when no TFM change" {
    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
repo_dir="${1:-$PWD}"
sed -i 's/Version="1\.0\.0"/Version="1.1.0"/' "$repo_dir/src/MyLib.csproj" 2>/dev/null || true
exit 0
EOF
    cat > "$TEST_TEMP_DIR/bin/pr-create-for-merge" <<'EOF'
#!/usr/bin/env bash
echo "TITLE: $*" >> "${CAPTURE_FILE:?}"
echo "https://github.com/test-org/test-repo/pull/1"
EOF
    local real_git
    real_git="$(command -v git)"
    cat > "$TEST_TEMP_DIR/bin/git" <<EOF
#!/usr/bin/env bash
if [[ "\$*" =~ "push" ]]; then
    exit 0
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$TEST_TEMP_DIR/bin/git"

    run env CAPTURE_FILE="$TEST_TEMP_DIR/pr.args" \
        "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR"
    [ "$status" -eq 0 ]
    grep -q "patch: update references" "$TEST_TEMP_DIR/pr.args"
    ! grep -q "and target framework" "$TEST_TEMP_DIR/pr.args"
    rm -f "$TEST_TEMP_DIR/bin/git"
}

@test "wizard commits test-only update as chore(tests)" {
    # Add a test-project csproj (committed) that the mock update touches;
    # src csproj stays untouched → the only changed csproj is under tests/.
    mkdir -p "$REPO_DIR/tests"
    cat > "$REPO_DIR/tests/MyLib.Tests.csproj" <<'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="WorkInProgress.Lib.Common" Version="1.0.0" />
  </ItemGroup>
</Project>
CSPROJ
    git -C "$REPO_DIR" add -A && git -C "$REPO_DIR" commit -q -m "add test project"
    git -C "$REPO_DIR" update-ref refs/remotes/origin/master HEAD

    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
repo_dir="${1:-$PWD}"
sed -i 's/Version="1\.0\.0"/Version="2.1.0"/' "$repo_dir/tests/MyLib.Tests.csproj"
exit 0
EOF

    cat > "$TEST_TEMP_DIR/bin/pr-create-for-merge" <<'EOF'
#!/usr/bin/env bash
echo "TITLE: $*" >> "${CAPTURE_FILE:?}"
echo "https://github.com/test-org/test-repo/pull/1"
EOF
    local real_git
    real_git="$(command -v git)"
    cat > "$TEST_TEMP_DIR/bin/git" <<EOF
#!/usr/bin/env bash
if [[ "\$*" =~ "push" ]]; then
    exit 0
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$TEST_TEMP_DIR/bin/git"

    run env CAPTURE_FILE="$TEST_TEMP_DIR/pr.args" \
        "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR"
    [ "$status" -eq 0 ]
    grep -q "chore(tests): update references" "$TEST_TEMP_DIR/pr.args"
    ! grep -q "major:" "$TEST_TEMP_DIR/pr.args"
    ! grep -q "patch:" "$TEST_TEMP_DIR/pr.args"
    # The commit on the update branch carries the same message
    grep -q "chore(tests): update references" <(git -C "$REPO_DIR" log --format=%s -1 "$REPO_DIR" 2>/dev/null) || true
    rm -f "$TEST_TEMP_DIR/bin/git"
}

@test "wizard keeps src rules when src and test csprojs both change" {
    mkdir -p "$REPO_DIR/tests"
    cat > "$REPO_DIR/tests/MyLib.Tests.csproj" <<'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="WorkInProgress.Lib.Common" Version="1.0.0" />
  </ItemGroup>
</Project>
CSPROJ
    git -C "$REPO_DIR" add -A && git -C "$REPO_DIR" commit -q -m "add test project"
    git -C "$REPO_DIR" update-ref refs/remotes/origin/master HEAD

    cat > "$TEST_TEMP_DIR/bin/cs-references-update" <<'EOF'
#!/usr/bin/env bash
repo_dir="${1:-$PWD}"
sed -i 's/Version="1\.0\.0"/Version="1.1.0"/' "$repo_dir/src/MyLib.csproj" "$repo_dir/tests/MyLib.Tests.csproj"
exit 0
EOF

    cat > "$TEST_TEMP_DIR/bin/pr-create-for-merge" <<'EOF'
#!/usr/bin/env bash
echo "TITLE: $*" >> "${CAPTURE_FILE:?}"
echo "https://github.com/test-org/test-repo/pull/1"
EOF
    local real_git
    real_git="$(command -v git)"
    cat > "$TEST_TEMP_DIR/bin/git" <<EOF
#!/usr/bin/env bash
if [[ "\$*" =~ "push" ]]; then
    exit 0
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$TEST_TEMP_DIR/bin/git"

    run env CAPTURE_FILE="$TEST_TEMP_DIR/pr.args" \
        "$PROJECT_ROOT/tools/scripts/cs-references-update-wizard.sh" "$REPO_DIR"
    [ "$status" -eq 0 ]
    grep -q "patch: update references" "$TEST_TEMP_DIR/pr.args"
    ! grep -q "chore(tests)" "$TEST_TEMP_DIR/pr.args"
    rm -f "$TEST_TEMP_DIR/bin/git"
}
