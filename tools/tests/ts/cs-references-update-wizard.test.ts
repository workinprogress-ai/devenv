// cs-references-update-wizard: branch/PR mechanics over sibling-tool mocks in
// a fake tools root, PR-title rules (major/patch/chore(tests)), flag
// forwarding, dry-run and failure paths.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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
    // setsid: a new session has no controlling terminal. The wizard's prompts
    // read /dev/tty, so a child that inherits the test runner's terminal (a
    // developer running the suite from a commit hook) would wait on that
    // terminal for an answer nobody gives.
    const r = spawnSync("setsid", ["--wait", "node", join(FAKE_TOOLS, "ts", "wizard.ts"), ...args], {
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

// git shadow that logs every invocation to GIT_LOG and fails every push.
function shadowGitPushFails(): string {
  const realGit = String(spawnSync("bash", ["-c", "command -v git"]).stdout ?? "git").trim();
  const log = join(TMP, "git.log");
  writeFileSync(
    join(BIN, "git"),
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> "${log}"`,
      'if [[ "$*" =~ "push" ]]; then',
      "    exit 1",
      "fi",
      `exec "${realGit}" "$@"`,
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(BIN, "git")]);
  return log;
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

  // ── Protected branch names ─────────────────────────────────────────────────

  it.each(["master", "main", "develop", "release/1.0", "hotfix/urgent"])("refuses the protected update branch name '%s'", (name) => {
    const r = wizard()(["--branch", name, REPO_DIR]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refusing protected branch name");
    expect((git(["branch"]).stdout ?? "")).not.toContain("release/1.0");
  });

  it("refuses an invalid branch name", () => {
    const r = wizard()(["--branch", "bad..name", REPO_DIR]);
    expect(r.status).toBe(2);
  });

  // ── Push and staging hazards ───────────────────────────────────────────────

  it("never force-pushes: a failed push exits 20 after a single plain push", () => {
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nsed -i \'s/Version="1\\.0\\.0"/Version="1.1.0"/\' "$repo_dir/src/MyLib.csproj"\nexit 0\n',
    );
    const log = shadowGitPushFails();
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(20);
    const pushes = readFileSync(log, "utf8").split("\n").filter((l) => l.includes("push"));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).not.toContain("--force");
    expect(r.out).toContain("Kept local branch 'auto-update-references'");
    // The update commit survives on the local branch, ahead of master.
    expect((git(["branch", "--list", "auto-update-references"]).stdout ?? "")).toContain("auto-update-references");
    const ahead = (git(["rev-list", "--count", "master..auto-update-references"]).stdout ?? "").trim();
    expect(ahead).toBe("1");
    const files = (git(["show", "--name-only", "--format=", "auto-update-references"]).stdout ?? "");
    expect(files).toContain("src/MyLib.csproj");
    expect(readFileSync(log, "utf8")).not.toMatch(/branch -D/);
    removeShadowGit();
  });

  it("the update commit message carries no CI-skip token, so the merge triggers CI", () => {
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nsed -i \'s/Version="1\\.0\\.0"/Version="1.1.0"/\' "$repo_dir/src/MyLib.csproj"\nexit 0\n',
    );
    shadowGitPushFails();
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(20);
    const message = (git(["log", "-1", "--format=%B", "auto-update-references"]).stdout ?? "").trim();
    expect(message).toBe("fix: update references");
    expect(message).not.toMatch(/skip ci|ci skip|no_ci/i);
    removeShadowGit();
  });

  it("stages explicit tracked paths only: untracked residue stays out of the commit", () => {
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nsed -i \'s/Version="1\\.0\\.0"/Version="1.1.0"/\' "$repo_dir/src/MyLib.csproj"\necho residue > "$repo_dir/residue.txt"\nexit 0\n',
    );
    // The update branch is deleted after the merge, so the merge mock records
    // what the update commit carried.
    writeFake("pr-merge", '#!/usr/bin/env bash\ngit show --name-only --format= HEAD > "${CAPTURE_FILE:?}"\nexit 0\n');
    shadowGitPush();
    const captured = join(TMP, "commit.files");
    const r = wizard()([REPO_DIR], { CAPTURE_FILE: captured });
    expect(r.status).toBe(0);
    expect(r.out).toContain("residue.txt");
    const files = readFileSync(captured, "utf8");
    expect(files).toContain("src/MyLib.csproj");
    expect(files).not.toContain("residue.txt");
    removeShadowGit();
  });

  it("stages tracked paths with spaces and non-ASCII characters, including deletions", () => {
    mkdirSync(join(REPO_DIR, "docs"), { recursive: true });
    writeFileSync(join(REPO_DIR, "docs", "Résumé notes.txt"), "one\n");
    writeFileSync(join(REPO_DIR, "docs", "with space.txt"), "gone\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "chore: add docs"]);
    git(["update-ref", "refs/remotes/origin/master", "HEAD"]);
    writeFake(
      "cs-references-update",
      [
        "#!/usr/bin/env bash",
        'repo_dir="${1:-$PWD}"',
        "sed -i 's/Version=\"1\\.0\\.0\"/Version=\"1.1.0\"/' \"$repo_dir/src/MyLib.csproj\"",
        'echo two >> "$repo_dir/docs/Résumé notes.txt"',
        'rm "$repo_dir/docs/with space.txt"',
        "exit 0",
        "",
      ].join("\n"),
    );
    writeFake("pr-merge", '#!/usr/bin/env bash\ngit -c core.quotePath=false show --name-only --format= HEAD > "${CAPTURE_FILE:?}"\nexit 0\n');
    shadowGitPush();
    const captured = join(TMP, "commit.files");
    const r = wizard()([REPO_DIR], { CAPTURE_FILE: captured });
    expect(r.status).toBe(0);
    const files = readFileSync(captured, "utf8").split("\n");
    expect(files).toContain("docs/Résumé notes.txt");
    expect(files).toContain("docs/with space.txt");
    expect(files).toContain("src/MyLib.csproj");
    removeShadowGit();
  });

  // ── Leftover update branch ─────────────────────────────────────────────────

  function commitOnLeftoverBranch(): void {
    git(["checkout", "-q", "-b", "auto-update-references"]);
    writeFileSync(join(REPO_DIR, "operator-work.txt"), "unpushed\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "chore: operator work"]);
    git(["checkout", "-q", "master"]);
  }

  it("refuses to delete a leftover local update branch that holds unpushed commits", () => {
    commitOnLeftoverBranch();
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(20);
    expect(r.out).toContain("not on its remote counterpart");
    expect(r.out).toContain("refusing to delete the leftover local branch");
    expect(git(["log", "--format=%s", "auto-update-references"]).stdout).toContain("chore: operator work");
  });

  it("deletes and recreates a leftover update branch that holds nothing beyond the default branch", () => {
    git(["branch", "auto-update-references"]);
    const r = wizard()([REPO_DIR]);
    // The no-op mock update leaves nothing to commit, which also removes the branch.
    expect(r.status).toBe(10);
    expect(r.out).not.toContain("refusing");
    expect(git(["branch"]).stdout).not.toContain("auto-update-references");
  });

  it("deletes a leftover update branch whose commits are all on its remote counterpart", () => {
    commitOnLeftoverBranch();
    git(["update-ref", "refs/remotes/origin/auto-update-references", "refs/heads/auto-update-references"]);
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(10);
    expect(r.out).not.toContain("refusing");
  });

  it("keeps the branch and the working-tree fixes when the commit keeps failing and nobody confirms the discard", () => {
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nsed -i \'s/Version="1\\.0\\.0"/Version="1.1.0"/\' "$1/src/MyLib.csproj"\nexit 0\n',
    );
    const hook = join(REPO_DIR, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/usr/bin/env bash\nexit 1\n");
    spawnSync("chmod", ["+x", hook]);
    expect(wizard()([REPO_DIR]).status).toBe(30);
    const r = wizard()(["--continue", REPO_DIR]);
    expect(r.status).toBe(30);
    expect(r.out).toContain("untouched");
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()).toBe("auto-update-references");
    expect(readFileSync(join(REPO_DIR, "src", "MyLib.csproj"), "utf8")).toContain("1.1.0");
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

  it("cs-references-update-wizard.sh forwards --post-update as an absolute path", () => {
    writeFake("cs-references-update", '#!/usr/bin/env bash\necho "ARGS: $*" > "${CAPTURE_FILE:?}"\nexit 0\n');
    const script = join(TMP, "migrate.sh");
    writeFileSync(script, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(script, 0o755);
    const captured = join(TMP, "captured.args");
    const r = wizard()(["--post-update", script, REPO_DIR], { CAPTURE_FILE: captured });
    expect(r.status).toBe(10);
    expect(readFileSync(captured, "utf8")).toContain(`--post-update ${script}`);
  });

  it("forwards --pre-restore as an absolute path, before --post-update", () => {
    writeFake("cs-references-update", '#!/usr/bin/env bash\necho "ARGS: $*" > "${CAPTURE_FILE:?}"\nexit 0\n');
    const pre = join(TMP, "pre.sh");
    const post = join(TMP, "post.sh");
    for (const s of [pre, post]) {
      writeFileSync(s, "#!/usr/bin/env bash\nexit 0\n");
      chmodSync(s, 0o755);
    }
    const captured = join(TMP, "captured.args");
    const r = wizard()(["--pre-restore", pre, "--post-update", post, REPO_DIR], { CAPTURE_FILE: captured });
    expect(r.status).toBe(10);
    expect(readFileSync(captured, "utf8")).toContain(`--pre-restore ${pre} --post-update ${post}`);
  });

  it("rejects a missing --pre-restore script before touching the repo", () => {
    const r = wizard()(["--pre-restore", join(TMP, "nope.sh"), REPO_DIR]);
    expect(r.status).toBe(3);
    expect(r.out).toContain("--pre-restore script not found");
  });

  it("cs-references-update-wizard.sh rejects a missing --post-update script before touching the repo", () => {
    const r = wizard()(["--post-update", join(TMP, "nope.sh"), REPO_DIR]);
    expect(r.status).toBe(3);
    expect(r.out).toContain("--post-update script not found");
  });

  it("cs-references-update-wizard.sh shows --post-update in usage", () => {
    expect(runEntry(["--help"]).out).toContain("--post-update");
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
    expect(readFileSync(prArgs, "utf8")).toContain("feat!: update references and target framework");
    removeShadowGit();
  });

  it("a framework change commits feat! with a BREAKING CHANGE footer", () => {
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nfind "$repo_dir/src" -name \'*.csproj\' -exec sed -i \'s|net8.0|net11.0|g\' {} +\nexit 0\n',
    );
    const proj = readFileSync(join(REPO_DIR, "src", "MyLib.csproj"), "utf8");
    writeFileSync(
      join(REPO_DIR, "src", "MyLib.csproj"),
      proj.replace("<ItemGroup>", "<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n  <ItemGroup>"),
    );
    spawnSync("git", ["add", "-A"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "add TFM"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
    shadowGitPushFails();
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(20);
    const message = (git(["log", "-1", "--format=%B", "auto-update-references"]).stdout ?? "").trim();
    expect(message.split("\n")[0]).toBe("feat!: update references and target framework");
    expect(message).toMatch(/^BREAKING CHANGE: /m);
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
    expect(titles).toContain("fix: update references");
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
    expect(titles).toContain("fix: update references");
    expect(titles).not.toContain("chore(tests)");
    removeShadowGit();
  });

  // ── Resume and PR creation ─────────────────────────────────────────────────

  function frameworkChangeSetup(): void {
    writeFake(
      "cs-references-update",
      '#!/usr/bin/env bash\nrepo_dir="${1:-$PWD}"\nfind "$repo_dir/src" -name \'*.csproj\' -exec sed -i \'s|net8.0|net11.0|g\' {} +\nexit 0\n',
    );
    const proj = readFileSync(join(REPO_DIR, "src", "MyLib.csproj"), "utf8");
    writeFileSync(
      join(REPO_DIR, "src", "MyLib.csproj"),
      proj.replace("<ItemGroup>", "<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n  <ItemGroup>"),
    );
    spawnSync("git", ["add", "-A"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "add TFM"], { cwd: REPO_DIR, env: GIT_ENV() });
    spawnSync("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], { cwd: REPO_DIR, env: GIT_ENV() });
  }

  it("a resumed run commits with the change level the first pass detected", () => {
    frameworkChangeSetup();
    const hook = join(REPO_DIR, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/usr/bin/env bash\nexit 1\n");
    spawnSync("chmod", ["+x", hook]);
    expect(wizard()([REPO_DIR]).status).toBe(30);
    rmSync(hook);
    shadowGitPushFails();
    const r = wizard()(["--continue", REPO_DIR]);
    expect(r.status).toBe(20);
    const message = (git(["log", "-1", "--format=%B", "auto-update-references"]).stdout ?? "").trim();
    expect(message.split("\n")[0]).toBe("feat!: update references and target framework");
    expect(message).toMatch(/^BREAKING CHANGE: /m);
    removeShadowGit();
  });

  it("refuses to resume a branch the wizard did not start, and commits nothing", () => {
    git(["checkout", "-q", "-b", "auto-update-references"]);
    writeFileSync(join(REPO_DIR, "src", "MyLib.csproj"), CSPROJ.replace("1.0.0", "1.1.0") + "\n");
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const r = wizard()(["--continue", REPO_DIR]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("No saved change level");
    expect(git(["rev-parse", "HEAD"]).stdout.trim()).toBe(head);
  });

  it("removes the saved change level when the run completes", () => {
    frameworkChangeSetup();
    shadowGitPush();
    expect(wizard()([REPO_DIR]).status).toBe(0);
    expect(existsSync(join(REPO_DIR, ".git", "cs-references-update-wizard.json"))).toBe(false);
    removeShadowGit();
  });

  it("runs pr-create in the target repository, not the caller's directory", () => {
    frameworkChangeSetup();
    writeFake("pr-create", '#!/usr/bin/env bash\npwd > "${CAPTURE_FILE:?}"\necho "https://github.com/test-org/test-repo/pull/1"\n');
    shadowGitPush();
    const captured = join(TMP, "pr.cwd");
    const r = spawnSync("setsid", ["--wait", "node", join(FAKE_TOOLS, "ts", "wizard.ts"), REPO_DIR], {
      cwd: TMP,
      encoding: "utf8",
      env: { ...GIT_ENV(), PATH: `${BIN}:${GIT_ENV().PATH ?? ""}`, CAPTURE_FILE: captured },
    });
    expect(r.status).toBe(0);
    expect(readFileSync(captured, "utf8").trim()).toBe(REPO_DIR);
    removeShadowGit();
  });

  it("forwards --self-approve to pr-merge, and only when asked", () => {
    frameworkChangeSetup();
    const merges = join(TMP, "pr-merge.args");
    writeFake("pr-merge", `#!/usr/bin/env bash\necho "$*" >> "${merges}"\nexit 0\n`);
    shadowGitPush();
    expect(wizard()(["--self-approve", REPO_DIR]).status).toBe(0);
    expect(readFileSync(merges, "utf8")).toContain("--self-approve");
    removeShadowGit();
  });

  it("does not ask pr-merge to approve by default", () => {
    frameworkChangeSetup();
    const merges = join(TMP, "pr-merge.args");
    writeFake("pr-merge", `#!/usr/bin/env bash\necho "$*" >> "${merges}"\nexit 0\n`);
    shadowGitPush();
    expect(wizard()([REPO_DIR]).status).toBe(0);
    expect(readFileSync(merges, "utf8")).not.toContain("--self-approve");
    removeShadowGit();
  });

  it("takes pr-create's exit status as the outcome, whatever URL form it prints", () => {
    frameworkChangeSetup();
    const calls = join(TMP, "pr-create.calls");
    writeFake("pr-create", `#!/usr/bin/env bash\necho call >> "${calls}"\necho "/pullrequest/13055"\n`);
    shadowGitPush();
    const r = wizard()([REPO_DIR]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("PR created: /pullrequest/13055");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
    removeShadowGit();
  });
});

function datamodel(args: string[]): string[] {
  return args;
}
