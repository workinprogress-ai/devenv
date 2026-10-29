// Behavioral tests for git-prune-branches against a real git fixture repo:
// upstream-gone detection, cherry-equivalence deletion (rebase-merged work),
// unique-commit skip, --force override, and the no-gone no-op — driven
// through the tool with a faked remote (local bare repo; no network).
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(fileURLToPath(new URL(".", import.meta.url)), "../../ts/git-prune-branches.ts");

let remote: string;
let repo: string;
let cleanup: () => void;

function git(target: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function commit(target: string, msg: string, file: string): void {
  writeFileSync(join(target, file), `${msg}-${Date.now()}-${Math.random()}\n`);
  git(target, "add", ".");
  git(target, "commit", "-q", "--no-verify", "-m", msg);
}

function runTool(args: string[], input: string): { status: number; out: string } {
  const r = spawnSync("node", [TOOL, ...args], {
    encoding: "utf8",
    input,
    cwd: repo,
    env: { ...process.env, GIT_ASKPASS: "echo", GIT_TERMINAL_PROMPT: "0" },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function branchExists(name: string): boolean {
  const r = spawnSync("git", ["-C", repo, "branch", "--list", name], { encoding: "utf8" });
  return (r.stdout ?? "").trim() !== "";
}

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), "prune-test-"));
  remote = join(root, "remote.git");
  repo = join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "master", "remote.git");
  git(root, "clone", "-q", remote, "repo");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  commit(repo, "initial", "a.txt");
  git(repo, "push", "-q", "origin", "master");
  cleanup = () => rmSync(root, { recursive: true, force: true });
});

afterAll(() => cleanup());

/** A branch pushed to origin then deleted from origin: its upstream is gone. */
function makeGoneBranch(name: string, commits: string[]): void {
  git(repo, "switch", "-c", name);
  for (const c of commits) commit(repo, c, `${c.replace(/\s+/g, "-")}.txt`);
  git(repo, "push", "-q", "-u", "origin", name); // -u sets the upstream config
  git(repo, "push", "-q", "origin", "--delete", name);
}

describe("git-prune-branches (real git fixture)", () => {
  it("no gone upstream is a clean no-op", () => {
    const r = runTool([], "");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Nothing to prune");
  });

  it("cherry-equivalent branch (rebase-merged work) is deleted by patch content", () => {
    // The branch's commits land on master rebased (hashes rewritten, patch
    // content identical), then the remote branch is deleted: -d refuses,
    // cherry proves the work landed, -D fires.
    makeGoneBranch("feature/rebased", ["rebased work one"]);
    git(repo, "switch", "master");
    // Rebase the same patch onto master with a shifted committer date: the
    // rewritten commit has a DIFFERENT sha (a real rebase) but the same
    // patch-id — exactly what git cherry's equivalence detects.
    const sha = git(repo, "log", "--format=%H", "-1", "feature/rebased").trim();
    spawnSync("git", ["-C", repo, "cherry-pick", sha], {
      encoding: "utf8",
      env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z" },
    });
    // Simulate the real-world state: the local branch still points at the
    // pre-rebase sha WITH its upstream configured (reset it — cherry-pick
    // left the branch checked out at its old tip; switch away first is not
    // needed since we only move the ref), and the remote-tracking ref is
    // still present until a fetch -p clears it — the tool's own fetch does
    // that.
    git(repo, "branch", "-f", "feature/rebased", sha);
    git(repo, "update-ref", `refs/remotes/origin/feature/rebased`, sha);
    git(repo, "branch", "--set-upstream-to=origin/feature/rebased", "feature/rebased");
    const r = runTool([], "Y");
    expect(r.status).toBe(0);
    expect(r.out).toContain("fully merged by patch content");
    expect(branchExists("feature/rebased")).toBe(false);
    // cleanup the picked commit for the next scenario
    git(repo, "reset", "-q", "--hard", "HEAD~1");
  });

  it("a branch with unique commits is skipped even under the default path", () => {
    makeGoneBranch("feature/unique", ["unique work only here"]);
    git(repo, "switch", "master");
    const r = runTool([], "Y");
    expect(r.status).toBe(0);
    expect(r.out).toContain("SKIPPED");
    expect(r.out).toContain("--force");
    expect(branchExists("feature/unique")).toBe(true);
  });

  it("--force deletes every upstream-gone branch unconditionally", () => {
    // feature/unique from the previous scenario still exists, still gone.
    const r = runTool(["--force"], "Y");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Deleted (forced): feature/unique");
    expect(branchExists("feature/unique")).toBe(false);
  });

  it("a branch whose upstream still exists is never touched", () => {
    // A live-upstream branch in the same repo as gone ones: the prune list
    // never includes it.
    git(repo, "switch", "-c", "feature/alive");
    commit(repo, "alive work", "alive.txt");
    git(repo, "push", "-q", "-u", "origin", "feature/alive");
    git(repo, "switch", "master");
    makeGoneBranch("feature/gone2", ["gone2 work"]);
    git(repo, "switch", "master");
    const r = runTool([], "Y");
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("feature/alive");
    expect(branchExists("feature/alive")).toBe(true);
  });

  it("a skipped branch does not stop the others from being deleted", () => {
    // Two gone branches: one with unique work (skipped), one cherry-clean
    // (deleted). The skip must not poison the batch.
    makeGoneBranch("feature/skipme", ["skipme unique"]);
    // deleteme is genuinely merged: it points at master's tip (no unique
    // work), with its upstream gone (makeGoneBranch's push+delete made the
    // upstream config exist; reset the ref to master's tip so -d succeeds).
    makeGoneBranch("feature/deleteme", ["deleteme work"]);
    git(repo, "switch", "master");
    git(repo, "branch", "-f", "feature/deleteme", "master");
    git(repo, "switch", "master");
    const r = runTool([], "Y");
    expect(r.status).toBe(0);
    expect(r.out).toContain("SKIPPED");
    expect(branchExists("feature/skipme")).toBe(true);
    expect(branchExists("feature/deleteme")).toBe(false);
    git(repo, "branch", "-D", "feature/skipme", "feature/gone2");
  });

  it("aborting the confirm deletes nothing", () => {
    makeGoneBranch("feature/abort", ["aborted work"]);
    git(repo, "switch", "master");
    const r = runTool([], "n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Aborted");
    expect(branchExists("feature/abort")).toBe(true);
    git(repo, "branch", "-D", "feature/abort");
  });
});
