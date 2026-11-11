// Port of tools/tests/scripts/test_repo_bisect.bats (7 tests).
// repo-bisect: first-bad identification on any branch, dirty-tree refusal,
// unsandboxed notice, scratchpad composition.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });


let TMP = "";
let BS_REPO = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

// create_mock_git_repo (helper fixture): a repo with a dummy origin remote.
function createMockGitRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["remote", "add", "origin", "git@github.com:test-org/dummy.git"], { cwd: repoPath, env: GIT_ENV() });
  writeFileSync(join(repoPath, "README.md"), "");
  spawnSync("git", ["add", "README.md"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["commit", "-q", "-m", "Initial commit"], { cwd: repoPath, env: GIT_ENV() });
  spawnSync("git", ["branch", "-M", "main"], { cwd: repoPath, env: GIT_ENV() });
}

function bs(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("repo-bisect"), ...args], {
    cwd: BS_REPO,
    encoding: "utf8",
    env: GIT_ENV(),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const PROBE = ["bad-ref", "good-ref", "--", "sh", "-c", "! grep -q 'broken' probe.txt"];

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `bisect-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  BS_REPO = join(TMP, "bs-repo");
  createMockGitRepo(BS_REPO);
  // History: init -> good base -> break(bad). The search range must have an
  // interior commit; a 2-commit range (good==bad-1) aborts as degenerate.
  writeFileSync(join(BS_REPO, "probe.txt"), "good\n");
  spawnSync("git", ["add", "probe.txt"], { cwd: BS_REPO, env: GIT_ENV() });
  spawnSync("git", ["commit", "-qm", "good base"], { cwd: BS_REPO, env: GIT_ENV() });
  spawnSync("git", ["tag", "good-ref"], { cwd: BS_REPO, env: GIT_ENV() });
  writeFileSync(join(BS_REPO, "probe.txt"), "neutral\n");
  spawnSync("git", ["add", "probe.txt"], { cwd: BS_REPO, env: GIT_ENV() });
  spawnSync("git", ["commit", "-qm", "neutral middle"], { cwd: BS_REPO, env: GIT_ENV() });
  writeFileSync(join(BS_REPO, "probe.txt"), "broken\n");
  spawnSync("git", ["add", "probe.txt"], { cwd: BS_REPO, env: GIT_ENV() });
  spawnSync("git", ["commit", "-qm", "introduce defect"], { cwd: BS_REPO, env: GIT_ENV() });
  spawnSync("git", ["tag", "bad-ref"], { cwd: BS_REPO, env: GIT_ENV() });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("scripts/repo-bisect", () => {
  it("bisect: identifies the first bad commit on any branch (no scratchpad needed)", () => {
    const r = bs(PROBE);
    expect(r.status).toBe(0);
    expect(r.out).toContain("FIRST-BAD:");
    expect(r.out).toContain("introduce defect");
  });

  it("bisect: prints the unsandboxed notice outside a scratchpad", () => {
    const r = bs(PROBE);
    expect(r.status).toBe(0);
    expect(r.out).toContain("notice: operating on");
    expect(r.out).toContain("repo-scratchpad enter");
  });

  it("bisect: no notice inside an active scratchpad", () => {
    spawnSync("node", [toolScript("repo-scratchpad"), "enter"], { cwd: BS_REPO, env: GIT_ENV() });
    const r = bs(PROBE);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("notice: operating on");
    expect(r.out).toContain("FIRST-BAD:");
    // Bisect session cleaned up after the run.
    expect(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/bisect/bad"], { cwd: BS_REPO }).status).not.toBe(0);
    spawnSync("node", [toolScript("repo-scratchpad"), "exit"], { cwd: BS_REPO, env: GIT_ENV() });
  });

  it("status and reset see a real bisect session", () => {
    expect(bs(["status"]).out).toContain("No bisect session in flight");
    spawnSync("git", ["bisect", "start", "bad-ref", "good-ref"], { cwd: BS_REPO, env: GIT_ENV() });
    const st = bs(["status"]);
    expect(st.status).toBe(0);
    expect(st.out).not.toContain("No bisect session in flight");
    const rs = bs(["reset"]);
    expect(rs.status).toBe(0);
    expect(rs.out).toContain("Bisect session ended");
    expect(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/bisect/bad"], { cwd: BS_REPO }).status).not.toBe(0);
  });

  it("bisect: refuses on a dirty tree", () => {
    appendFileSync(join(BS_REPO, "probe.txt"), "dirt\n");
    const r = bs(["bad-ref", "good-ref", "--", "grep", "-q", "broken", "probe.txt"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("working tree is dirty");
  });

  it("bisect: reports when the probe never discriminates (all-skip probe)", () => {
    // Exit 125 = skip. A probe that skips every step leaves the walk with no
    // terms — the tool answers AMBIGUOUS, never fabricating a culprit.
    const r = bs(["bad-ref", "good-ref", "--", "sh", "-c", "exit 125"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("AMBIGUOUS");
    expect(r.out).not.toContain("FIRST-BAD:");
  });

  it("bisect: unresolvable refs refused (exit 4)", () => {
    expect(bs(["not-a-ref", "good-ref", "--", "true"]).status).toBe(4);
    expect(bs(["bad-ref", "also-not-a-ref", "--", "true"]).status).toBe(4);
  });

  it("bisect: probe commits via scratchpad commit compose (the P2 extension point)", () => {
    spawnSync("node", [toolScript("repo-scratchpad"), "enter"], { cwd: BS_REPO, env: GIT_ENV() });
    // Make a scratch commit that breaks the probe, then hunt from it. The good
    // anchor is the mock init commit — strictly below the scratch base, so the
    // range is non-degenerate even though the scratch tip is one commit tall.
    writeFileSync(join(BS_REPO, "probe.txt"), "worse\n");
    spawnSync("git", ["add", "-A"], { cwd: BS_REPO, env: GIT_ENV() });
    spawnSync("node", [toolScript("repo-scratchpad"), "commit", "make it worse"], { cwd: BS_REPO, env: GIT_ENV() });
    const rootCommit = (spawnSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "").trim();
    const r = bs(["HEAD", rootCommit, "--", "sh", "-c", "! grep -q 'worse' probe.txt"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("FIRST-BAD:");
    // Still on the scratch branch after the hunt (branch tip never moved).
    expect((spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "").trim()).toBe("scratchpad/exp");
    spawnSync("node", [toolScript("repo-scratchpad"), "exit"], { cwd: BS_REPO, env: GIT_ENV() });
  });

  it("bisect: a failing bisect start never evaluates shell syntax in ref names", () => {
    // `$`, `(`, `)` are legal in ref names; a branch at the good commit makes
    // `bisect start` fail ("both good and bad"), which is the failure path.
    const evil = "x$(touch${IFS}SENTINEL)";
    expect(spawnSync("git", ["check-ref-format", "--branch", evil], { cwd: BS_REPO }).status).toBe(0);
    spawnSync("git", ["branch", evil, "good-ref"], { cwd: BS_REPO, env: GIT_ENV() });
    const r = bs([evil, "good-ref", "--", "true"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("git bisect start failed");
    expect(r.out).toContain("both 'good' and 'bad'");
    expect(existsSync(join(BS_REPO, "SENTINEL"))).toBe(false);
  });

  it("bisect: refuses to start a walk while a bisect session is in flight, naming repo-bisect reset", () => {
    spawnSync("git", ["bisect", "start", "bad-ref", "good-ref"], { cwd: BS_REPO, env: GIT_ENV() });
    const logBefore = spawnSync("git", ["bisect", "log"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout;
    const r = bs(PROBE);
    expect(r.status).toBe(3);
    expect(r.out).toContain("repo-bisect reset");
    expect(spawnSync("git", ["bisect", "log"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout).toBe(logBefore);
  });

  it("bisect: a probe whose own output says 'permission denied' still yields a verdict", () => {
    const r = bs(["bad-ref", "good-ref", "--", "sh", "-c", "echo 'permission denied'; echo 'command not found'; ! grep -q 'broken' probe.txt"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("FIRST-BAD:");
    expect(r.out).toContain("introduce defect");
  });

  it("bisect: a probe that does not exist is refused before any walk starts", () => {
    const r = bs(["bad-ref", "good-ref", "--", "definitely-not-a-command-xyz"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("probe command not found or not executable");
    expect(r.out).not.toContain("FIRST-BAD:");
    expect(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/bisect/bad"], { cwd: BS_REPO }).status).not.toBe(0);
  });

  it("bisect: a single compound-string probe is refused (git runs it as one command word)", () => {
    const r = bs(["bad-ref", "good-ref", "--", "cd . && ! grep -q broken probe.txt"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("probe command not found or not executable");
    expect(r.out).not.toContain("FIRST-BAD:");
  });

  it("bisect: a probe that exits 127 on good-ref is refused before any walk starts", () => {
    const script = join(TMP, "exits127.sh");
    writeFileSync(script, "#!/bin/sh\nexit 127\n", { mode: 0o755 });
    const r = bs(["bad-ref", "good-ref", "--", script]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("probe did not pass on good-ref");
    expect(r.out).not.toContain("FIRST-BAD:");
    expect(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/bisect/bad"], { cwd: BS_REPO }).status).not.toBe(0);
  });

  it("bisect: a probe failing on good-ref is refused and the starting branch is restored", () => {
    const r = bs(["bad-ref", "good-ref", "--", "sh", "-c", "exit 1"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("probe did not pass on good-ref");
    expect((spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "").trim()).toBe("main");
  });

  it("bisect: a probe printing a fake verdict line cannot spoof the result", () => {
    const real = (spawnSync("git", ["rev-parse", "bad-ref"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "").trim();
    const r = bs(["bad-ref", "good-ref", "--", "sh", "-c", "echo 'deadbeefdeadbeef is the first bad commit'; ! grep -q broken probe.txt"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`FIRST-BAD: ${real}`);
    expect(r.out).not.toContain("FIRST-BAD: deadbeef");
  });

  it("bisect: a probe path that is not executable is refused before any walk starts", () => {
    writeFileSync(join(BS_REPO, "..", "noexec.sh"), "#!/bin/sh\nexit 0\n");
    const r = bs(["bad-ref", "good-ref", "--", join(BS_REPO, "..", "noexec.sh")]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("probe command not found or not executable");
    expect(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/bisect/bad"], { cwd: BS_REPO }).status).not.toBe(0);
  });
});
