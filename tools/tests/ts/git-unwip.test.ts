// Port of tools/tests/scripts/test_git_unwip.bats (6 tests).
// git-unwip target selection: the reset target is the last commit whose
// subject does NOT start with "WIP:", that subject merely containing "wip:"
// is never skipped, a WIP-only history refuses to unwip, and the
// protected-branch guard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });


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

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gitunwip-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  REMOTE_REPO = join(TMP, "remote");
  TEST_REPO = join(TMP, "repo");
  spawnSync("git", ["init", "-q", "--bare", REMOTE_REPO]);
  spawnSync("git", ["init", "-q", TEST_REPO], { env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: TEST_REPO, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: TEST_REPO, env: GIT_ENV() });
  spawnSync("git", ["remote", "add", "origin", REMOTE_REPO], { cwd: TEST_REPO, env: GIT_ENV() });
  spawnSync("touch", [join(TEST_REPO, "file.txt")]);
  git(["add", "file.txt"]);
  git(["commit", "-q", "-m", "initial"]);
  git(["push", "-q", "-u", "origin", "HEAD"]);
  git(["checkout", "-q", "-b", "feature/x"]);
});

afterEach(() => {
  spawnSync("rm", ["-rf", TMP]);
});

function unwip(env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("git-unwip")], { cwd: TEST_REPO, encoding: "utf8", env: { ...GIT_ENV(), ...env } });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scripts/git-unwip", () => {
  it("unwip: resets to the last non-WIP commit", () => {
    git(["commit", "-q", "--allow-empty", "-m", "fix: real work"]);
    git(["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    const r = unwip();
    expect(r.status).toBe(0);
    expect((git(["log", "-1", "--format=%s"]).stdout ?? "").trim()).toBe("fix: real work");
  });

  it("unwip: subject containing 'wip:' mid-message is NOT skipped", () => {
    git(["commit", "-q", "--allow-empty", "-m", "fix: handle wip: items gracefully"]);
    git(["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    const r = unwip();
    expect(r.status).toBe(0);
    expect((git(["log", "-1", "--format=%s"]).stdout ?? "").trim()).toBe("fix: handle wip: items gracefully");
  });

  it("unwip: consecutive WIP commits reset past all of them", () => {
    git(["commit", "-q", "--allow-empty", "-m", "feat: base work"]);
    git(["commit", "-q", "--allow-empty", "-m", "WIP: a"]);
    git(["commit", "-q", "--allow-empty", "-m", "WIP: b"]);
    const r = unwip();
    expect(r.status).toBe(0);
    expect((git(["log", "-1", "--format=%s"]).stdout ?? "").trim()).toBe("feat: base work");
  });

  it("unwip: refuses when every commit is a WIP commit", () => {
    // feature branch has only WIP commits beyond the initial (pushed) commit;
    // soft-reset past all WIPs would land on initial — that IS valid, so build
    // a repo where even root is WIP-titled: re-init without non-WIP commits.
    git(["checkout", "-q", "--orphan", "wiponly"]);
    git(["commit", "-q", "--allow-empty", "-m", "WIP: only commit"]);
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.out).toContain("no non-WIP commit");
  });

  it("unwip: refuses on protected branch", () => {
    git(["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    if (git(["checkout", "-q", "master"]).status !== 0) {
      git(["checkout", "-q", "main"]);
    }
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.out).toContain("protected branch");
  });

  it("unwip: a failed local reset after a successful force-push says the remote was already rewound", () => {
    git(["commit", "-q", "--allow-empty", "-m", "fix: real work"]);
    git(["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    git(["push", "-q", "-u", "origin", "feature/x"]);
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const bin = join(TMP, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *"reset --soft"*) echo boom >&2; exit 1;; esac\nexec ${real} "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const r = unwip({ PATH: `${bin}:${process.env.PATH ?? ""}` });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("already rewound");
    expect((spawnSync("git", ["-C", REMOTE_REPO, "log", "-1", "--format=%s", "feature/x"], { encoding: "utf8" }).stdout ?? "").trim()).toBe("fix: real work");
  });

  it("unwip: skips force-push when remote tip is not a WIP commit", () => {
    git(["commit", "-q", "--allow-empty", "-m", "fix: real work"]);
    git(["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    git(["push", "-q", "origin", "feature/x"]);
    // Overwrite remote tip with a non-WIP commit so guard 3 fires
    git(["commit", "-q", "--allow-empty", "-m", "not wip on remote"]);
    git(["push", "-q", "--force", "origin", "feature/x"]);
    git(["reset", "-q", "--hard", "HEAD~1"]);
    const r = unwip();
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipping force-push");
  });
});
