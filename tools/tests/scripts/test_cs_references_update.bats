#!/usr/bin/env bats
# Tests for scripts/cs-references-update.sh — TFM/LangVersion rewrite engine,
# restore gate, and no-flags passthrough behavior.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    export SCRIPT_UNDER_TEST="$PROJECT_ROOT/tools/scripts/cs-references-update.sh"
    export REPO_DIR="$TEST_TEMP_DIR/test-repo"
    mkdir -p "$REPO_DIR/src"

    cat > "$REPO_DIR/src/MyLib.csproj" <<'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <LangVersion>12.0</LangVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="WorkInProgress.Lib.Common" Version="1.0.0" />
  </ItemGroup>
</Project>
CSPROJ

    # Mock bin directory on PATH: dotnet (restore fails only when told to) and
    # dotnet-outdated is invoked as `dotnet outdated`, so mocking dotnet covers both.
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    mkdir -p "$TEST_TEMP_DIR/bin"

    cat > "$TEST_TEMP_DIR/bin/dotnet" <<'EOF'
#!/usr/bin/env bash
# Mock dotnet: record invocations; `restore` fails when MOCK_RESTORE_FAILS=1.
echo "$*" >> "$MOCK_LOG"
if [ "${1:-}" = "restore" ] && [ "${MOCK_RESTORE_FAILS:-0}" = "1" ]; then
    echo "error NETSDK1045: mock restore failure" >&2
    exit 101
fi
if [ "${1:-}" = "outdated" ]; then
    exit 0
fi
exit 0
EOF
    chmod +x "$TEST_TEMP_DIR/bin/dotnet"

    export MOCK_LOG="$TEST_TEMP_DIR/mock.log"
    : > "$MOCK_LOG"

    cd "$REPO_DIR"
}

teardown() {
    test_helper_teardown
}

# ── No-flags passthrough ─────────────────────────────────────────────────

@test "no flags: csproj files are untouched" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR"
    [ "$status" -eq 0 ]
    grep -q '<TargetFramework>net8.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
    grep -q '<LangVersion>12.0</LangVersion>' "$REPO_DIR/src/MyLib.csproj"
}

@test "no flags: dotnet outdated is invoked per csproj" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR"
    [ "$status" -eq 0 ]
    grep -q "outdated" "$MOCK_LOG"
}

@test "no flags: dotnet restore is not invoked" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR"
    [ "$status" -eq 0 ]
    ! grep -q "^restore" "$MOCK_LOG"
}

# ── --framework rewrite ──────────────────────────────────────────────────

@test "--framework: rewrites TargetFramework and TFM-defaults LangVersion" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net10.0
    [ "$status" -eq 0 ]
    grep -q '<TargetFramework>net10.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
    grep -q '<LangVersion>14.0</LangVersion>' "$REPO_DIR/src/MyLib.csproj"
    grep -q "^restore" "$MOCK_LOG"
}

@test "--framework: multi-target lists collapse to the new TFM" {
    sed -i 's|<TargetFramework>net8.0</TargetFramework>|<TargetFrameworks>net8.0;net9.0</TargetFrameworks>|' "$REPO_DIR/src/MyLib.csproj"
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net10.0
    [ "$status" -eq 0 ]
    grep -q '<TargetFramework>net10.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
    ! grep -q 'net8.0' "$REPO_DIR/src/MyLib.csproj"
}

@test "--framework: obj/ and bin/ files are never touched" {
    mkdir -p "$REPO_DIR/src/obj" "$REPO_DIR/src/bin"
    cat > "$REPO_DIR/src/obj/Generated.csproj" <<'CSPROJ'
<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>
CSPROJ
    cp "$REPO_DIR/src/obj/Generated.csproj" "$REPO_DIR/src/bin/Bin.csproj"
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net10.0
    [ "$status" -eq 0 ]
    grep -q 'net8.0' "$REPO_DIR/src/obj/Generated.csproj"
    grep -q 'net8.0' "$REPO_DIR/src/bin/Bin.csproj"
}

@test "--framework: idempotent — second run makes no changes and still succeeds" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net10.0
    [ "$status" -eq 0 ]
    cp "$REPO_DIR/src/MyLib.csproj" "$TEST_TEMP_DIR/after-first.csproj"
    : > "$MOCK_LOG"
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net10.0
    [ "$status" -eq 0 ]
    cmp -s "$TEST_TEMP_DIR/after-first.csproj" "$REPO_DIR/src/MyLib.csproj"
}

@test "--framework: restore gate failure aborts with exit 10 and outdated never runs" {
    export MOCK_RESTORE_FAILS=1
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net10.0
    [ "$status" -eq 10 ]
    grep -q '<TargetFramework>net10.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
    ! grep -q "outdated" "$MOCK_LOG"
}

# ── LangVersion semantics ────────────────────────────────────────────────

@test "--framework net9.0 alone rewrites LangVersion to 13.0" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net9.0
    [ "$status" -eq 0 ]
    grep -q '<LangVersion>13.0</LangVersion>' "$REPO_DIR/src/MyLib.csproj"
}

@test "--lang-version overrides the TFM default map" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net10.0 --lang-version 13.0
    [ "$status" -eq 0 ]
    grep -q '<TargetFramework>net10.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
    grep -q '<LangVersion>13.0</LangVersion>' "$REPO_DIR/src/MyLib.csproj"
    ! grep -q '14.0' "$REPO_DIR/src/MyLib.csproj"
}

@test "--lang-version without --framework adds the tag where absent" {
    sed -i '/<LangVersion>/d' "$REPO_DIR/src/MyLib.csproj"
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --lang-version 14.0
    [ "$status" -eq 0 ]
    grep -q '<LangVersion>14.0</LangVersion>' "$REPO_DIR/src/MyLib.csproj"
    grep -q '<TargetFramework>net8.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
}

@test "--lang-version without --framework runs the restore gate" {
    sed -i '/<LangVersion>/d' "$REPO_DIR/src/MyLib.csproj"
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --lang-version 14.0
    [ "$status" -eq 0 ]
    grep -q "^restore" "$MOCK_LOG"
}

@test "--lang-default removes existing tags and never adds them" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --lang-default
    [ "$status" -eq 0 ]
    ! grep -q '<LangVersion>' "$REPO_DIR/src/MyLib.csproj"
    grep -q '<TargetFramework>net8.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
}

@test "--lang-default on a tree without tags changes nothing" {
    sed -i '/<LangVersion>/d' "$REPO_DIR/src/MyLib.csproj"
    cp "$REPO_DIR/src/MyLib.csproj" "$TEST_TEMP_DIR/before.csproj"
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --lang-default
    [ "$status" -eq 0 ]
    cmp -s "$TEST_TEMP_DIR/before.csproj" "$REPO_DIR/src/MyLib.csproj"
}

# ── Argument validation ──────────────────────────────────────────────────

@test "--lang-default and --lang-version together exit 2" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --lang-default --lang-version 14.0
    [ "$status" -eq 2 ]
}

@test "bad --framework value exits 2" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net-tenth
    [ "$status" -eq 2 ]
}

@test "bad --lang-version value exits 2" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --lang-version fourteen
    [ "$status" -eq 2 ]
}

@test "unknown flag exits 2" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --frobnicate
    [ "$status" -eq 2 ]
}

@test "missing directory exits 3" {
    run bash "$SCRIPT_UNDER_TEST" "$TEST_TEMP_DIR/nope" --framework net10.0
    [ "$status" -eq 3 ]
}

@test "unmapped TFM with LangVersion tags present exits 2 naming supported TFMs" {
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net11.0
    [ "$status" -eq 2 ]
    [[ "$output" == *"net8.0"* ]]
    [[ "$output" == *"Supported TFMs"* ]]
}

@test "unmapped TFM without LangVersion tags proceeds (LangVersion untouched)" {
    sed -i '/<LangVersion>/d' "$REPO_DIR/src/MyLib.csproj"
    run bash "$SCRIPT_UNDER_TEST" "$REPO_DIR" --framework net11.0
    [ "$status" -eq 0 ]
    grep -q '<TargetFramework>net11.0</TargetFramework>' "$REPO_DIR/src/MyLib.csproj"
    ! grep -q '<LangVersion>' "$REPO_DIR/src/MyLib.csproj"
}

# ── Help ─────────────────────────────────────────────────────────────────

@test "--help prints usage and exits 0" {
    run bash "$SCRIPT_UNDER_TEST" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"--framework"* ]]
    [[ "$output" == *"--lang-version"* ]]
    [[ "$output" == *"--lang-default"* ]]
}
