// Port of tools/tests/scripts/test_repo_bump_version.bats (4 tests)
// and test_repo_calc_version.bats (6 tests), kept as separate describes.
// repo-bump-version: usage/args contract; repo-calc-version: semver bump
// analysis over the merge range (fix/feat/breaking, multi-commit ranges).
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });


let TMP = "";
let WORK_REPO = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

function git(args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd: WORK_REPO, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `repover-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  // create isolated repo for each test (repo-calc-version's fixture)
  WORK_REPO = join(TMP, "repo");
  mkdirSync(WORK_REPO, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: WORK_REPO, env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: WORK_REPO, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: WORK_REPO, env: GIT_ENV() });
  writeFileSync(join(WORK_REPO, "README.md"), "initial\n");
  spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
  spawnSync("git", ["commit", "-q", "-m", "chore: initial"], { cwd: WORK_REPO, env: GIT_ENV() });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("scripts/repo-bump-version", () => {
  it("repo-bump-version.sh has valid syntax", () => {
    expect(spawnSync("node", ["--check", toolScript("repo-bump-version")]).status).toBe(0);
  });

  it("repo-bump-version.sh shows usage when missing args", () => {
    const r = spawnSync("node", [toolScript("repo-bump-version")], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage:");
  });

  it("repo-bump-version.sh rejects invalid change types", () => {
    const r = spawnSync("node", [toolScript("repo-bump-version"), "invalid", "repo-one"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Invalid change-type");
  });

  it("repo-bump-version.sh requires repository list", () => {
    const r = spawnSync("bash", ["-c", `node '${toolScript("repo-bump-version")}' patch < /dev/null 2>&1`], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("No repositories provided");
  });

  it("an empty or closed stdin is misuse (exit 2), not a crash", () => {
    const r = spawnSync("node", [toolScript("repo-bump-version"), "patch"], {
      encoding: "utf8",
      env: GIT_ENV(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain("EAGAIN");
  });

  it.each(["../x", "--select", "-x", "a/b", ".hidden/../x", "a b"])("rejects the repository name %j with exit 2 before touching anything", (name) => {
    const viaArg = spawnSync("node", [toolScript("repo-bump-version"), "patch", "--", name], { encoding: "utf8", env: { ...GIT_ENV(), DEVENV_ROOT: TMP } });
    expect(viaArg.status).toBe(2);
    expect(viaArg.stderr).toContain("Invalid repository name");
    const viaStdin = spawnSync("node", [toolScript("repo-bump-version"), "patch"], {
      encoding: "utf8",
      input: `${name}\n`,
      env: { ...GIT_ENV(), DEVENV_ROOT: TMP },
    });
    expect(viaStdin.status).toBe(2);
    expect(viaStdin.stderr).toContain("Invalid repository name");
  });
});

describe("scripts/repo-calc-version", () => {
  it("repo-calc-version returns default start when no tags", () => {
    const r = spawnSync("node", [toolScript("repo-calc-version")], { cwd: WORK_REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("1.0.0");
  });

  it("repo-calc-version bumps patch on fix commit", () => {
    git(["tag", "v1.2.0"]);
    appendFileSync(join(WORK_REPO, "README.md"), "bugfix\n");
    spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
    git(["commit", "-q", "-m", "fix: bug"]);
    const r = spawnSync("node", [toolScript("repo-calc-version")], { cwd: WORK_REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("1.2.1");
  });

  it("repo-calc-version bumps minor on feat commit", () => {
    git(["tag", "v1.2.0"]);
    appendFileSync(join(WORK_REPO, "README.md"), "feature\n");
    spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
    git(["commit", "-q", "-m", "feat: add thing"]);
    const r = spawnSync("node", [toolScript("repo-calc-version")], { cwd: WORK_REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("1.3.0");
  });

  it("repo-calc-version bumps major on breaking change", () => {
    git(["tag", "v1.2.0"]);
    appendFileSync(join(WORK_REPO, "README.md"), "breaking\n");
    spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
    git(["commit", "-q", "-m", "feat!: breaking change"]);
    const r = spawnSync("node", [toolScript("repo-calc-version")], { cwd: WORK_REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("2.0.0");
  });

  it("repo-calc-version analyzes every commit in a multi-commit merge range", () => {
    // Rebase merges land a branch as multiple commits, so the analyzer must
    // see each one and take the highest bump across the range.
    git(["tag", "v1.2.0"]);
    appendFileSync(join(WORK_REPO, "README.md"), "feature\n");
    spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
    git(["commit", "-q", "-m", "feat: add thing"]);
    appendFileSync(join(WORK_REPO, "README.md"), "bugfix\n");
    spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
    git(["commit", "-q", "-m", "fix: repair thing"]);
    const r = spawnSync("node", [toolScript("repo-calc-version")], { cwd: WORK_REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    // minor from feat wins over patch from fix — both were seen
    expect((r.stdout ?? "").trim()).toBe("1.3.0");
  });

  it("repo-calc-version takes major from breaking commit buried in a multi-commit range", () => {
    git(["tag", "v1.2.0"]);
    appendFileSync(join(WORK_REPO, "README.md"), "feature\n");
    spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
    git(["commit", "-q", "-m", "feat: add thing"]);
    git(["commit", "-q", "--allow-empty", "-m", "chore: middle of the branch"]);
    appendFileSync(join(WORK_REPO, "README.md"), "breaking\n");
    spawnSync("git", ["add", "README.md"], { cwd: WORK_REPO, env: GIT_ENV() });
    git(["commit", "-q", "-m", "fix!: reworked thing"]);
    const r = spawnSync("node", [toolScript("repo-calc-version")], { cwd: WORK_REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("2.0.0");
  });
});
