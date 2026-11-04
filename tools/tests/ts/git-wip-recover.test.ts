// Port of tools/tests/scripts/test_git_wip_recover.bats (7 tests).
// git-wip-recover behavior with refs/wip/last pre-seeded as git-wip would.
// Locks: --show output, --branch creation at the saved ref, unknown-option
// refusal, missing-ref refusal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let REMOTE_REPO = "";
let TEST_REPO = "";
let WIP_COMMIT = "";

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

function rev(ref: string): string {
  return (git(["rev-parse", ref]).stdout ?? "").trim();
}

function recover(args: string[]): { status: number; out: string } {
  const r = spawnSync("bash", [join(TOOLS, "git-wip-recover"), ...args], {
    cwd: TEST_REPO,
    encoding: "utf8",
    env: GIT_ENV(),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gwrec-${Date.now()}-${Math.random().toString(36).slice(2)}`));
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
  // Simulate what git-wip saves: a WIP commit plus its ref.
  git(["commit", "-q", "--allow-empty", "-m", "WIP: checkpoint"]);
  WIP_COMMIT = rev("HEAD");
  git(["update-ref", "refs/wip/last", WIP_COMMIT]);
});

afterEach(() => {
  spawnSync("rm", ["-rf", TMP]);
});

describe("scripts/git-wip-recover", () => {
  it("recover: --show prints the saved WIP commit summary", () => {
    const r = recover(["--show"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`Saved WIP commit: ${WIP_COMMIT}`);
    expect(r.out).toContain("WIP: checkpoint");
  });

  it("recover: --branch creates a branch at the saved ref", () => {
    const r = recover(["--branch", "rescue-1"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("checked out 'rescue-1'");
    expect(rev("refs/heads/rescue-1")).toBe(WIP_COMMIT);
    // HEAD is on the new branch
    expect((git(["branch", "--show-current"]).stdout ?? "").trim()).toBe("rescue-1");
  });

  it("recover: --branch defaults to wip-recovered", () => {
    const r = recover(["--branch"]);
    expect(r.status).toBe(0);
    expect(rev("refs/heads/wip-recovered")).toBe(WIP_COMMIT);
  });

  it("recover: unknown option is refused", () => {
    const r = recover(["--bogus"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("unknown option");
  });

  it("recover: missing ref is refused", () => {
    git(["update-ref", "-d", "refs/wip/last"]);
    const r = recover(["--show"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("no saved WIP commit");
  });

  it("recover: --help exits cleanly", () => {
    const r = recover(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage:");
  });
});
