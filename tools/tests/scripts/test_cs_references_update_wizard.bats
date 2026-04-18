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
