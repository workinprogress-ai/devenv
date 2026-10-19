// Behavioral tests for core/git: repository state, branch pattern matching,
// WIP guards, and history-rewrite classification against a real temp repo.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCurrentBranch,
  isInGitRepo,
  isWorkingDirectoryClean,
  getDefaultBranch,
  branchMatchesPattern,
  branchExistsLocal,
  deleteLocalBranch,
  validateGitContext,
  wipRangeGuard,
  rewriteDetectState,
  repoUrlOwner,
} from "../../lib/core/git.ts";

function git(repo: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function commit(repo: string, msg: string, file: string): void {
  writeFileSync(join(repo, file), `${Date.now()}-${Math.random()}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "--no-verify", "-m", msg);
}

let repo: string;
let cleanup: () => void;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "git-core-test-"));
  git(repo, "init", "-q", "-b", "master");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  commit(repo, "initial", "a.txt");
  git(repo, "remote", "add", "origin", "https://example.com/acme/widgets.git");
  cleanup = () => rmSync(repo, { recursive: true, force: true });
});

afterAll(() => cleanup());

describe("repository state", () => {
  it("reports the current branch", () => {
    expect(getCurrentBranch(repo)).toBe("master");
  });
  it("detects a git repo and a clean tree", () => {
    expect(isInGitRepo(repo)).toBe(true);
    expect(isWorkingDirectoryClean(repo)).toBe(true);
  });
  it("resolves origin/HEAD as the default branch", () => {
    // No network: fabricate the remote-tracking ref and its HEAD symbol
    // exactly as a fetch would (git plumbing, not file writes).
    git(repo, "update-ref", "refs/remotes/origin/master", "HEAD");
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
    expect(getDefaultBranch(repo)).toBe("master");
  });
});

describe("branchMatchesPattern", () => {
  it("supports exact names and star globs", () => {
    expect(branchMatchesPattern("master", "master")).toBe(true);
    expect(branchMatchesPattern("release/1.4", "release/*")).toBe(true);
    expect(branchMatchesPattern("feature/x", "release/*")).toBe(false);
    expect(branchMatchesPattern("master", "ma*")).toBe(true);
    expect(branchMatchesPattern("main", "master")).toBe(false);
  });
});

describe("branch ops", () => {
  it("creates, detects, and deletes a local branch", () => {
    git(repo, "branch", "deleteme");
    expect(branchExistsLocal(repo, "deleteme")).toBe(true);
    expect(deleteLocalBranch(repo, "deleteme")).toBe(true);
    expect(branchExistsLocal(repo, "deleteme")).toBe(false);
  });
});

describe("validateGitContext", () => {
  it("passes on a clean repo with no exclusions", () => {
    expect(validateGitContext(repo)).toBeNull();
  });
  it("fails on an excluded current branch (glob)", () => {
    const reason = validateGitContext(repo, { excludeBranches: ["master", "release/*"] });
    expect(reason).toContain("Cannot run this script on master branch");
  });
  it("fails on a dirty tree", () => {
    writeFileSync(join(repo, "dirty.txt"), "x\n");
    const reason = validateGitContext(repo);
    expect(reason).toContain("uncommitted or staged changes");
    rmSync(join(repo, "dirty.txt"));
  });
  it("fails outside a repo", () => {
    const reason = validateGitContext(tmpdir());
    expect(reason).not.toBeNull();
  });
});

describe("wipRangeGuard", () => {
  it("passes a clean range (two real commits)", () => {
    // The range must resolve — an invalid range fails closed (gate contract),
    // so the clean-path test builds a genuine two-commit range.
    commit(repo, "second commit for range", "range-seed.txt");
    const r = wipRangeGuard(repo, "HEAD~1..HEAD");
    expect(r.ok).toBe(true);
  });
  it("rejects a range containing a WIP: commit", () => {
    commit(repo, "WIP: half done", "wip.txt");
    git(repo, "commit", "-q", "--amend", "-m", "WIP: half done");
    const r = wipRangeGuard(repo, "HEAD~1..HEAD");
    expect(r.ok).toBe(false);
    expect(r.offenders.some((l) => l.includes("WIP:"))).toBe(true);
  });
  it("fails closed on an invalid range (nonexistent ref)", () => {
    const r = wipRangeGuard(repo, "nonexistent-ref..HEAD");
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([]);
  });
  it("fails closed on a malformed range", () => {
    const r = wipRangeGuard(repo, "not-a-range..");
    expect(r.ok).toBe(false);
  });
  it("fails closed on an empty range argument", () => {
    const r = wipRangeGuard(repo, "");
    expect(r.ok).toBe(false);
  });
});

describe("rewriteDetectState", () => {
  it("reads 'none' for an up-to-date branch", () => {
    expect(rewriteDetectState(repo, "master").verdict).toBe("none");
  });

  it("classifies clean-reset vs diverged after a force-push rewrite", () => {
    // Build: base -> work1 (pushed) ; then rewrite remote to base->rewritten
    // and verify the local clone classifies.
    const upstream = mkdtempSync(join(tmpdir(), "rw-up-"));
    git(upstream, "init", "-q", "--bare", "-b", "master");
    git(repo, "push", "-q", upstream, "master");
    const clone = mkdtempSync(join(tmpdir(), "rw-clone-"));
    git(clone, "clone", "-q", upstream, ".");
    git(clone, "config", "user.email", "t@example.com");
    git(clone, "config", "user.name", "T");
    const pushedAt = git(clone, "rev-parse", "HEAD").trim();

    // local clone gains unique work (diverged side)
    commit(clone, "local unique work", "local.txt");

    // Upstream is rewritten by an independent writer with no shared
    // history (fresh init) — a true force-push rewrite, not a
    // fast-forward descendant of the old tip.
    const rewrite = mkdtempSync(join(tmpdir(), "rw-new-"));
    git(rewrite, "init", "-q", "-b", "master");
    git(rewrite, "config", "user.email", "t@example.com");
    git(rewrite, "config", "user.name", "T");
    commit(rewrite, "rewritten remote work", "rewritten.txt");
    git(rewrite, "push", "-q", "-f", upstream, "master");
    // Seed the remote-tracking reflog the way a long-lived clone accumulates
    // entries: the container's git does not log the clone's initial ref set,
    // so enable the reflog BEFORE the fetch (the forced update is then
    // logged), replay a logged move through the old tip, and restore the
    // fetched position. The classifier scans these %H entries for the past
    // tip; the ref must end at the rewritten value.
    git(clone, "config", "core.logAllRefUpdates", "true");
    git(clone, "fetch", "origin");
    rmSync(rewrite, { recursive: true, force: true });
    const rewritten = git(clone, "rev-parse", "refs/remotes/origin/master").trim();
    git(clone, "update-ref", "refs/remotes/origin/master", pushedAt);
    git(clone, "update-ref", "refs/remotes/origin/master", rewritten);

    const state = rewriteDetectState(clone, "master");
    // The clone's reflog records pushedAt as a past remote tip; local built
    // on it with unique work → diverged with that past tip.
    expect(state.verdict).toBe("diverged");
    if (state.verdict === "diverged") {
      expect(state.pastTip).toBe(pushedAt);
    }
    rmSync(clone, { recursive: true, force: true });
    rmSync(upstream, { recursive: true, force: true });
  });
});

describe("repoUrlOwner", () => {
  it("parses owner/name from the origin URL", () => {
    const owner = repoUrlOwner(repo);
    expect(owner).toEqual({ owner: "acme", name: "widgets" });
  });

  it("pins the URL shapes it must support (SSH with port, .git-less)", () => {
    // repoUrlOwner reads the URL itself, so exercise the parser directly
    // through repos with distinct remote shapes.
    const shapes: Array<[string, { owner: string; name: string }]> = [
      ["https://example.com/acme/widgets.git", { owner: "acme", name: "widgets" }],
      ["https://example.com/acme/widgets", { owner: "acme", name: "widgets" }],
      ["git@example.com:acme/widgets.git", { owner: "acme", name: "widgets" }],
      ["ssh://git@example.com:2222/acme/widgets.git", { owner: "acme", name: "widgets" }],
    ];
    for (const [url, expected] of shapes) {
      const r = mkdtempSync(join(tmpdir(), "url-shape-"));
      try {
        git(r, "init", "-q", "-b", "master");
        git(r, "remote", "add", "origin", url);
        expect(repoUrlOwner(r)).toEqual(expected);
      } finally {
        rmSync(r, { recursive: true, force: true });
      }
    }
  });

  it("returns null without an origin remote", () => {
    const bare = mkdtempSync(join(tmpdir(), "url-none-"));
    try {
      git(bare, "init", "-q", "-b", "master");
      expect(repoUrlOwner(bare)).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
