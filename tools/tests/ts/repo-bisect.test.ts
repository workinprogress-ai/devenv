// Port of tools/tests/scripts/test_repo_bisect.bats (7 tests).
// repo-bisect: first-bad identification on any branch, dirty-tree refusal,
// unsandboxed notice, scratchpad composition.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

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
  const r = spawnSync("bash", [join(TOOLS, "repo-bisect"), ...args], {
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
    spawnSync("bash", [join(TOOLS, "repo-scratchpad"), "enter"], { cwd: BS_REPO, env: GIT_ENV() });
    const r = bs(PROBE);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("notice: operating on");
    expect(r.out).toContain("FIRST-BAD:");
    // Bisect session cleaned up after the run.
    expect(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/bisect/start"], { cwd: BS_REPO }).status).not.toBe(0);
    spawnSync("bash", [join(TOOLS, "repo-scratchpad"), "exit"], { cwd: BS_REPO, env: GIT_ENV() });
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
    spawnSync("bash", [join(TOOLS, "repo-scratchpad"), "enter"], { cwd: BS_REPO, env: GIT_ENV() });
    // Make a scratch commit that breaks the probe, then hunt from it. The good
    // anchor is the mock init commit — strictly below the scratch base, so the
    // range is non-degenerate even though the scratch tip is one commit tall.
    writeFileSync(join(BS_REPO, "probe.txt"), "worse\n");
    spawnSync("git", ["add", "-A"], { cwd: BS_REPO, env: GIT_ENV() });
    spawnSync("bash", [join(TOOLS, "repo-scratchpad"), "commit", "make it worse"], { cwd: BS_REPO, env: GIT_ENV() });
    const rootCommit = (spawnSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "").trim();
    const r = bs(["HEAD", rootCommit, "--", "sh", "-c", "! grep -q 'worse' probe.txt"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("FIRST-BAD:");
    // Still on the scratch branch after the hunt (branch tip never moved).
    expect((spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: BS_REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "").trim()).toBe("scratchpad/exp");
    spawnSync("bash", [join(TOOLS, "repo-scratchpad"), "exit"], { cwd: BS_REPO, env: GIT_ENV() });
  });
});
