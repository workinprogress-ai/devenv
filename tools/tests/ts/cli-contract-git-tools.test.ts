// CLI contract for the git passthrough tools and git-wip: `--help`/`--version`
// exit 0 on stdout, unknown flags are misuse (exit 2) before any mutation, and
// the `--` separator hands every later token to the message / the child
// command. Everything runs in a throwaway repo with a bare local remote.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmrf, tmpDir, toolScript } from "./harness/index.ts";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let TMP = "";
let REPO = "";
let REMOTE = "";

const GIT_ENV = (): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@test.com",
});

function git(args: string[]): string {
  return spawnSync("git", args, { cwd: REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "";
}

function run(tool: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [toolScript(tool), ...args], { cwd: REPO, encoding: "utf8", env: GIT_ENV(), input: "" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeEach(() => {
  TMP = tmpDir("cli-contract-git");
  mkdirSync(join(TMP, "home"), { recursive: true });
  REMOTE = join(TMP, "remote.git");
  REPO = join(TMP, "repo");
  spawnSync("git", ["init", "-q", "--bare", REMOTE]);
  spawnSync("git", ["init", "-q", REPO], { env: GIT_ENV() });
  git(["remote", "add", "origin", REMOTE]);
  writeFileSync(join(REPO, "file.txt"), "seed\n");
  git(["add", "file.txt"]);
  git(["commit", "-q", "-m", "initial"]);
  git(["push", "-q", "-u", "origin", "HEAD"]);
  // git-wip refuses on protected branches: the contract runs on a feature branch.
  git(["checkout", "-q", "-b", "feature/contract"]);
  git(["push", "-q", "-u", "origin", "feature/contract"]);
});

afterEach(() => rmrf(TMP));

describe.each(["git-graph", "git-graph-all", "git-repo"])("%s house flags", (tool) => {
  it("--help exits 0 with usage on stdout", () => {
    const r = run(tool, ["--help"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain(`Usage: ${tool}`);
  });

  it("-h behaves like --help", () => {
    const r = run(tool, ["-h"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain(`Usage: ${tool}`);
  });

  it("--help says only the leading house flags are the tool's own and everything else is forwarded", () => {
    const r = run(tool, ["--help"]);
    expect(r.stdout).toMatch(/Only the leading -h\/--help, -v\/--version and -V\/--verbose/);
    expect(r.stdout).toContain("-n");
    expect(r.stdout).toContain("--devenv");
    expect(r.stdout).toMatch(/forwarded/);
  });

  it("--version exits 0 and prints a version on stdout", () => {
    const r = run(tool, ["--version"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe.each(["git-graph", "git-graph-all"])("%s passthrough", (tool) => {
  it("still forwards git log arguments", () => {
    const r = run(tool, ["-1"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("initial");
  });
});

describe("git-wip argument contract", () => {
  it("accepts the advertised --verbose flag", () => {
    const r = run("git-wip", ["--verbose", "--dry-run", "probe"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("Would commit: WIP: probe");
  });

  it("rejects an unknown long flag with exit 2 and a --help hint, before any mutation", () => {
    writeFileSync(join(REPO, "new.txt"), "x\n");
    const r = run("git-wip", ["--allow-non-tty", "--bogus", "words"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stdout + r.stderr).toContain("--help");
    expect(git(["status", "--porcelain"])).toContain("?? new.txt");
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("initial");
  });

  it("rejects an unknown single-dash flag with exit 2 before any mutation", () => {
    writeFileSync(join(REPO, "new.txt"), "x\n");
    const r = run("git-wip", ["--allow-non-tty", "-x", "oops"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("initial");
  });

  it("--file without a path is misuse (exit 2)", () => {
    const r = run("git-wip", ["--file"]);
    expect(r.status).toBe(EXIT_MISUSE);
  });

  it("--file naming a missing file is misuse (exit 2) before any mutation", () => {
    writeFileSync(join(REPO, "new.txt"), "x\n");
    const r = run("git-wip", ["--allow-non-tty", "--file", join(TMP, "nope.txt")]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("initial");
  });

  it("after -- every token is a message word, including flag-looking ones", () => {
    const r = run("git-wip", ["--dry-run", "--", "--bogus", "-x", "words"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("Would commit: WIP: --bogus -x words");
  });

  it("-n after -- is part of the message, not a dry run", () => {
    writeFileSync(join(REPO, "new.txt"), "x\n");
    const r = run("git-wip", ["--allow-non-tty", "--", "fix", "-n", "handling"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("WIP: fix -n handling");
  });

  it("-n before -- is still the dry-run short flag", () => {
    writeFileSync(join(REPO, "new.txt"), "x\n");
    const r = run("git-wip", ["-n", "probe"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("DRY RUN");
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("initial");
  });
});
