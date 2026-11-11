// Safety regressions for repo-scratchpad: promote uses the validated full sha,
// destructive operations require the ACTIVE scratch branch, partial failures
// roll back or keep state instead of lying, --carry keeps untracked and binary
// content under unique names, and a second promote never mixes with staged
// salvage. Real git in throwaway fixture repos; failures are injected with a
// PATH shim in front of the real git.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmrf, runTool, tmpDir } from "./harness/index.ts";

let root = "";
let repo = "";

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function gitOk(...args: string[]): boolean {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).status === 0;
}

/** A `git` shim that fails any invocation whose argument string contains one of
 * the given fragments and otherwise delegates to the real git. */
function failingGit(fragments: string[]): string {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const bin = join(root, "shim-bin");
  mkdirSync(bin, { recursive: true });
  const cases = fragments.map((f) => `  *"${f}"*) exit 1 ;;`).join("\n");
  const p = join(bin, "git");
  writeFileSync(p, `#!/bin/sh\ncase "$*" in\n${cases}\nesac\nexec ${real} "$@"\n`);
  chmodSync(p, 0o755);
  return `${bin}:${process.env["PATH"] ?? ""}`;
}

function sp(args: string[], env: Record<string, string | undefined> = {}) {
  return runTool("repo-scratchpad", args, { cwd: repo, env });
}

beforeEach(() => {
  root = tmpDir("commit-safety-scratchpad");
  repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  spawnSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  writeFileSync(join(repo, "x.txt"), "base\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "base");
});
afterEach(() => rmrf(root));

function scratchCommit(file: string, content: string, title: string): string {
  writeFileSync(join(repo, file), content);
  expect(sp(["commit", title]).status).toBe(0);
  return git("rev-parse", "HEAD");
}

describe("promote", () => {
  it("resolves the sha once: `promote HEAD` promotes the scratch commit, not the base", () => {
    expect(sp(["enter"]).status).toBe(0);
    scratchCommit("fix.txt", "fix\n", "the fix");
    const r = sp(["promote", "HEAD"]);
    expect(r.status).toBe(0);
    expect(git("show", ":fix.txt")).toBe("fix");
    expect(git("rev-parse", "HEAD")).toBe(git("rev-parse", "refs/scratchpad/base"));
  });

  it("refuses a second promote while staged salvage exists, leaving the index untouched", () => {
    expect(sp(["enter"]).status).toBe(0);
    const a = scratchCommit("a.txt", "a\n", "first");
    const b = scratchCommit("b.txt", "b\n", "second");
    expect(sp(["promote", a]).status).toBe(0);
    const staged = git("diff", "--cached", "--name-only");
    const r = sp(["promote", b]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("staged");
    expect(git("diff", "--cached", "--name-only")).toBe(staged);
    expect(existsSync(join(repo, "b.txt"))).toBe(false);
  });

  it("a conflicting promote aborts back onto the scratch branch with a clean tree", () => {
    expect(sp(["enter"]).status).toBe(0);
    scratchCommit("x.txt", "one\n", "first edit");
    const second = scratchCommit("x.txt", "two\n", "second edit");
    const tip = git("rev-parse", "HEAD");
    const r = sp(["promote", second]);
    expect(r.status).toBe(3);
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("scratchpad/exp");
    expect(git("rev-parse", "HEAD")).toBe(tip);
    expect(git("status", "--porcelain")).toBe("");
    expect(gitOk("show-ref", "--verify", "--quiet", "refs/scratchpad/base")).toBe(true);
  });
});

describe("exit", () => {
  it("never deletes the branch the scratchpad was entered from", () => {
    const base = git("rev-parse", "HEAD");
    expect(sp(["enter"]).status).toBe(0);
    scratchCommit("w.txt", "w\n", "work");
    expect(sp(["exit"]).status).toBe(0);
    expect(git("rev-parse", "refs/heads/main")).toBe(base);
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("main");
  });
});

describe("destructive operations need the ACTIVE scratch branch", () => {
  it("reset refuses on a stale scratchpad/* branch and leaves it untouched", () => {
    expect(sp(["enter", "live"]).status).toBe(0);
    git("checkout", "-q", "main");
    git("checkout", "-q", "-b", "scratchpad/stale");
    writeFileSync(join(repo, "keep.txt"), "keep\n");
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "stale work");
    const tip = git("rev-parse", "HEAD");
    const r = sp(["reset"]);
    expect(r.status).not.toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(tip);
    expect(existsSync(join(repo, "keep.txt"))).toBe(true);
  });

  it("commit refuses on a stale scratchpad/* branch", () => {
    expect(sp(["enter", "live"]).status).toBe(0);
    git("checkout", "-q", "main");
    git("checkout", "-q", "-b", "scratchpad/stale");
    writeFileSync(join(repo, "n.txt"), "n\n");
    const before = git("rev-parse", "HEAD");
    expect(sp(["commit", "nope"]).status).not.toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(before);
  });
});

describe("partial failure", () => {
  const noState = (): void => {
    for (const ref of ["refs/scratchpad/base", "refs/scratchpad/state", "refs/scratchpad/origin-branch"]) {
      expect(gitOk("show-ref", "--verify", "--quiet", ref), ref).toBe(false);
    }
  };

  it("enter: a failed branch checkout activates nothing and leaves no base ref", () => {
    const r = sp(["enter"], { PATH: failingGit(["checkout -q -b"]) });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("Scratchpad active");
    noState();
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("enter: a failed state-ref write rolls the activation back (back on main, branch gone, later enter works)", () => {
    const r = sp(["enter"], { PATH: failingGit(["update-ref refs/scratchpad/state"]) });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("Scratchpad active");
    noState();
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(gitOk("show-ref", "--verify", "--quiet", "refs/heads/scratchpad/exp")).toBe(false);
    expect(sp(["enter"]).status).toBe(0);
  });

  it("exit: a failed branch delete keeps the scratchpad state and reports the failure", () => {
    expect(sp(["enter"]).status).toBe(0);
    scratchCommit("w.txt", "w\n", "work");
    const r = sp(["exit"], { PATH: failingGit(["branch -q -D"]) });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("Scratchpad exited");
    expect(gitOk("show-ref", "--verify", "--quiet", "refs/scratchpad/base")).toBe(true);
    expect(gitOk("show-ref", "--verify", "--quiet", "refs/scratchpad/state")).toBe(true);
  });

  it("reset: a failed reset --hard is reported, not announced as success", () => {
    expect(sp(["enter"]).status).toBe(0);
    scratchCommit("w.txt", "w\n", "work");
    const r = sp(["reset"], { PATH: failingGit(["reset --hard"]) });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("Reset to base");
  });

  it("resume: a failed checkout is reported, not announced as success", () => {
    expect(sp(["enter"]).status).toBe(0);
    git("checkout", "-q", "main");
    const r = sp(["resume"], { PATH: failingGit(["checkout -q scratchpad/exp"]) });
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("Resumed");
  });
});

describe("--carry snapshot", () => {
  const carryDir = (): string => join(repo, ".local-artifacts", "tmp", "scratchpad");

  it("captures untracked file contents and binary changes before reset can destroy them", () => {
    writeFileSync(join(repo, "bin.dat"), Buffer.from([0, 1, 2, 3, 255]));
    git("add", "bin.dat");
    git("commit", "-q", "--no-verify", "-m", "add binary");
    writeFileSync(join(repo, "bin.dat"), Buffer.from([0, 9, 9, 9, 254, 0]));
    mkdirSync(join(repo, "sub"), { recursive: true });
    writeFileSync(join(repo, "sub", "new.txt"), "untracked content\n");
    expect(sp(["enter", "--carry"]).status).toBe(0);
    expect(sp(["reset"]).status).toBe(0);
    const entries = readdirSync(carryDir());
    const patch = entries.find((e) => e.endsWith(".patch"));
    expect(patch).toBeDefined();
    expect(readFileSync(join(carryDir(), patch ?? ""), "utf8")).toContain("GIT binary patch");
    const untrackedDir = entries.find((e) => e.endsWith("-untracked"));
    expect(untrackedDir).toBeDefined();
    expect(readFileSync(join(carryDir(), untrackedDir ?? "", "sub", "new.txt"), "utf8")).toBe("untracked content\n");
  });

  it("never overwrites an earlier snapshot of the same slug", () => {
    for (const content of ["first dirt\n", "second dirt\n"]) {
      writeFileSync(join(repo, "x.txt"), content);
      const entered = sp(["enter", "--carry"]);
      expect(entered.status, entered.output).toBe(0);
      expect(sp(["reset"]).status).toBe(0);
      const left = sp(["exit"]);
      expect(left.status, left.output).toBe(0);
    }
    const patches = readdirSync(carryDir()).filter((e) => e.endsWith(".patch"));
    expect(patches.length).toBe(2);
    const bodies = patches.map((p) => readFileSync(join(carryDir(), p), "utf8")).join("\n");
    expect(bodies).toContain("first dirt");
    expect(bodies).toContain("second dirt");
  });
});
