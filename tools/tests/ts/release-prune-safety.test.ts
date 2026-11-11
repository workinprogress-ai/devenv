// Release tag selection, repo-version-list ordering, and git-prune-branches
// merge proofs, in throwaway fixture repos (local bare repo as origin).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CALLS_LOG_NAME, pathWithStubs, rmrf, runTool, stubCalls, stubCli, tmpDir } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let TMP = "";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(cwd: string, msg: string, file = `${msg.replace(/\W+/g, "-")}.txt`): void {
  writeFileSync(join(cwd, file), `${msg}\n`);
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "--no-verify", "-m", msg);
}

beforeEach(() => {
  TMP = tmpDir("release-prune-safety");
});

afterEach(() => rmrf(TMP));

function initRepo(dir: string): void {
  git(TMP, "init", "-q", "-b", "master", dir);
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
}

// ---------------------------------------------------------------------------
// repo-calc-version: tag selection
// ---------------------------------------------------------------------------

describe("release tag selection", () => {
  it("bumps from the highest tag that is an ancestor of HEAD, ignoring unrelated tags", () => {
    const repo = join(TMP, "repo");
    initRepo(repo);
    commit(repo, "chore: initial");
    git(repo, "tag", "v1.0.0");
    git(repo, "switch", "-q", "-c", "side");
    commit(repo, "feat: unrelated side work");
    git(repo, "tag", "v2.0.0");
    git(repo, "switch", "-q", "master");
    commit(repo, "feat: real feature");
    const r = runTool("repo-calc-version", [], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("1.1.0");
  });

  it("with no tags the first release starts at 1.0.0 and one feat bumps to 1.1.0", () => {
    const repo = join(TMP, "repo");
    initRepo(repo);
    commit(repo, "feat: first feature");
    const r = runTool("repo-calc-version", [], { cwd: repo });
    expect(r.stdout.trim()).toBe("1.1.0");
    expect(runTool("repo-calc-version", ["--help"], { cwd: repo }).output).toMatch(/no tags/i);
  });
});

// ---------------------------------------------------------------------------
// repo-version-list
// ---------------------------------------------------------------------------

describe("repo-version-list", () => {
  function tagged(): string {
    const repo = join(TMP, "repo");
    initRepo(repo);
    for (const [i, tag] of ["v1.2.0", "v1.9.0", "v1.10.0"].entries()) {
      commit(repo, `feat: release ${i}`);
      git(repo, "tag", tag);
    }
    return repo;
  }

  it("lists tags in version order and marks only the first release", () => {
    const repo = tagged();
    const r = runTool("repo-version-list", [], { cwd: repo });
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.trim() !== "");
    const tagsInOrder = lines.map((l) => /v\d+\.\d+\.\d+/.exec(l)?.[0]);
    expect(tagsInOrder).toEqual(["v1.2.0", "v1.9.0", "v1.10.0"]);
    expect(lines[0]).toContain("🔷");
    expect(lines[1]).not.toContain("🔷");
    expect(lines[2]).not.toContain("🔷");
  });

  it("runs a constant number of git processes however many tags there are", () => {
    const repo = tagged();
    const bin = tmpDir("version-list-bin");
    try {
      const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
      stubCli(bin, "git", `#!/bin/sh\nprintf '%s\\n' "git $*" >> "${join(bin, CALLS_LOG_NAME)}"\nexec "${realGit}" "$@"\n`);
      const r = runTool("repo-version-list", [], { cwd: repo, env: { PATH: pathWithStubs(bin) } });
      expect(r.status).toBe(0);
      expect(stubCalls(bin, "git").length).toBeLessThanOrEqual(4);
    } finally {
      rmrf(bin);
    }
  });
});

// ---------------------------------------------------------------------------
// git-prune-branches
// ---------------------------------------------------------------------------

describe("git-prune-branches merge proof", () => {
  let remote = "";
  let repo = "";

  function prune(args: string[], input: string): { status: number; out: string } {
    const r = runTool("git-prune-branches", args, {
      stdin: input,
      cwd: repo,
      env: { GIT_ASKPASS: "echo", GIT_TERMINAL_PROMPT: "0" },
    });
    return { status: r.status, out: r.output };
  }

  function exists(name: string): boolean {
    return git(repo, "branch", "--list", name) !== "";
  }

  function goneBranch(name: string, msg: string): string {
    git(repo, "switch", "-q", "-c", name, "master");
    commit(repo, msg);
    const sha = git(repo, "rev-parse", "HEAD");
    git(repo, "push", "-q", "-u", "origin", name);
    git(repo, "push", "-q", "origin", "--delete", name);
    git(repo, "switch", "-q", "master");
    return sha;
  }

  beforeEach(() => {
    remote = join(TMP, "remote.git");
    repo = join(TMP, "repo");
    git(TMP, "init", "-q", "--bare", "-b", "master", remote);
    git(TMP, "clone", "-q", remote, repo);
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "T");
    commit(repo, "initial");
    git(repo, "push", "-q", "origin", "master");
    git(repo, "remote", "set-head", "origin", "master");
  });

  it("does not delete a branch whose commits are only on the current feature branch (patch equivalent)", () => {
    const sha = goneBranch("feature/x", "feature x work");
    git(repo, "switch", "-q", "-c", "feature/other", "master");
    git(repo, "cherry-pick", sha);
    const r = prune([], "Y");
    expect(r.status).toBe(0);
    expect(exists("feature/x")).toBe(true);
    expect(r.out).toContain("SKIPPED");
  });

  it("does not delete a branch that is merely an ancestor of the current feature branch", () => {
    goneBranch("feature/x", "feature x work");
    git(repo, "switch", "-q", "-c", "feature/other", "feature/x");
    git(repo, "switch", "-q", "feature/other");
    const r = prune([], "Y");
    expect(r.status).toBe(0);
    expect(exists("feature/x")).toBe(true);
  });

  it("still deletes a branch whose work really landed on origin's default branch", () => {
    const sha = goneBranch("feature/landed", "landed work");
    git(repo, "cherry-pick", sha);
    git(repo, "push", "-q", "origin", "master");
    git(repo, "switch", "-q", "-c", "feature/other", "master");
    const r = prune([], "Y");
    expect(r.status).toBe(0);
    expect(exists("feature/landed")).toBe(false);
  });

  it("handles a branch name containing '|' (gone and landed, and alive)", () => {
    const sha = goneBranch("gone|pipe", "pipe work");
    git(repo, "cherry-pick", sha);
    git(repo, "push", "-q", "origin", "master");
    git(repo, "switch", "-q", "-c", "alive|pipe", "master");
    commit(repo, "alive work");
    git(repo, "push", "-q", "-u", "origin", "alive|pipe");
    git(repo, "switch", "-q", "master");
    const r = prune([], "Y");
    expect(r.status).toBe(0);
    expect(exists("gone|pipe")).toBe(false);
    expect(exists("alive|pipe")).toBe(true);
  });
});
