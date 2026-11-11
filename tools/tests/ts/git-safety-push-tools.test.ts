// Safety gates of the history-rewriting and push tools, driven in throwaway
// fixture repos (local bare repos stand in for `origin`; gh is stubbed):
// repo-bump-version, git-wip, git-unwip, git-update. Each case pins a state in
// which the tool must refuse BEFORE it mutates anything, or must never leave a
// half-finished state behind.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  pathWithStubs,
  rmrf,
  runTool,
  stubGh,
  tmpDir,
  tmpToolboxRoot,
} from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let TMP = "";

function git(cwd: string, args: string[]): { status: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status ?? 1, out: ((r.stdout ?? "") + (r.stderr ?? "")).trim() };
}

function must(cwd: string, args: string[]): string {
  const r = git(cwd, args);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.out}`);
  return r.out;
}

function rev(cwd: string, ref: string): string {
  return must(cwd, ["rev-parse", ref]);
}

function commit(cwd: string, subject: string): void {
  must(cwd, ["commit", "-q", "--allow-empty", "-m", subject]);
}

beforeEach(() => {
  TMP = tmpDir("git-safety-push");
});

afterEach(() => {
  rmrf(TMP);
});

// ---------------------------------------------------------------------------
// repo-bump-version
// ---------------------------------------------------------------------------

describe("repo-bump-version preconditions", () => {
  let ROOT = "";
  let BIN = "";
  let ORIGIN = "";
  let CLONE = "";

  function bump(args: string[]): { status: number; output: string } {
    const r = runTool("repo-bump-version", args, {
      env: { DEVENV_ROOT: ROOT, PATH: pathWithStubs(BIN) },
    });
    return { status: r.status, output: r.output };
  }

  beforeEach(() => {
    ROOT = tmpToolboxRoot("bump-root");
    BIN = tmpDir("bump-bin");
    stubGh(BIN);
    ORIGIN = join(TMP, "origin.git");
    must(TMP, ["init", "-q", "--bare", "-b", "main", ORIGIN]);
    const seed = join(TMP, "seed");
    must(TMP, ["init", "-q", "-b", "main", seed]);
    must(seed, ["remote", "add", "origin", ORIGIN]);
    commit(seed, "chore: base");
    must(seed, ["push", "-q", "origin", "main"]);
    mkdirSync(join(ROOT, "repos"), { recursive: true });
    CLONE = join(ROOT, "repos", "r1");
    must(TMP, ["clone", "-q", ORIGIN, CLONE]);
  });

  afterEach(() => {
    rmrf(ROOT);
    rmrf(BIN);
  });

  it("refuses unpushed local commits on the default branch and publishes nothing", () => {
    commit(CLONE, "feat: unreviewed local work");
    const originBefore = rev(ORIGIN, "main");
    const localBefore = rev(CLONE, "HEAD");
    const r = bump(["patch", "r1", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(rev(ORIGIN, "main")).toBe(originBefore);
    expect(rev(CLONE, "HEAD")).toBe(localBefore);
    expect(r.output).toMatch(/unpushed/i);
  });

  it("refuses a dirty working tree and publishes nothing", () => {
    writeFileSync(join(CLONE, "dirty.txt"), "x\n");
    must(CLONE, ["add", "dirty.txt"]);
    const originBefore = rev(ORIGIN, "main");
    const localBefore = rev(CLONE, "HEAD");
    const r = bump(["patch", "r1", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(rev(ORIGIN, "main")).toBe(originBefore);
    expect(rev(CLONE, "HEAD")).toBe(localBefore);
    expect(r.output).toMatch(/uncommitted|clean/i);
  });

  it("without --yes and without a terminal it refuses, naming what would be pushed", () => {
    const originBefore = rev(ORIGIN, "main");
    const r = bump(["patch", "r1"]);
    expect(r.status).not.toBe(0);
    expect(rev(ORIGIN, "main")).toBe(originBefore);
    expect(r.output).toContain("r1");
    expect(r.output).toContain("main");
    expect(r.output).toMatch(/--yes/);
  });

  it("when the push fails after the commit it prints the exact undo", () => {
    const hook = join(ORIGIN, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho rejected-by-fixture >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const r = bump(["patch", "r1", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("git reset --keep HEAD~1");
    expect(r.output).toMatch(/exactly one commit/);
    expect(r.output).not.toContain("--hard");
    expect(r.output).toContain(CLONE);
  });

  it("with a clean, pushed default branch and --yes it pushes exactly one empty commit", () => {
    const originBefore = rev(ORIGIN, "main");
    const r = bump(["patch", "r1", "--yes"]);
    expect(r.status).toBe(0);
    expect(must(ORIGIN, ["rev-list", "--count", `${originBefore}..main`])).toBe("1");
    expect(must(ORIGIN, ["log", "-1", "--format=%s", "main"])).toContain("force version update");
  });
});

// ---------------------------------------------------------------------------
// git-wip
// ---------------------------------------------------------------------------

describe("git-wip protected branches", () => {
  let ORIGIN = "";
  let REPO = "";

  function wip(args: string[]): { status: number; output: string } {
    const r = runTool("git-wip", ["--allow-non-tty", ...args], { cwd: REPO });
    return { status: r.status, output: r.output };
  }

  beforeEach(() => {
    ORIGIN = join(TMP, "origin.git");
    REPO = join(TMP, "repo");
    must(TMP, ["init", "-q", "--bare", ORIGIN]);
    must(TMP, ["init", "-q", REPO]);
    must(REPO, ["remote", "add", "origin", ORIGIN]);
    writeFileSync(join(REPO, "file.txt"), "seed\n");
    must(REPO, ["add", "file.txt"]);
    must(REPO, ["commit", "-q", "-m", "initial"]);
  });

  for (const name of ["master", "main", "release/1.4"]) {
    it(`refuses on '${name}' and stages, commits and pushes nothing`, () => {
      if (name !== "master") must(REPO, ["checkout", "-q", "-b", name]);
      must(REPO, ["push", "-q", "-u", "origin", name]);
      writeFileSync(join(REPO, "file.txt"), "changed\n");
      const headBefore = rev(REPO, "HEAD");
      const originBefore = rev(ORIGIN, name);
      const r = wip(["snapshot"]);
      expect(r.status).toBe(3);
      expect(r.output).toMatch(/protected/i);
      expect(rev(REPO, "HEAD")).toBe(headBefore);
      expect(rev(ORIGIN, name)).toBe(originBefore);
      expect(must(REPO, ["diff", "--cached", "--name-only"])).toBe("");
    });
  }

  it("refuses on the remote's default branch even when it has an unusual name", () => {
    must(REPO, ["checkout", "-q", "-b", "trunk"]);
    must(REPO, ["push", "-q", "-u", "origin", "trunk"]);
    must(ORIGIN, ["symbolic-ref", "HEAD", "refs/heads/trunk"]);
    must(REPO, ["remote", "set-head", "origin", "trunk"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const r = wip(["snapshot"]);
    expect(r.status).toBe(3);
    expect(must(REPO, ["diff", "--cached", "--name-only"])).toBe("");
  });

  it("still snapshots a feature branch", () => {
    must(REPO, ["checkout", "-q", "-b", "feature/x"]);
    must(REPO, ["push", "-q", "-u", "origin", "feature/x"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const r = wip(["snapshot"]);
    expect(r.status).toBe(0);
    expect(must(ORIGIN, ["log", "-1", "--format=%s", "feature/x"])).toBe("WIP: snapshot");
  });
});

describe("git-wip push target", () => {
  let ORIGIN = "";
  let REPO = "";

  function wip(args: string[]): { status: number; output: string } {
    const r = runTool("git-wip", ["--allow-non-tty", ...args], { cwd: REPO });
    return { status: r.status, output: r.output };
  }

  beforeEach(() => {
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

  for (const mode of ["upstream", "tracking", "matching"]) {
    it(`refuses a feature branch tracking origin/master under push.default=${mode} and pushes nothing`, () => {
      must(REPO, ["checkout", "-q", "-b", "feat", "origin/master"]);
      must(REPO, ["config", "push.default", mode]);
      writeFileSync(join(REPO, "file.txt"), "changed\n");
      const originBefore = rev(ORIGIN, "master");
      const headBefore = rev(REPO, "HEAD");
      const r = wip(["snapshot"]);
      expect(r.status).toBe(3);
      expect(r.output).toMatch(/protected/i);
      expect(rev(ORIGIN, "master")).toBe(originBefore);
      expect(rev(REPO, "HEAD")).toBe(headBefore);
      expect(must(REPO, ["diff", "--cached", "--name-only"])).toBe("");
      expect(git(ORIGIN, ["rev-parse", "--verify", "--quiet", "refs/heads/feat"]).status).not.toBe(0);
    });
  }

  it("refuses when the push target (pushRemote/@{push}) names a protected branch", () => {
    must(REPO, ["checkout", "-q", "-b", "feat2", "origin/master"]);
    must(REPO, ["config", "branch.feat2.merge", "refs/heads/feat2"]);
    must(REPO, ["config", "push.default", "current"]);
    must(REPO, ["config", "remote.origin.push", "refs/heads/feat2:refs/heads/master"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const originBefore = rev(ORIGIN, "master");
    const r = wip(["snapshot"]);
    expect(r.status).toBe(3);
    expect(rev(ORIGIN, "master")).toBe(originBefore);
  });

  it("pushes a normal feature branch to its own name, even with no upstream", () => {
    must(REPO, ["checkout", "-q", "-b", "feature/own"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const originBefore = rev(ORIGIN, "master");
    const r = wip(["snapshot"]);
    expect(r.status).toBe(0);
    expect(must(ORIGIN, ["log", "-1", "--format=%s", "feature/own"])).toBe("WIP: snapshot");
    expect(rev(ORIGIN, "master")).toBe(originBefore);
  });

  it("push.default=matching never drags another local branch to the remote", () => {
    must(REPO, ["config", "push.default", "matching"]);
    commit(REPO, "local-only master work");
    must(REPO, ["checkout", "-q", "-b", "feature/m"]);
    must(REPO, ["push", "-q", "-u", "origin", "feature/m"]);
    writeFileSync(join(REPO, "file.txt"), "changed\n");
    const originBefore = rev(ORIGIN, "master");
    const r = wip(["snapshot"]);
    expect(r.status).toBe(0);
    expect(rev(ORIGIN, "master")).toBe(originBefore);
  });

  for (const name of ["develop", "trunk"]) {
    it(`refuses on '${name}' even when origin/HEAD is unknown`, () => {
      must(REPO, ["checkout", "-q", "-b", name]);
      must(REPO, ["push", "-q", "-u", "origin", name]);
      git(REPO, ["remote", "set-head", "origin", "-d"]);
      writeFileSync(join(REPO, "file.txt"), "changed\n");
      const originBefore = rev(ORIGIN, name);
      const r = wip(["snapshot"]);
      expect(r.status).toBe(3);
      expect(rev(ORIGIN, name)).toBe(originBefore);
    });
  }
});

// ---------------------------------------------------------------------------
// git-unwip
// ---------------------------------------------------------------------------

describe("git-unwip remote-range verification", () => {
  let ORIGIN = "";
  let REPO = "";
  let OTHER = "";

  function unwip(): { status: number; output: string } {
    const r = runTool("git-unwip", [], { cwd: REPO });
    return { status: r.status, output: r.output };
  }

  beforeEach(() => {
    ORIGIN = join(TMP, "origin.git");
    REPO = join(TMP, "repo");
    OTHER = join(TMP, "other");
    must(TMP, ["init", "-q", "--bare", "-b", "main", ORIGIN]);
    must(TMP, ["init", "-q", "-b", "main", REPO]);
    must(REPO, ["remote", "add", "origin", ORIGIN]);
    commit(REPO, "initial");
    must(REPO, ["push", "-q", "-u", "origin", "main"]);
    must(REPO, ["checkout", "-q", "-b", "feature/x"]);
    commit(REPO, "fix: real work");
    must(REPO, ["push", "-q", "-u", "origin", "feature/x"]);
  });

  it("refuses when a non-WIP remote commit sits under the WIP remote tip, rewriting nothing", () => {
    must(TMP, ["clone", "-q", ORIGIN, OTHER]);
    must(OTHER, ["checkout", "-q", "feature/x"]);
    commit(OTHER, "feat: someone else's reviewed commit");
    commit(OTHER, "WIP: someone else's snapshot");
    must(OTHER, ["push", "-q", "origin", "feature/x"]);
    commit(REPO, "WIP: my snapshot");
    must(REPO, ["fetch", "-q", "origin"]);
    const originBefore = rev(ORIGIN, "feature/x");
    const localBefore = rev(REPO, "HEAD");
    const r = unwip();
    expect(r.status).not.toBe(0);
    expect(rev(ORIGIN, "feature/x")).toBe(originBefore);
    expect(rev(REPO, "HEAD")).toBe(localBefore);
  });

  it("leaves the local branch untouched when the force-push fails", () => {
    commit(REPO, "WIP: a");
    must(REPO, ["push", "-q", "origin", "feature/x"]);
    commit(REPO, "WIP: b");
    must(REPO, ["push", "-q", "origin", "feature/x"]);
    const hook = join(ORIGIN, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho rejected-by-fixture >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const originBefore = rev(ORIGIN, "feature/x");
    const localBefore = rev(REPO, "HEAD");
    const r = unwip();
    expect(r.status).not.toBe(0);
    expect(rev(ORIGIN, "feature/x")).toBe(originBefore);
    expect(rev(REPO, "HEAD")).toBe(localBefore);
  });

  for (const name of ["trunk", "release/2.0", "develop", "main"]) {
    it(`refuses on protected branch '${name}' and rewrites nothing`, () => {
      if (name === "main") must(REPO, ["checkout", "-q", "main"]);
      else must(REPO, ["checkout", "-q", "-b", name]);
      commit(REPO, "WIP: snapshot");
      must(REPO, ["push", "-q", "-u", "origin", name]);
      const originBefore = rev(ORIGIN, name);
      const localBefore = rev(REPO, "HEAD");
      const r = unwip();
      expect(r.status).toBe(1);
      expect(r.output).toContain("protected branch");
      expect(rev(ORIGIN, name)).toBe(originBefore);
      expect(rev(REPO, "HEAD")).toBe(localBefore);
    });
  }

  it("refuses on the remote's default branch even when it has an unusual name", () => {
    must(REPO, ["checkout", "-q", "-b", "stable"]);
    commit(REPO, "WIP: snapshot");
    must(REPO, ["push", "-q", "-u", "origin", "stable"]);
    must(ORIGIN, ["symbolic-ref", "HEAD", "refs/heads/stable"]);
    must(REPO, ["remote", "set-head", "origin", "stable"]);
    const localBefore = rev(REPO, "HEAD");
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.output).toContain("protected branch");
    expect(rev(REPO, "HEAD")).toBe(localBefore);
  });

  it("when every remote commit above the target is a WIP it rewinds the remote and then the local branch", () => {
    const real = rev(REPO, "HEAD");
    commit(REPO, "WIP: a");
    commit(REPO, "WIP: b");
    must(REPO, ["push", "-q", "origin", "feature/x"]);
    const r = unwip();
    expect(r.status).toBe(0);
    expect(rev(ORIGIN, "feature/x")).toBe(real);
    expect(rev(REPO, "HEAD")).toBe(real);
  });
});

// ---------------------------------------------------------------------------
// git-update
// ---------------------------------------------------------------------------

describe("git-update with an upstream on another remote", () => {
  it("keeps commits that are unique relative to the upstream instead of resetting them away", () => {
    const origin = join(TMP, "origin.git");
    const up = join(TMP, "up.git");
    const seed = join(TMP, "seed");
    const clone = join(TMP, "clone");
    const upWriter = join(TMP, "up-writer");
    const rewriter = join(TMP, "rewriter");
    must(TMP, ["init", "-q", "--bare", "-b", "master", origin]);
    must(TMP, ["init", "-q", "--bare", "-b", "master", up]);
    must(TMP, ["init", "-q", "-b", "master", seed]);
    commit(seed, "base");
    must(seed, ["push", "-q", origin, "master"]);
    must(seed, ["push", "-q", up, "master"]);
    must(TMP, ["clone", "-q", origin, clone]);
    must(clone, ["remote", "add", "up", up]);
    must(clone, ["fetch", "-q", "up"]);
    // The clone's unique work was once pushed to origin (so origin's reflog
    // records it as a past tip) ...
    commit(clone, "feat: unique local work");
    const unique = rev(clone, "HEAD");
    must(clone, ["config", "core.logAllRefUpdates", "always"]);
    must(clone, ["push", "-q", "origin", "master"]);
    // ... while the branch tracks a different remote, which has moved on.
    must(clone, ["branch", "-u", "up/master"]);
    must(TMP, ["clone", "-q", up, upWriter]);
    commit(upWriter, "feat: the other remote moved");
    must(upWriter, ["push", "-q", "origin", "master"]);
    // origin is then rewritten (a fork sync).
    must(TMP, ["clone", "-q", origin, rewriter]);
    must(rewriter, ["reset", "-q", "--hard", "HEAD~1"]);
    commit(rewriter, "rewritten origin history");
    must(rewriter, ["push", "-q", "-f", "origin", "master"]);
    // The clone already fetched both remotes (a plain `git fetch` only reads
    // the upstream's remote, so origin's rewrite is seen from earlier fetches).
    must(clone, ["fetch", "-q", "origin"]);
    must(clone, ["fetch", "-q", "up"]);

    const r = runTool("git-update", [], { cwd: clone });
    expect(r.status).not.toBe(0);
    expect(must(clone, ["merge-base", "--is-ancestor", unique, "HEAD"])).toBe("");
    expect(rev(clone, "HEAD")).toBe(unique);
  });
});
