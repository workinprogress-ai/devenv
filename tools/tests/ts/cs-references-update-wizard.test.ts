// Port of tools/tests/scripts/test_cs_references_update_wizard.bats (20 tests).
// cs-references-update-wizard: branch/PR mechanics over sibling-tool mocks in
// a fake tools root, PR-title rules (major/patch/chore(tests)), flag
// forwarding, dry-run and failure paths.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const WIZARD_ENTRY = toolScript("cs-references-update-wizard");

const CSPROJ = [
  "<Project Sdk=\"Microsoft.NET.Sdk\">",
  "  <ItemGroup>",
  '    <PackageReference Include="WorkInProgress.Lib.Common" Version="1.0.0" />',
  "  </ItemGroup>",
  "</Project>",
].join("\n");

let TMP = "";
let REPO_DIR = "";
let FAKE_TOOLS = "";
let BIN = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

function git(args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd: REPO_DIR, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

function wizard(): (args: string[], extraEnv?: Record<string, string>) => { status: number; out: string } {
  return (args, extraEnv = {}) => {
    const r = spawnSync("node", [join(FAKE_TOOLS, "ts", "wizard.ts"), ...args], {
      cwd: REPO_DIR,
      encoding: "utf8",
      env: { ...GIT_ENV(), PATH: `${BIN}:${GIT_ENV().PATH ?? ""}`, ...extraEnv },
    });
    return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };
}

function writeFake(name: string, content: string): void {
  writeFileSync(join(FAKE_TOOLS, name), content);
  spawnSync("chmod", ["+x", join(FAKE_TOOLS, name)]);
}

// git push no-op shadow (no real remote).
function shadowGitPush(): void {
  const realGit = String(spawnSync("bash", ["-c", "command -v git"]).stdout ?? "git").trim();
  writeFileSync(
    join(BIN, "git"),
    [
      "#!/usr/bin/env bash",
      'if [[ "$*" =~ "push" ]]; then',
      "    exit 0",
      "fi",
      `exec "${realGit}" "$@"`,
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(BIN, "git")]);
}

function removeShadowGit(): void {
  rmSync(join(BIN, "git"), { force: true });
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `csruw-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  BIN = join(TMP, "bin");
  mkdirSync(BIN, { recursive: true });
  // Sandbox DEVENV_ROOT to a github-provider config: provider_extract_url
  // resolves through whichever provider the REAL devenv.config names; every
  // mock below hardcodes github.com URLs.
  const devRoot = join(TMP, "devroot");
  mkdirSync(devRoot, { recursive: true });
  writeFileSync(join(devRoot, "devenv.config"), "[provider]\nname=github\n");
  REPO_DIR = join(TMP, "test-repo");
  mkdirSync(join(REPO_DIR, "src"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: REPO_DIR, env: GIT_ENV() });
  writeFileSync(join(REPO_DIR, "src", "MyLib.csproj"), CSPROJ + "\n");
  spawnSync("git", ["add", "."], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["commit", "-q", "-m", "chore: initial"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["branch", "-M", "master"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/test-org/test-repo.git"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"], { cwd: REPO_DIR, env: GIT_ENV() });
  // The wizard invokes sibling tools by exact stub path (never PATH), so the
  // fakes go into a fake tools root.
  FAKE_TOOLS = join(TMP, "fake-tools");
  mkdirSync(join(FAKE_TOOLS, "ts"), { recursive: true });
  spawnSync("cp", ["-r", join(TOOLS, "lib"), join(FAKE_TOOLS, "lib")]);
  spawnSync("cp", [join(TOOLS, "ts", "cs-references-update-wizard.ts"), join(FAKE_TOOLS, "ts", "wizard.ts")]);
  // Mock cs-references-update (no-op by default — leaves files unchanged)
  writeFake("cs-references-update", "#!/usr/bin/env bash\nexit 0\n");
  // Mock pr-create
  writeFake("pr-create", '#!/usr/bin/env bash\necho "https://github.com/test-org/test-repo/pull/1"\n');
  // Mock pr-merge
  writeFake("pr-merge", "#!/usr/bin/env bash\nexit 0\n");
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function runEntry(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [WIZARD_ENTRY, ...args], {
    cwd: REPO_DIR,
    encoding: "utf8",
    env: { ...GIT_ENV(), ...extraEnv },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scripts/cs-references-update-wizard", () => {
  // ── Syntax and basic contract ──────────────────────────────────────────────

  it("cs-references-update-wizard.sh has valid bash syntax", () => {
    expect(existsSync(WIZARD_ENTRY)).toBe(true);
    expect(spawnSync("node", [WIZARD_ENTRY, "--version"]).status).toBe(0);
  });

  it("cs-references-update-wizard.sh shows usage with --help", () => {
    const r = runEntry(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
    expect(r.out).toContain("REPO_DIR");
  });

  it("cs-references-update-wizard.sh shows version with --version", () => {
    const r = runEntry(["--version"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("1.0.0");
  });

  it("cs-references-update-wizard.sh rejects unknown options", () => {
    const r = runEntry(["--unknown-flag"]);
    expect(r.status).not.toBe(0);
  });

  it("cs-references-update-wizard.sh rejects too many arguments", () => {
    const r = runEntry([REPO_DIR, "extra-arg"]);
    expect(r.status).not.toBe(0);
  });

  it("cs-references-update-wizard.sh fails on non-existent directory", () => {
    const r = runEntry(["/this/does/not/exist"]);
    expect(r.status).not.toBe(0);
  });

  // ── Dry-run ────────────────────────────────────────────────────────────────

  it("cs-references-update-wizard.sh dry-run prints repo name and exits 0", () => {
    const r = runEntry(["--dry-run", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("DRY RUN");
    expect(r.out).toContain("test-repo");
  });

  it("cs-references-update-wizard.sh dry-run does not modify git state", () => {
    const r = runEntry(["--dry-run", REPO_DIR]);
    expect(r.status).toBe(0);
    // Still on master, no extra branches
    const branches = (git(["branch"]).stdout ?? "");
    expect(branches).toContain("master");
    expect(branches).not.toContain("auto-update-references");
  });

  // ── No-op when nothing changes (exit 10) ─────────────────────────────────

  it("cs-references-update-wizard.sh exits 10 when cs-references-update makes no changes", () => {
    // cs-references-update mock does nothing → no diff → should exit 10
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(10);
  });

  it("cs-references-update-wizard.sh cleans up branch on no-op", () => {
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(10);
    // Branch should have been deleted; master should be current
    expect((git(["branch"]).stdout ?? "")).not.toContain("auto-update-references");
  });

  // ── cs-references-update failure (exit 21) ────────────────────────────────

  it("cs-references-update-wizard.sh exits 21 when cs-references-update fails", () => {
    writeFake("cs-references-update", "#!/usr/bin/env bash\nexit 1\n");
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(21);
  });

  it("cs-references-update-wizard.sh cleans up branch on cs-references-update failure", () => {
    writeFake("cs-references-update", "#!/usr/bin/env bash\nexit 1\n");
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(21);
    expect((git(["branch"]).stdout ?? "")).not.toContain("auto-update-references");
  });

  // ── Custom branch name ─────────────────────────────────────────────────────

  it("cs-references-update-wizard.sh accepts custom --branch name", () => {
    // Override cs-references-update to actually change a file so the script
    // progresses past the no-op check
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nsed -i \'s/Version="1\\.0\\.0"/Version="2.0.0"/\' "$repo_dir/src/MyLib.csproj" 2>/dev/null || true\nexit 0\n',
    );
    shadowGitPush();
    const r = runEntry(["--dry-run", "--branch", "custom-branch", REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("DRY RUN");
    removeShadowGit();
  });

  // ── Framework / language flags ─────────────────────────────────────────────

  it("cs-references-update-wizard.sh forwards --framework to cs-references-update", () => {
    writeFake("cs-references-update", '#!/usr/bin/env bash\necho "ARGS: $*" > "${CAPTURE_FILE:?}"\nexit 0\n');
    const captured = join(TMP, "captured.args");
    const r = wizard()(["--framework", "net10.0", REPO_DIR], { CAPTURE_FILE: captured });
    // mock changes nothing → no-op exit, but flags were forwarded
    expect(r.status).toBe(10);
    expect(readFileSync(captured, "utf8")).toContain("--framework net10.0");
  });

  it("cs-references-update-wizard.sh forwards --lang-version and --lang-default", () => {
    writeFake("cs-references-update", '#!/usr/bin/env bash\necho "ARGS: $*" > "${CAPTURE_FILE:?}"\nexit 0\n');
    const captured = join(TMP, "captured.args");
    let r = wizard()(["--lang-version", "14.0", REPO_DIR], { CAPTURE_FILE: captured });
    expect(r.status).toBe(10);
    expect(readFileSync(captured, "utf8")).toContain("--lang-version 14.0");
    const captured2 = join(TMP, "captured2.args");
    r = wizard()(["--lang-default", REPO_DIR], { CAPTURE_FILE: captured2 });
    expect(r.status).toBe(10);
    expect(readFileSync(captured2, "utf8")).toContain("--lang-default");
  });

  it("cs-references-update-wizard.sh shows framework flags in usage", () => {
    const r = runEntry(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("--framework");
    expect(r.out).toContain("--lang-version");
    expect(r.out).toContain("--lang-default");
  });

  it("wizard forces major + framework PR title when TFM changes", () => {
    // Mock cs-references-update to retarget the csproj TFM (like the real one does)
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nfind "$repo_dir/src" -name \'*.csproj\' -exec sed -i \'s|net8.0|net10.0|g; s|<LangVersion>12.0</LangVersion>|<LangVersion>14.0</LangVersion>|\' {} +\nexit 0\n',
    );
    // csproj needs a TFM + package so snapshot diff catches both
    const proj = readFileSync(join(REPO_DIR, "src", "MyLib.csproj"), "utf8");
    writeFileSync(
      join(REPO_DIR, "src", "MyLib.csproj"),
      proj.replace("<ItemGroup>", "<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n  <ItemGroup>"),
    );
    spawnSync("git", ["add", "-A"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "add TFM"], { cwd: REPO_DIR, env: GIT_ENV() });
    // The wizard resets to origin/master at start — move the remote ref so the
    // TFM baseline survives the reset.
    spawnSync("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
    // Real pr-create wrapper is mocked in setup; capture the title
    writeFake("pr-create", '#!/usr/bin/env bash\necho "TITLE: $*" >> "${CAPTURE_FILE:?}"\necho "https://github.com/test-org/test-repo/pull/1"\n');
    shadowGitPush();
    // No run-tests script → tests skipped
    const prArgs = join(TMP, "pr.args");
    const r = wizard()(datamodel(["--framework", "net10.0", REPO_DIR]), { CAPTURE_FILE: prArgs });
    expect(r.status).toBe(0);
    expect(readFileSync(prArgs, "utf8")).toContain("major: update references and target framework");
    removeShadowGit();
  });

  it("wizard keeps plain title when no TFM change", () => {
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nsed -i \'s/Version="1\\.0\\.0"/Version="1.1.0"/\' "$repo_dir/src/MyLib.csproj" 2>/dev/null || true\nexit 0\n',
    );
    writeFake("pr-create", '#!/usr/bin/env bash\necho "TITLE: $*" >> "${CAPTURE_FILE:?}"\necho "https://github.com/test-org/test-repo/pull/1"\n');
    shadowGitPush();
    const prArgs = join(TMP, "pr.args");
    const r = wizard()([REPO_DIR], { CAPTURE_FILE: prArgs });
    expect(r.status).toBe(0);
    const titles = readFileSync(prArgs, "utf8");
    expect(titles).toContain("patch: update references");
    expect(titles).not.toContain("and target framework");
    removeShadowGit();
  });

  it("wizard commits test-only update as chore(tests)", () => {
    // Add a test-project csproj (committed) that the mock update touches;
    // src csproj stays untouched → the only changed csproj is under tests/.
    mkdirSync(join(REPO_DIR, "tests"), { recursive: true });
    writeFileSync(join(REPO_DIR, "tests", "MyLib.Tests.csproj"), CSPROJ + "\n");
    spawnSync("git", ["add", "-A"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "add test project"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nsed -i \'s/Version="1\\.0\\.0"/Version="2.1.0"/\' "$repo_dir/tests/MyLib.Tests.csproj"\nexit 0\n',
    );
    writeFake("pr-create", '#!/usr/bin/env bash\necho "TITLE: $*" >> "${CAPTURE_FILE:?}"\necho "https://github.com/test-org/test-repo/pull/1"\n');
    shadowGitPush();
    const prArgs = join(TMP, "pr.args");
    const r = wizard()([REPO_DIR], { CAPTURE_FILE: prArgs });
    expect(r.status).toBe(0);
    const titles = readFileSync(prArgs, "utf8");
    expect(titles).toContain("chore(tests): update references");
    expect(titles).not.toContain("major:");
    expect(titles).not.toContain("patch:");
    removeShadowGit();
  });

  it("wizard keeps src rules when src and test csprojs both change", () => {
    mkdirSync(join(REPO_DIR, "tests"), { recursive: true });
    writeFileSync(join(REPO_DIR, "tests", "MyLib.Tests.csproj"), CSPROJ + "\n");
    spawnSync("git", ["add", "-A"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "add test project"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nsed -i \'s/Version="1\\.0\\.0"/Version="1.1.0"/\' "$repo_dir/src/MyLib.csproj" "$repo_dir/tests/MyLib.Tests.csproj"\nexit 0\n',
    );
    writeFake("pr-create", '#!/usr/bin/env bash\necho "TITLE: $*" >> "${CAPTURE_FILE:?}"\necho "https://github.com/test-org/test-repo/pull/1"\n');
    shadowGitPush();
    const prArgs = join(TMP, "pr.args");
    const r = wizard()([REPO_DIR], { CAPTURE_FILE: prArgs });
    expect(r.status).toBe(0);
    const titles = readFileSync(prArgs, "utf8");
    expect(titles).toContain("patch: update references");
    expect(titles).not.toContain("chore(tests)");
    removeShadowGit();
  });
});

function datamodel(args: string[]): string[] {
  return args;
}
