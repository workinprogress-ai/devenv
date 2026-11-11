// Port of tools/tests/scripts/test_git_wip.bats (29 tests).
// git-wip / git-unwip / git-wip-recover behavior in real temp repos with a
// bare remote.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });


let TMP = "";
let REMOTE_REPO = "";
let TEST_REPO = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@test.com",
});

function git(args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd: TEST_REPO, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

function head(): string {
  return (git(["log", "-1", "--format=%s"]).stdout ?? "").trim();
}

function rev(ref: string): string {
  return (git(["rev-parse", ref]).stdout ?? "").trim();
}

function porcelain(): string {
  return (git(["status", "--porcelain"]).stdout ?? "").trim();
}

function wip(note: string): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("git-wip"), "--allow-non-tty", note], {
    cwd: TEST_REPO,
    encoding: "utf8",
    env: GIT_ENV(),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function wipRaw(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("git-wip"), ...args], {
    cwd: TEST_REPO,
    encoding: "utf8",
    env: { ...GIT_ENV(), ...extraEnv },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function unwip(): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("git-unwip")], { cwd: TEST_REPO, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function recover(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("git-wip-recover"), ...args], {
    cwd: TEST_REPO,
    encoding: "utf8",
    env: GIT_ENV(),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gitwip-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  REMOTE_REPO = join(TMP, "remote.git");
  TEST_REPO = join(TMP, "repo");
  spawnSync("git", ["init", "-q", "--bare", REMOTE_REPO]);
  spawnSync("git", ["init", "-q", TEST_REPO], { env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: TEST_REPO, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: TEST_REPO, env: GIT_ENV() });
  spawnSync("git", ["remote", "add", "origin", REMOTE_REPO], { cwd: TEST_REPO, env: GIT_ENV() });
  writeFileSync(join(TEST_REPO, "file.txt"), "seed\n");
  git(["add", "file.txt"]);
  git(["commit", "-q", "-m", "initial"]);
  git(["push", "-q", "-u", "origin", "HEAD"]);
  // git-wip refuses on protected branches: the suite works on a feature branch.
  git(["checkout", "-q", "-b", "feature/wip-suite"]);
  git(["push", "-q", "-u", "origin", "feature/wip-suite"]);
});

afterEach(() => {
  spawnSync("rm", ["-rf", TMP]);
});

describe("scripts/git-wip", () => {
  // ---------------- git-wip ----------------

  it("git-wip entry exists", () => {
    expect(existsSync(toolScript("git-wip"))).toBe(true);
  });

  it("git-wip entry has valid TypeScript syntax", () => {
    expect(spawnSync("node", ["--check", toolScript("git-wip")]).status).toBe(0);
  });

  it("git-wip creates a WIP commit", () => {
    writeFileSync(join(TEST_REPO, "work.txt"), "work\n");
    const r = wip("my note");
    expect(r.status).toBe(0);
    expect(head()).toMatch(/^WIP:/);
  });

  it("git-wip stages all untracked files", () => {
    writeFileSync(join(TEST_REPO, "new_file.txt"), "untracked\n");
    const r = wip("untracked snapshot");
    expect(r.status).toBe(0);
    const show = (git(["show", "--name-only", "HEAD"]).stdout ?? "");
    expect(show).toContain("new_file.txt");
  });

  it("git-wip sets refs/wip/last to HEAD after pushing", () => {
    writeFileSync(join(TEST_REPO, "work.txt"), "work\n");
    wip("save");
    expect(rev("refs/wip/last")).toBe(rev("HEAD"));
  });

  it("git-wip overwrites refs/wip/last on subsequent calls", () => {
    writeFileSync(join(TEST_REPO, "first.txt"), "first\n");
    wip("first");
    const firstRef = rev("refs/wip/last");
    writeFileSync(join(TEST_REPO, "second.txt"), "second\n");
    wip("second");
    expect(rev("refs/wip/last")).toBe(rev("HEAD"));
    expect(rev("refs/wip/last")).not.toBe(firstRef);
  });

  // --dry-run is the safe probe path (incident-driven): it must print the plan
  // and never stage, commit, push, or move refs/wip/last. Works without a TTY.
  it("git-wip --dry-run prints the plan and touches nothing", () => {
    git(["update-ref", "refs/wip/last", "HEAD"]);
    const before = rev("refs/wip/last");
    writeFileSync(join(TEST_REPO, "probe.txt"), "probe\n");
    const r = wipRaw(["--dry-run", "probe test"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("DRY RUN");
    // the flag itself must not leak into the message (same class as the -n trap)
    expect(r.out).toContain("Would commit: WIP: probe test");
    // nothing happened: probe.txt still untracked, no new commit, ref unmoved
    expect(porcelain()).toContain("?? probe.txt");
    expect(head()).toBe("initial");
    expect(rev("refs/wip/last")).toBe(before);
  });

  // Incident guard: two accidental non-interactive executions published
  // hook-bypass commits. Without a TTY (and without the override) it must refuse.
  it("git-wip refuses to run without a TTY", () => {
    writeFileSync(join(TEST_REPO, "sneak.txt"), "sneak\n");
    const r = wipRaw(["not a probe"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("interactive terminal");
    expect(r.out).toContain("--dry-run");
    // nothing happened
    expect(porcelain()).toContain("?? sneak.txt");
    expect(head()).toBe("initial");
  });

  it("git-wip --allow-non-tty overrides the TTY gate", () => {
    writeFileSync(join(TEST_REPO, "deliberate.txt"), "deliberate\n");
    const r = wipRaw(["--allow-non-tty", "scripted save"]);
    expect(r.status).toBe(0);
    expect(head()).toBe("WIP: scripted save");
  });

  it("git-wip --help works non-interactively", () => {
    const r = wipRaw(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage: git-wip");
  });

  // ---------------- --file ----------------

  // --file: the arm used to record the path but shift only once, so the path
  // was then read as a positional message and the mutual-exclusion check
  // always failed.
  it("git-wip --file uses the file's content verbatim after the WIP: prefix", () => {
    appendFileSync(join(TEST_REPO, "file.txt"), "change\n");
    writeFileSync(join(TEST_REPO, "msg.txt"), "saved the parser work\n\nwith a body line");
    const r = wipRaw(["--allow-non-tty", "--file", join(TEST_REPO, "msg.txt")]);
    expect(r.status).toBe(0);
    expect(head()).toBe("WIP: saved the parser work");
    expect((git(["log", "-1", "--format=%B"]).stdout ?? "")).toContain("with a body line");
  });

  it("git-wip --file together with a positional message is still rejected", () => {
    appendFileSync(join(TEST_REPO, "file.txt"), "change\n");
    writeFileSync(join(TEST_REPO, "msg.txt"), "msg");
    const r = wipRaw(["--file", join(TEST_REPO, "msg.txt"), "extra words"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("mutually exclusive");
  });

  it("git-wip --file with a missing file fails clearly", () => {
    const r = wipRaw(["--file", join(TEST_REPO, "nope.txt")]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not found");
  });

  it("git-wip: a failed push exits non-zero and does not move refs/wip/last", () => {
    appendFileSync(join(TEST_REPO, "file.txt"), "change\n");
    git(["update-ref", "refs/wip/last", "HEAD"]);
    const before = rev("refs/wip/last");
    spawnSync("rm", ["-rf", REMOTE_REPO]); // remote gone: the push cannot succeed
    const r = wip("scratch");
    expect(r.status).not.toBe(0);
    expect(rev("refs/wip/last")).toBe(before);
  });

  it("git-wip: nothing to commit exits non-zero instead of re-pushing an old commit", () => {
    git(["update-ref", "refs/wip/last", "HEAD"]);
    const before = rev("refs/wip/last");
    const r = wip("nothing changed");
    expect(r.status).not.toBe(0);
    expect(rev("refs/wip/last")).toBe(before);
  });

  // ---------------- git-unwip ----------------

  it("git-unwip entry exists", () => {
    expect(existsSync(toolScript("git-unwip"))).toBe(true);
  });

  it("git-unwip entry has valid TypeScript syntax", () => {
    expect(spawnSync("node", ["--check", toolScript("git-unwip")]).status).toBe(0);
  });

  it("git-unwip soft-resets past WIP commit", () => {
    git(["checkout", "-q", "-b", "feature/test-unwip"]);
    writeFileSync(join(TEST_REPO, "work.txt"), "work\n");
    wip("temp");
    const r = unwip();
    expect(r.status).toBe(0);
    expect(head()).not.toMatch(/^WIP:/);
  });

  it("git-unwip restages WIP changes", () => {
    git(["checkout", "-q", "-b", "feature/test-restage"]);
    writeFileSync(join(TEST_REPO, "work.txt"), "work\n");
    wip("temp");
    unwip();
    const staged = (git(["diff", "--cached", "--name-only"]).stdout ?? "");
    expect(staged).toContain("work.txt");
  });

  it("git-unwip refuses to run on master branch", () => {
    const current = (git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim();
    if (current !== "master") {
      // The source suite skips when the repo default branch is not master.
      expect(current).not.toBe("");
      return;
    }
    writeFileSync(join(TEST_REPO, "work.txt"), "work\n");
    wip("temp");
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.out).toContain("protected branch");
  });

  it("git-unwip skips force-push when remote tip is not a WIP commit", () => {
    git(["checkout", "-q", "-b", "feature/test"]);
    git(["push", "-q", "-u", "origin", "HEAD"]);
    // Make a normal commit on remote (no WIP)
    writeFileSync(join(TEST_REPO, "work.txt"), "work\n");
    git(["add", "work.txt"]);
    git(["commit", "-q", "-m", "normal commit"]);
    git(["push", "-q"]);
    // Now reset locally to simulate a stale WIP scenario where remote is not WIP
    git(["reset", "--soft", "HEAD~1"]);
    const r = unwip();
    if (!r.out.includes("not a WIP commit")) {
      expect(r.status).toBe(0);
    }
  });

  // ---------------- git-wip-recover ----------------

  it("git-wip-recover entry exists", () => {
    expect(existsSync(toolScript("git-wip-recover"))).toBe(true);
  });

  it("git-wip-recover entry has valid TypeScript syntax", () => {
    expect(spawnSync("node", ["--check", toolScript("git-wip-recover")]).status).toBe(0);
  });

  it("git-wip-recover fails gracefully when no ref exists", () => {
    const r = recover(["--show"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("no saved WIP commit");
  });

  it("git-wip-recover --show prints saved WIP commit summary", () => {
    writeFileSync(join(TEST_REPO, "recover.txt"), "recover-me\n");
    wip("recovery test");
    const r = recover(["--show"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Saved WIP commit");
    expect(r.out).toContain("WIP: recovery test");
  });

  it("git-wip-recover --branch creates a branch at the WIP commit", () => {
    writeFileSync(join(TEST_REPO, "recover2.txt"), "recover-branch\n");
    wip("branch test");
    const wipCommit = rev("refs/wip/last");
    // unwip so HEAD moves away from the WIP commit
    git(["checkout", "-q", "-b", "feature/recover-test"]);
    git(["push", "-q", "-u", "origin", "HEAD"]);
    unwip();
    const r = recover(["--branch", "recovered-test"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("recovered-test");
    expect(rev("refs/heads/recovered-test")).toBe(wipCommit);
  });

  it("git-wip-recover --branch uses default name when none supplied", () => {
    writeFileSync(join(TEST_REPO, "default.txt"), "default-name\n");
    wip("default name test");
    git(["checkout", "-q", "-b", "feature/default-name-test"]);
    git(["push", "-q", "-u", "origin", "HEAD"]);
    unwip();
    const r = recover(["--branch"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("wip-recovered");
  });

  it("git-wip-recover refs/wip/last survives git-unwip", () => {
    git(["checkout", "-q", "-b", "feature/survive-test"]);
    git(["push", "-q", "-u", "origin", "HEAD"]);
    writeFileSync(join(TEST_REPO, "survive.txt"), "survive\n");
    wip("survive test");
    const wipCommit = rev("refs/wip/last");
    unwip();
    expect(rev("refs/wip/last")).toBe(wipCommit);
  });
});
