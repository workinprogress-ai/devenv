// Port of tools/tests/scripts/test_cs_references_update.bats (25 tests).
// cs-references-update: TFM/LangVersion rewrite engine, restore gate, and
// no-flags passthrough behavior, plus the .repo/update.sh boilerplate chain.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT_UNDER_TEST = join(ROOT, "tools", "cs-references-update");

const CSPROJ = [
  '<Project Sdk="Microsoft.NET.Sdk">',
  "  <PropertyGroup>",
  "    <TargetFramework>net8.0</TargetFramework>",
  "    <LangVersion>12.0</LangVersion>",
  "  </PropertyGroup>",
  "  <ItemGroup>",
  '    <PackageReference Include="WorkInProgress.Lib.Common" Version="1.0.0" />',
  "  </ItemGroup>",
  "</Project>",
].join("\n");

let TMP = "";
let REPO_DIR = "";
let MOCK_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `csru-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  REPO_DIR = join(TMP, "test-repo");
  mkdirSync(join(REPO_DIR, "src"), { recursive: true });
  writeFileSync(join(REPO_DIR, "src", "MyLib.csproj"), CSPROJ + "\n");
  // Mock bin directory on PATH: dotnet (restore fails only when told to) and
  // dotnet-outdated is invoked as `dotnet outdated`, so mocking dotnet covers both.
  mkdirSync(join(TMP, "bin"), { recursive: true });
  writeFileSync(
    join(TMP, "bin", "dotnet"),
    [
      "#!/usr/bin/env bash",
      "# Mock dotnet: record invocations; `restore` fails when MOCK_RESTORE_FAILS=1.",
      'echo "$*" >> "$MOCK_LOG"',
      'if [ "${1:-}" = "restore" ] && [ "${MOCK_RESTORE_FAILS:-0}" = "1" ]; then',
      '    echo "error NETSDK1045: mock restore failure" >&2',
      "    exit 101",
      "fi",
      'if [ "${1:-}" = "outdated" ]; then',
      "    exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(TMP, "bin", "dotnet")]);
  MOCK_LOG = join(TMP, "mock.log");
  writeFileSync(MOCK_LOG, "");
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function runUpdate(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT_UNDER_TEST, ...args], {
    cwd: REPO_DIR,
    encoding: "utf8",
    env: {
      ...procEnv,
      MOCK_LOG,
      PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
      ...extraEnv,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function csproj(): string {
  return readFileSync(join(REPO_DIR, "src", "MyLib.csproj"), "utf8");
}

function sedInPlace(file: string, from: string, to: string): void {
  const content = readFileSync(file, "utf8");
  writeFileSync(file, content.split(from).join(to));
}

function deleteLinesContaining(file: string, needle: string): void {
  const content = readFileSync(file, "utf8");
  writeFileSync(file, content.split("\n").filter((l) => !l.includes(needle)).join("\n"));
}

function mockLogHas(pattern: string): boolean {
  return spawnSync("grep", ["-qE", pattern, MOCK_LOG]).status === 0;
}

// Writes a record-keeping stub update.sh into the fixture repo and commits
// everything so the tree is clean at script start.
function setupChainFixture(): { chainLog: string } {
  mkdirSync(join(REPO_DIR, ".repo"), { recursive: true });
  writeFileSync(
    join(REPO_DIR, ".repo", "update.sh"),
    [
      "#!/usr/bin/env bash",
      'echo "ARGS: $*" >> "$CHAIN_LOG"',
      'if [ "${CHAIN_FAIL:-0}" = "1" ]; then',
      '    echo "Working tree is not clean." >&2',
      "    exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(REPO_DIR, ".repo", "update.sh")]);
  const chainLog = join(TMP, "chain.log");
  writeFileSync(chainLog, "");
  spawnSync("git", ["init", "-q"], { cwd: REPO_DIR, env: process.env });
  spawnSync("git", ["add", "-A"], { cwd: REPO_DIR, env: process.env });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "chain fixture"], { cwd: REPO_DIR, env: process.env });
  return { chainLog };
}

describe("scripts/cs-references-update", () => {
  // ── No-flags passthrough ─────────────────────────────────────────────────

  it("no flags: csproj files are untouched", () => {
    const r = runUpdate([REPO_DIR]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net8.0</TargetFramework>");
    expect(csproj()).toContain("<LangVersion>12.0</LangVersion>");
  });

  it("no flags: dotnet outdated is invoked per csproj", () => {
    const r = runUpdate([REPO_DIR]);
    expect(r.status).toBe(0);
    expect(mockLogHas("outdated")).toBe(true);
  });

  it("no flags: dotnet restore is not invoked", () => {
    const r = runUpdate([REPO_DIR]);
    expect(r.status).toBe(0);
    expect(mockLogHas("^restore")).toBe(false);
  });

  // ── --framework rewrite ──────────────────────────────────────────────────

  it("--framework: rewrites TargetFramework and TFM-defaults LangVersion", () => {
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net10.0</TargetFramework>");
    expect(csproj()).toContain("<LangVersion>14.0</LangVersion>");
    expect(mockLogHas("^restore")).toBe(true);
  });

  it("--framework: multi-target lists collapse to the new TFM", () => {
    sedInPlace(join(REPO_DIR, "src", "MyLib.csproj"), "<TargetFramework>net8.0</TargetFramework>", "<TargetFrameworks>net8.0;net9.0</TargetFrameworks>");
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net10.0</TargetFramework>");
    expect(csproj()).not.toContain("net8.0");
  });

  it("--framework: obj/ and bin/ files are never touched", () => {
    mkdirSync(join(REPO_DIR, "src", "obj"), { recursive: true });
    mkdirSync(join(REPO_DIR, "src", "bin"), { recursive: true });
    const gen = "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n";
    writeFileSync(join(REPO_DIR, "src", "obj", "Generated.csproj"), gen);
    writeFileSync(join(REPO_DIR, "src", "bin", "Bin.csproj"), gen);
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(REPO_DIR, "src", "obj", "Generated.csproj"), "utf8")).toContain("net8.0");
    expect(readFileSync(join(REPO_DIR, "src", "bin", "Bin.csproj"), "utf8")).toContain("net8.0");
  });

  it("--framework: idempotent — second run makes no changes and still succeeds", () => {
    expect(runUpdate([REPO_DIR, "--framework", "net10.0"]).status).toBe(0);
    const afterFirst = csproj();
    writeFileSync(MOCK_LOG, "");
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toBe(afterFirst);
  });

  it("--framework: restore gate failure aborts with exit 10 and outdated never runs", () => {
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"], { MOCK_RESTORE_FAILS: "1" });
    expect(r.status).toBe(10);
    expect(csproj()).toContain("<TargetFramework>net10.0</TargetFramework>");
    expect(mockLogHas("outdated")).toBe(false);
  });

  // ── LangVersion semantics ────────────────────────────────────────────────

  it("--framework net9.0 alone rewrites LangVersion to 13.0", () => {
    const r = runUpdate([REPO_DIR, "--framework", "net9.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<LangVersion>13.0</LangVersion>");
  });

  it("--lang-version overrides the TFM default map", () => {
    const r = runUpdate([REPO_DIR, "--framework", "net10.0", "--lang-version", "13.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net10.0</TargetFramework>");
    expect(csproj()).toContain("<LangVersion>13.0</LangVersion>");
    expect(csproj()).not.toContain("14.0");
  });

  it("--lang-version without --framework adds the tag where absent", () => {
    deleteLinesContaining(join(REPO_DIR, "src", "MyLib.csproj"), "<LangVersion>");
    const r = runUpdate([REPO_DIR, "--lang-version", "14.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<LangVersion>14.0</LangVersion>");
    expect(csproj()).toContain("<TargetFramework>net8.0</TargetFramework>");
  });

  it("--lang-version without --framework runs the restore gate", () => {
    deleteLinesContaining(join(REPO_DIR, "src", "MyLib.csproj"), "<LangVersion>");
    const r = runUpdate([REPO_DIR, "--lang-version", "14.0"]);
    expect(r.status).toBe(0);
    expect(mockLogHas("^restore")).toBe(true);
  });

  it("--lang-default removes existing tags and never adds them", () => {
    const r = runUpdate([REPO_DIR, "--lang-default"]);
    expect(r.status).toBe(0);
    expect(csproj()).not.toContain("<LangVersion>");
    expect(csproj()).toContain("<TargetFramework>net8.0</TargetFramework>");
  });

  it("--lang-default on a tree without tags changes nothing", () => {
    deleteLinesContaining(join(REPO_DIR, "src", "MyLib.csproj"), "<LangVersion>");
    const before = csproj();
    const r = runUpdate([REPO_DIR, "--lang-default"]);
    expect(r.status).toBe(0);
    expect(csproj()).toBe(before);
  });

  // ── Argument validation ──────────────────────────────────────────────────

  it("--lang-default and --lang-version together exit 2", () => {
    const r = runUpdate([REPO_DIR, "--lang-default", "--lang-version", "14.0"]);
    expect(r.status).toBe(2);
  });

  it("bad --framework value exits 2", () => {
    const r = runUpdate([REPO_DIR, "--framework", "net-tenth"]);
    expect(r.status).toBe(2);
  });

  it("bad --lang-version value exits 2", () => {
    const r = runUpdate([REPO_DIR, "--lang-version", "fourteen"]);
    expect(r.status).toBe(2);
  });

  it("unknown flag exits 2", () => {
    const r = runUpdate([REPO_DIR, "--frobnicate"]);
    expect(r.status).toBe(2);
  });

  it("missing directory exits 3", () => {
    const r = runUpdate([join(TMP, "nope"), "--framework", "net10.0"]);
    expect(r.status).toBe(3);
  });

  it("unmapped TFM with LangVersion tags present exits 2 naming supported TFMs", () => {
    const r = runUpdate([REPO_DIR, "--framework", "net11.0"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("net8.0");
    expect(r.out).toContain("Supported TFMs");
  });

  it("unmapped TFM without LangVersion tags proceeds (LangVersion untouched)", () => {
    deleteLinesContaining(join(REPO_DIR, "src", "MyLib.csproj"), "<LangVersion>");
    const r = runUpdate([REPO_DIR, "--framework", "net11.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net11.0</TargetFramework>");
    expect(csproj()).not.toContain("<LangVersion>");
  });

  // ── Help ─────────────────────────────────────────────────────────────────

  it("--help prints usage and exits 0", () => {
    const r = runUpdate(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("--framework");
    expect(r.out).toContain("--lang-version");
    expect(r.out).toContain("--lang-default");
  });

  // ── Boilerplate chain (.repo/update.sh) ──────────────────────────────────

  it("chain: passes --force --no-refresh when tree was clean before run", () => {
    const { chainLog } = setupChainFixture();
    // dotnet-outdated mock upgrades nothing → tree stays clean, chain still fires
    const r = runUpdate([REPO_DIR], { CHAIN_LOG: chainLog });
    expect(r.status).toBe(0);
    expect(readFileSync(chainLog, "utf8")).toContain("ARGS: --no-refresh --force");
  });

  it("chain: passes --no-refresh only when tree was dirty before run", () => {
    const { chainLog } = setupChainFixture();
    // Pre-existing dirt (unrelated to this script)
    appendToProj("local edit");
    const r = runUpdate([REPO_DIR], { CHAIN_LOG: chainLog });
    expect(r.status).toBe(0);
    expect(readFileSync(chainLog, "utf8")).toMatch(/ARGS: --no-refresh\n/);
  });

  it("chain: survives update.sh refusing on dirty tree (non-fatal)", () => {
    const { chainLog } = setupChainFixture();
    // update.sh dies with the dirt message even with --force (simulating an
    // older boilerplate without --force support) — the chain must degrade to
    // a NOTE, not kill the run.
    const r = runUpdate([REPO_DIR], { CHAIN_FAIL: "1", CHAIN_LOG: chainLog });
    expect(r.status).toBe(0);
    expect(r.out).toContain("NOTE: .repo/update.sh deferred its boilerplate sync");
  });

  function appendToProj(line: string): void {
    appendFileSync(join(REPO_DIR, "src", "MyLib.csproj"), `${line}\n`);
  }
});
