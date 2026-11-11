// Port of tools/tests/scripts/test_git_helper_args.bats (5 tests).
// Argument handling of the small git helpers: --help prints usage and changes
// nothing, an unknown argument is refused, and git-repo hands its arguments to
// the repo-get source that sits next to it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";
let REPO = "";
let HEAD_BEFORE = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.test",
});

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `githelper-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  REPO = join(TMP, "repo");
  const g = (args: string[]) =>
    spawnSync("git", args, { cwd: REPO, encoding: "utf8", env: GIT_ENV() });
  mkdirSync(REPO, { recursive: true });
  g(["init", "-q", "-b", "feature"]);
  g(["commit", "-q", "--allow-empty", "-m", "base"]);
  g(["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
  HEAD_BEFORE = (g(["rev-parse", "HEAD"]).stdout ?? "").trim();
});

afterEach(() => {
  spawnSync("rm", ["-rf", TMP]);
});

function git(args: string[]): string {
  return (spawnSync("git", args, { cwd: REPO, encoding: "utf8", env: GIT_ENV() }).stdout ?? "").trim();
}

describe("scripts/git-helper-args", () => {
  it("git-unwip --help prints usage and leaves history alone", () => {
    const r = spawnSync("node", [toolScript("git-unwip"), "--help"], { cwd: REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage");
    expect(git(["rev-parse", "HEAD"])).toBe(HEAD_BEFORE);
  });

  it("git-unwip refuses an unknown argument and leaves history alone", () => {
    const r = spawnSync("node", [toolScript("git-unwip"), "--bogus"], { cwd: REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage");
    expect(git(["rev-parse", "HEAD"])).toBe(HEAD_BEFORE);
  });

  it("git-update --help prints usage without touching the repository", () => {
    const r = spawnSync("node", [toolScript("git-update"), "--help"], { cwd: REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage");
  });

  it("git-update refuses an unknown argument", () => {
    const r = spawnSync("node", [toolScript("git-update"), "--bogus"], { cwd: REPO, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage");
  });

  it("git-repo hands its arguments to the same-layer repo-get source, not to whatever is on PATH", () => {
    // The port dispatches to its same-layer sibling (spawn node
    // <own-tools>/ts/repo-get.ts) — never a PATH lookup. Fake tools root
    // carries the lib tree so the copied source runs; its ts/repo-get.ts wins
    // over any PATH repo-get.
    const fake = join(TMP, "fake");
    mkdirSync(join(fake, "ts"), { recursive: true });
    mkdirSync(join(fake, "path"), { recursive: true });
    cpSync(join(TOOLS, "lib"), join(fake, "lib"), { recursive: true });
    cpSync(join(TOOLS, "ts", "git-repo.ts"), join(fake, "ts", "git-repo.ts"));
    writeFileSync(
      join(fake, "ts", "repo-get.ts"),
      'const { spawnSync } = await import("node:child_process");\nconst r = spawnSync("echo", ["next-to-it", ...process.argv.slice(2)], { stdio: "inherit" });\nprocess.exit(r.status ?? 1);\n',
    );
    writeFileSync(join(fake, "path", "repo-get"), '#!/bin/bash\necho "from-path: $*"\n');
    spawnSync("chmod", ["+x", join(fake, "path", "repo-get")]);
    const r = spawnSync("node", [join(fake, "ts", "git-repo.ts"), "some-repo"], {
      encoding: "utf8",
      env: { ...GIT_ENV(), PATH: `${join(fake, "path")}:${process.env.PATH ?? ""}` },
    });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("next-to-it some-repo");
  });
});
