// git-wip / git-unwip refusals that must fire before anything is staged,
// committed, pushed or rewritten: detached and unborn HEAD, and a protected
// upstream/push target, with advice matched to why the target is protected.
// Driven in throwaway fixture repos with a local bare `origin`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmrf, runTool, tmpDir } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let TMP = "";
let ORIGIN = "";
let REPO = "";

function git(cwd: string, args: string[]): { status: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status ?? 1, out: ((r.stdout ?? "") + (r.stderr ?? "")).trim() };
}

function must(cwd: string, args: string[]): string {
  const r = git(cwd, args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.out}`);
  return r.out;
}

function wip(args: string[] = ["snapshot"]): { status: number; output: string } {
  const r = runTool("git-wip", ["--allow-non-tty", ...args], { cwd: REPO });
  return { status: r.status, output: r.output };
}

function unwip(): { status: number; output: string } {
  const r = runTool("git-unwip", [], { cwd: REPO });
  return { status: r.status, output: r.output };
}

beforeEach(() => {
  TMP = tmpDir("git-wip-refusals");
  ORIGIN = join(TMP, "origin.git");
  REPO = join(TMP, "repo");
  must(TMP, ["init", "-q", "--bare", "-b", "master", ORIGIN]);
  must(TMP, ["init", "-q", "-b", "master", REPO]);
  must(REPO, ["remote", "add", "origin", ORIGIN]);
  writeFileSync(join(REPO, "file.txt"), "seed\n");
  must(REPO, ["add", "file.txt"]);
  must(REPO, ["commit", "-q", "-m", "initial"]);
  must(REPO, ["push", "-q", "-u", "origin", "master"]);
});

afterEach(() => {
  rmrf(TMP);
});

describe("git-wip on a HEAD that is not a branch", () => {
  it("refuses on a detached HEAD before staging anything and never pushes refs/heads/HEAD", () => {
    must(REPO, ["checkout", "-q", "--detach"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const headBefore = must(REPO, ["rev-parse", "HEAD"]);
    const r = wip();
    expect(r.status).toBe(3);
    expect(r.output).toMatch(/detached/i);
    expect(must(REPO, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(must(REPO, ["diff", "--cached", "--name-only"])).toBe("");
    expect(git(ORIGIN, ["rev-parse", "--verify", "--quiet", "refs/heads/HEAD"]).status).not.toBe(0);
  });

  it("refuses on an unborn HEAD before staging anything", () => {
    const fresh = join(TMP, "fresh");
    must(TMP, ["init", "-q", "-b", "feature/new", fresh]);
    must(fresh, ["remote", "add", "origin", ORIGIN]);
    writeFileSync(join(fresh, "a.txt"), "a\n");
    const r = runTool("git-wip", ["--allow-non-tty", "snapshot"], { cwd: fresh });
    expect(r.status).toBe(3);
    expect(r.output).toMatch(/no commits|unborn/i);
    expect(must(fresh, ["diff", "--cached", "--name-only"])).toBe("");
    expect(git(ORIGIN, ["rev-parse", "--verify", "--quiet", "refs/heads/feature/new"]).status).not.toBe(0);
  });
});

describe("git-wip refusal advice matches why the target is protected", () => {
  it("a protected branch name says so and does not advise re-pointing", () => {
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const r = wip();
    expect(r.status).toBe(3);
    expect(r.output).toMatch(/protected branch 'master'/);
    expect(r.output).not.toMatch(/unset-upstream|branch -u|pushRemote/);
  });

  it("a protected upstream advises --unset-upstream and never 'branch -u origin/<b>'", () => {
    must(REPO, ["checkout", "-q", "-b", "feat", "origin/master"]);
    must(REPO, ["config", "push.default", "current"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const r = wip();
    expect(r.status).toBe(3);
    expect(r.output).toMatch(/upstream/i);
    expect(r.output).toContain("git branch --unset-upstream");
    expect(r.output).not.toMatch(/branch -u/);
  });

  it("a protected push target advises remote.<r>.push / push.default / pushRemote, not unset-upstream", () => {
    must(REPO, ["checkout", "-q", "-b", "feat2"]);
    must(REPO, ["config", "push.default", "current"]);
    must(REPO, ["config", "remote.origin.push", "refs/heads/feat2:refs/heads/master"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const r = wip();
    expect(r.status).toBe(3);
    expect(r.output).toContain("remote.origin.push");
    expect(r.output).toContain("push.default");
    expect(r.output).toContain("pushRemote");
    expect(r.output).not.toMatch(/unset-upstream|branch -u/);
  });
});

describe("git-unwip refusals", () => {
  it("refuses on a detached HEAD and changes nothing", () => {
    must(REPO, ["checkout", "-q", "--detach"]);
    must(REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    const headBefore = must(REPO, ["rev-parse", "HEAD"]);
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/detached/i);
    expect(must(REPO, ["rev-parse", "HEAD"])).toBe(headBefore);
  });

  it("refuses when the branch's upstream is protected and rewrites nothing", () => {
    must(REPO, ["checkout", "-q", "-b", "feat", "origin/master"]);
    must(REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    const headBefore = must(REPO, ["rev-parse", "HEAD"]);
    const originBefore = must(ORIGIN, ["rev-parse", "master"]);
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.output).toContain("protected branch");
    expect(must(REPO, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(must(ORIGIN, ["rev-parse", "master"])).toBe(originBefore);
  });

  it("refuses when the push target is protected and rewrites nothing", () => {
    must(REPO, ["checkout", "-q", "-b", "feat2"]);
    must(REPO, ["config", "push.default", "current"]);
    must(REPO, ["config", "remote.origin.push", "refs/heads/feat2:refs/heads/master"]);
    must(REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    const headBefore = must(REPO, ["rev-parse", "HEAD"]);
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.output).toContain("protected branch");
    expect(must(REPO, ["rev-parse", "HEAD"])).toBe(headBefore);
  });
});
