// cs-references-update: TFM/LangVersion rewrite engine, restore gate, and
// no-flags passthrough behavior, plus the .repo/update.sh boilerplate chain.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const SCRIPT_UNDER_TEST = toolScript("cs-references-update");

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
      '    if [ "${MOCK_OUTDATED_FAILS:-0}" = "1" ]; then exit 1; fi',
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

function runUpdate(
  args: string[],
  extraEnv: Record<string, string> = {},
  cwd: string = REPO_DIR,
): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT_UNDER_TEST, ...args], {
    cwd,
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

  it("--framework: multi-target lists keep non-modern entries and the list element", () => {
    sedInPlace(
      join(REPO_DIR, "src", "MyLib.csproj"),
      "<TargetFramework>net8.0</TargetFramework>",
      "<TargetFrameworks>netstandard2.0;net8.0;net9.0</TargetFrameworks>",
    );
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFrameworks>netstandard2.0;net10.0</TargetFrameworks>");
    expect(csproj()).not.toContain("net8.0");
  });

  it("--framework: raises an existing global.json SDK pin below the target major", () => {
    const g = join(REPO_DIR, "global.json");
    writeFileSync(g, '{\n  "sdk": {\n    "version": "8.0.100",\n    "rollForward": "latestFeature"\n  }\n}\n');
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(readFileSync(g, "utf8")).toBe('{\n  "sdk": {\n    "version": "10.0.100",\n    "rollForward": "latestFeature"\n  }\n}\n');
  });

  it("--framework: retargets .vscode/launch.json build-output paths; other launch.json files are ignored", () => {
    mkdirSync(join(REPO_DIR, ".vscode"), { recursive: true });
    mkdirSync(join(REPO_DIR, "docs"), { recursive: true });
    const text = '{ "program": "${workspaceFolder}/src/bin/Debug/net8.0/Host.dll" }\n';
    writeFileSync(join(REPO_DIR, ".vscode", "launch.json"), text);
    writeFileSync(join(REPO_DIR, "docs", "launch.json"), text);
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(REPO_DIR, ".vscode", "launch.json"), "utf8")).toContain("bin/Debug/net10.0/Host.dll");
    expect(readFileSync(join(REPO_DIR, "docs", "launch.json"), "utf8")).toBe(text);
  });

  it("--framework: never creates a global.json", () => {
    runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(spawnSync("test", ["-e", join(REPO_DIR, "global.json")]).status).toBe(1);
  });

  it("--framework: a global.json pin at or above the target major is left alone", () => {
    const g = join(REPO_DIR, "global.json");
    const text = '{ "sdk": { "version": "10.0.200" } }\n';
    writeFileSync(g, text);
    runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(readFileSync(g, "utf8")).toBe(text);
  });

  it("without --framework, global.json is not touched", () => {
    const g = join(REPO_DIR, "global.json");
    const text = '{ "sdk": { "version": "8.0.100" } }\n';
    writeFileSync(g, text);
    runUpdate([REPO_DIR]);
    expect(readFileSync(g, "utf8")).toBe(text);
  });

  it("--framework: a commented-out TargetFramework is left alone", () => {
    sedInPlace(
      join(REPO_DIR, "src", "MyLib.csproj"),
      "<TargetFramework>net8.0</TargetFramework>",
      "<TargetFramework>net8.0</TargetFramework>\n    <!-- <TargetFramework>net6.0</TargetFramework> -->",
    );
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<!-- <TargetFramework>net6.0</TargetFramework> -->");
  });

  it("--framework: a relative target directory resolves against the invocation directory", () => {
    const r = runUpdate(["test-repo", "--framework", "net10.0"], {}, TMP);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net10.0</TargetFramework>");
    // The projects are handed to dotnet by absolute path, never double-prefixed.
    expect(mockLogHas(`outdated ${join(REPO_DIR, "src", "MyLib.csproj")} `)).toBe(true);
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

  // ── Failures ─────────────────────────────────────────────────────────────

  it("a failing 'dotnet outdated' exits 11 and skips the boilerplate chain", () => {
    const { chainLog } = setupChainFixture();
    const r = runUpdate([REPO_DIR], { MOCK_OUTDATED_FAILS: "1", CHAIN_LOG: chainLog });
    expect(r.status).toBe(11);
    expect(r.out).toContain("'dotnet outdated' failed");
    expect(readFileSync(chainLog, "utf8")).toBe("");
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
    const r = runUpdate([REPO_DIR, "--framework", "net12.0"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("net8.0");
    expect(r.out).toContain("Supported TFMs");
  });

  it("unmapped TFM without LangVersion tags proceeds (LangVersion untouched)", () => {
    deleteLinesContaining(join(REPO_DIR, "src", "MyLib.csproj"), "<LangVersion>");
    const r = runUpdate([REPO_DIR, "--framework", "net12.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net12.0</TargetFramework>");
    expect(csproj()).not.toContain("<LangVersion>");
  });

  it("--framework net11.0: rewrites TargetFramework and maps LangVersion to 15.0", () => {
    const r = runUpdate([REPO_DIR, "--framework", "net11.0"]);
    expect(r.status).toBe(0);
    expect(csproj()).toContain("<TargetFramework>net11.0</TargetFramework>");
    expect(csproj()).toContain("<LangVersion>15.0</LangVersion>");
  });

  // ── --post-update ────────────────────────────────────────────────────────

  function writePostUpdate(body: string): string {
    const script = join(TMP, "migrate.sh");
    writeFileSync(script, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(script, 0o755);
    return script;
  }

  it("--post-update runs last with env and repo-root cwd; its edits are kept", () => {
    const { chainLog } = setupChainFixture();
    const script = writePostUpdate(
      [
        'echo "cwd=$(pwd) dir=$CS_UPDATE_REPO_DIR fw=$CS_UPDATE_FRAMEWORK prev=$CS_UPDATE_PREVIOUS_FRAMEWORKS" > "$HOOK_LOG"',
        'echo "chain-before-hook=$(wc -c < "$CHAIN_LOG")" >> "$HOOK_LOG"',
        'echo migrated > "$CS_UPDATE_REPO_DIR/migrated.txt"',
      ].join("\n"),
    );
    const hookLog = join(TMP, "hook.log");
    const r = runUpdate([REPO_DIR, "--framework", "net10.0", "--post-update", script], {
      HOOK_LOG: hookLog,
      CHAIN_LOG: chainLog,
    });
    expect(r.status).toBe(0);
    const log = readFileSync(hookLog, "utf8");
    expect(log).toContain(`cwd=${REPO_DIR}`);
    expect(log).toContain(`dir=${REPO_DIR}`);
    expect(log).toContain("fw=net10.0");
    expect(log).toContain("prev=net8.0");
    // the boilerplate chain had already written its ARGS line when the hook ran
    expect(log).not.toContain("chain-before-hook=0");
    expect(readFileSync(join(REPO_DIR, "migrated.txt"), "utf8")).toBe("migrated\n");
  });

  it("--post-update without --framework runs with an empty CS_UPDATE_FRAMEWORK", () => {
    const hookLog = join(TMP, "hook.log");
    const script = writePostUpdate('echo "fw=[$CS_UPDATE_FRAMEWORK]" > "$HOOK_LOG"');
    const r = runUpdate([REPO_DIR, "--post-update", script], { HOOK_LOG: hookLog });
    expect(r.status).toBe(0);
    expect(readFileSync(hookLog, "utf8")).toContain("fw=[]");
  });

  it("--post-update failure exits 12", () => {
    const script = writePostUpdate("exit 7");
    const r = runUpdate([REPO_DIR, "--post-update", script]);
    expect(r.status).toBe(12);
    expect(r.out).toContain("--post-update script failed (exit 7)");
  });

  it("--post-update does not run when 'dotnet outdated' failed", () => {
    const hookLog = join(TMP, "hook.log");
    const script = writePostUpdate('echo ran > "$HOOK_LOG"');
    const r = runUpdate([REPO_DIR, "--post-update", script], { MOCK_OUTDATED_FAILS: "1", HOOK_LOG: hookLog });
    expect(r.status).toBe(11);
    expect(spawnSync("test", ["-e", hookLog]).status).toBe(1);
  });

  it("--post-update with a missing script exits 3; a non-executable one exits 2", () => {
    expect(runUpdate([REPO_DIR, "--post-update", join(TMP, "nope.sh")]).status).toBe(3);
    const plain = join(TMP, "plain.sh");
    writeFileSync(plain, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(plain, 0o644);
    expect(runUpdate([REPO_DIR, "--post-update", plain]).status).toBe(2);
  });

  it("--post-update given as a relative path is resolved against the invocation directory", () => {
    writePostUpdate('echo ok > "$HOOK_LOG"');
    const hookLog = join(TMP, "hook.log");
    const r = runUpdate([REPO_DIR, "--post-update", "./migrate.sh"], { HOOK_LOG: hookLog }, TMP);
    expect(r.status).toBe(0);
    expect(readFileSync(hookLog, "utf8")).toBe("ok\n");
  });

  // ── --pre-restore ────────────────────────────────────────────────────────

  it("--pre-restore runs after the rewrite and before the restore gate, with env and repo-root cwd", () => {
    const hookLog = join(TMP, "hook.log");
    const script = writePostUpdate(
      [
        'echo "pre-restore" >> "$MOCK_LOG"',
        'echo "cwd=$(pwd) dir=$CS_UPDATE_REPO_DIR fw=$CS_UPDATE_FRAMEWORK prev=$CS_UPDATE_PREVIOUS_FRAMEWORKS" > "$HOOK_LOG"',
        'grep -o "<TargetFramework>[^<]*" "$CS_UPDATE_REPO_DIR/src/MyLib.csproj" >> "$HOOK_LOG"',
      ].join("\n"),
    );
    const r = runUpdate([REPO_DIR, "--framework", "net11.0", "--pre-restore", script], { HOOK_LOG: hookLog });
    expect(r.status).toBe(0);
    const calls = readFileSync(MOCK_LOG, "utf8").split("\n").filter((l) => l !== "");
    const hookAt = calls.indexOf("pre-restore");
    const restoreAt = calls.findIndex((l) => l.startsWith("restore"));
    expect(hookAt).toBeGreaterThanOrEqual(0);
    expect(restoreAt).toBeGreaterThan(hookAt);
    const log = readFileSync(hookLog, "utf8");
    expect(log).toContain(`cwd=${REPO_DIR}`);
    expect(log).toContain(`dir=${REPO_DIR}`);
    expect(log).toContain("fw=net11.0");
    expect(log).toContain("prev=net8.0");
    // the hook sees the rewritten target framework
    expect(log).toContain("<TargetFramework>net11.0");
  });

  it("--pre-restore without --framework still runs the restore gate after it", () => {
    const script = writePostUpdate('echo "pre-restore" >> "$MOCK_LOG"');
    const r = runUpdate([REPO_DIR, "--pre-restore", script]);
    expect(r.status).toBe(0);
    const calls = readFileSync(MOCK_LOG, "utf8").split("\n").filter((l) => l !== "");
    expect(calls.findIndex((l) => l.startsWith("restore"))).toBeGreaterThan(calls.indexOf("pre-restore"));
  });

  it("--pre-restore failure exits 13 before the restore gate and package updates", () => {
    const script = writePostUpdate("exit 5");
    const r = runUpdate([REPO_DIR, "--framework", "net11.0", "--pre-restore", script]);
    expect(r.status).toBe(13);
    expect(r.out).toContain("--pre-restore script failed (exit 5)");
    expect(mockLogHas("^restore")).toBe(false);
    expect(mockLogHas("outdated")).toBe(false);
  });

  it("--pre-restore with a missing script exits 3; a non-executable one exits 2", () => {
    const missing = runUpdate([REPO_DIR, "--pre-restore", join(TMP, "nope.sh")]);
    expect(missing.status).toBe(3);
    expect(missing.out).toContain("--pre-restore script not found");
    const plain = join(TMP, "plain.sh");
    writeFileSync(plain, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(plain, 0o644);
    expect(runUpdate([REPO_DIR, "--pre-restore", plain]).status).toBe(2);
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

  it("chain: this run's own rewrites do not count as dirt that was there before", () => {
    const { chainLog } = setupChainFixture();
    const r = runUpdate([REPO_DIR, "--framework", "net10.0"], { CHAIN_LOG: chainLog });
    expect(r.status).toBe(0);
    expect(csproj()).toContain("net10.0");
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
