// Port of tools/tests/scripts/test_repo_cache_deepen.bats (12 tests).
// repo-cache-deepen: history deepening over a shallow single-branch clone,
// branch fetches as remote refs, no checkout, idempotency, failure paths.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let REMOTE_REPO = "";
let SOURCE_REPO = "";
let REPO_CACHE_DIR = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@test.com",
});

function gitIn(repo: string, args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

function deepen(args: string[]): { status: number; out: string } {
  const r = spawnSync("bash", [join(TOOLS, "repo-cache-deepen"), ...args], {
    encoding: "utf8",
    env: { ...GIT_ENV(), REPO_CACHE_DIR, DEVENV_TOOLS: TOOLS },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `cachedeep-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  // Build a local "remote" repo with history, plus a feature branch
  REMOTE_REPO = join(TMP, "remote.git");
  SOURCE_REPO = join(TMP, "source");
  mkdirSync(SOURCE_REPO, { recursive: true });
  spawnSync("git", ["init", "-q", "--bare", REMOTE_REPO], { env: GIT_ENV() });
  spawnSync("git", ["init", "-q"], { cwd: SOURCE_REPO, env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: SOURCE_REPO, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: SOURCE_REPO, env: GIT_ENV() });
  gitIn(SOURCE_REPO, ["commit", "-q", "--allow-empty", "-m", "c1"]);
  gitIn(SOURCE_REPO, ["commit", "-q", "--allow-empty", "-m", "c2"]);
  gitIn(SOURCE_REPO, ["branch", "-M", "master"]);
  gitIn(SOURCE_REPO, ["checkout", "-q", "-b", "issue-42-feature"]);
  gitIn(SOURCE_REPO, ["commit", "-q", "--allow-empty", "-m", "branch work"]);
  gitIn(SOURCE_REPO, ["checkout", "-q", "master"]);
  gitIn(SOURCE_REPO, ["push", "-q", REMOTE_REPO, "--all"]);
  // Shallow single-branch clone in a test cache dir (mirrors repo-cache.bash).
  // file:// prefix is required: local-path clones ignore --depth.
  REPO_CACHE_DIR = join(TMP, "cache", "repo_cache");
  mkdirSync(REPO_CACHE_DIR, { recursive: true });
  spawnSync("git", ["clone", "-q", "--depth", "1", "--single-branch", "--no-tags", `file://${REMOTE_REPO}`, join(REPO_CACHE_DIR, "repo-alpha")], { env: GIT_ENV() });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("scripts/repo-cache-deepen", () => {
  it("repo-cache-deepen script exists and is executable", () => {
    spawnSync("chmod", ["+x", join(TOOLS, "repo-cache-deepen")]);
    expect(spawnSync("test", ["-x", join(TOOLS, "repo-cache-deepen")]).status).toBe(0);
  });

  it("repo-cache-deepen script has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", join(TOOLS, "repo-cache-deepen")]).status).toBe(0);
  });

  it("repo-cache-deepen requires --repo", () => {
    const r = deepen([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--repo is required");
  });

  it("repo-cache-deepen fails on unknown repo", () => {
    const r = deepen(["--repo", "does-not-exist"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("not found in cache");
  });

  it("repo-cache-deepen rejects non-numeric depth", () => {
    const r = deepen(["--repo", "repo-alpha", "--depth", "abc"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--depth must be a positive integer");
  });

  it("repo-cache-deepen deepens history (more commits reachable)", () => {
    const cached = join(REPO_CACHE_DIR, "repo-alpha");
    const before = Number.parseInt((gitIn(cached, ["rev-list", "--count", "HEAD"]).stdout ?? "0").trim(), 10);
    const r = deepen(["--repo", "repo-alpha", "--depth", "10"]);
    expect(r.status).toBe(0);
    const after = Number.parseInt((gitIn(cached, ["rev-list", "--count", "HEAD"]).stdout ?? "0").trim(), 10);
    expect(after).toBeGreaterThan(before);
  });

  it("repo-cache-deepen never checks out (working copy stays on master)", () => {
    const r = deepen(["--repo", "repo-alpha", "--branch", "issue-42-feature"]);
    expect(r.status).toBe(0);
    expect((gitIn(join(REPO_CACHE_DIR, "repo-alpha"), ["branch", "--show-current"]).stdout ?? "").trim()).toBe("master");
  });

  it("repo-cache-deepen fetches branch as remote ref", () => {
    const r = deepen(["--repo", "repo-alpha", "--branch", "issue-42-feature"]);
    expect(r.status).toBe(0);
    expect(gitIn(join(REPO_CACHE_DIR, "repo-alpha"), ["rev-parse", "--verify", "refs/remotes/origin/issue-42-feature"]).status).toBe(0);
  });

  it("repo-cache-deepen fetches multiple branches", () => {
    gitIn(SOURCE_REPO, ["checkout", "-q", "-b", "issue-57-audit"]);
    gitIn(SOURCE_REPO, ["commit", "-q", "--allow-empty", "-m", "audit work"]);
    gitIn(SOURCE_REPO, ["push", "-q", REMOTE_REPO, "issue-57-audit"]);
    const r = deepen(["--repo", "repo-alpha", "--branch", "issue-42-feature", "--branch", "issue-57-audit"]);
    expect(r.status).toBe(0);
    const cached = join(REPO_CACHE_DIR, "repo-alpha");
    expect(gitIn(cached, ["rev-parse", "--verify", "refs/remotes/origin/issue-42-feature"]).status).toBe(0);
    expect(gitIn(cached, ["rev-parse", "--verify", "refs/remotes/origin/issue-57-audit"]).status).toBe(0);
  });

  it("repo-cache-deepen is idempotent (re-run succeeds)", () => {
    expect(deepen(["--repo", "repo-alpha", "--branch", "issue-42-feature"]).status).toBe(0);
    expect(deepen(["--repo", "repo-alpha", "--branch", "issue-42-feature"]).status).toBe(0);
  });

  it("repo-cache-deepen fails on fetch failure (bad remote)", () => {
    // Point the cached repo's origin at a nonexistent path
    gitIn(join(REPO_CACHE_DIR, "repo-alpha"), ["remote", "set-url", "origin", join(TMP, "no-such-remote.git")]);
    const r = deepen(["--repo", "repo-alpha"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Failed to deepen history");
  });

  it("repo-cache-deepen fails on unknown branch", () => {
    const r = deepen(["--repo", "repo-alpha", "--branch", "no-such-branch"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Failed to fetch branch");
  });
});
