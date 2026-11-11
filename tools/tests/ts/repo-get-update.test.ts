// Port of tools/tests/scripts/test_repo_get_update.bats (7 tests).
// repo-get's update of an existing clone must never destroy local work: a
// dirty working tree or unpushed commits make it skip the repo with a
// message, and a clean tree only ever moves forward (fast-forward).
// repo-update-all must report a failed update as a failed run.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = toolScript("repo-get");

let TMP = "";
let ORIGIN = "";
let SEED = "";
let CLONE = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.test",
});

function gitIn(repo: string, args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

function revIn(repo: string, ref: string): string {
  return (gitIn(repo, ["rev-parse", ref]).stdout ?? "").trim();
}

// commit_in <dir> <name>
function commitIn(dir: string, name: string): void {
  writeFileSync(join(dir, `${name}.txt`), `${name}\n`);
  spawnSync("git", ["add", `${name}.txt`], { cwd: dir, env: GIT_ENV() });
  spawnSync("git", ["commit", "-q", "-m", name], { cwd: dir, env: GIT_ENV() });
}

// a new commit on origin's main
function advanceOrigin(): void {
  commitIn(SEED, "upstream");
  gitIn(SEED, ["push", "-q", "origin", "main"]);
}

// run the real repo-get against $CLONE — no-arg context mode from inside the
// clone (the DEVENV_ROOT sandbox places repos/clone at $CLONE).
function updateClone(): { status: number; out: string } {
  const root = join(TMP, "getroot");
  mkdirSync(join(root, "repos"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "devenv.config"), "[organization]\norg=test-org\n");
  // gh auth-status stub: the update path's provider gates run before any
  // git work; only `auth status` is answered, everything else fails loud.
  writeFileSync(join(root, "bin", "gh"), '#!/bin/sh\n[ "$1" = auth ] && exit 0\nexit 1\n');
  spawnSync("chmod", ["+x", join(root, "bin", "gh")]);
  rmSync(join(root, "repos", "clone"), { force: true });
  symlinkSync(CLONE, join(root, "repos", "clone"));
  const r = spawnSync("bash", ["-c", `cd '${CLONE}' && DEVENV_ROOT='${root}' DEVENV_ROOT_SET=1 PATH='${join(root, "bin")}:${process.env.PATH ?? ""}' node '${SCRIPT}'`], {
    encoding: "utf8",
    env: GIT_ENV(),
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `getupd-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  ORIGIN = join(TMP, "origin.git");
  SEED = join(TMP, "seed");
  CLONE = join(TMP, "clone");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", ORIGIN], { env: GIT_ENV() });
  spawnSync("git", ["init", "-q", "-b", "main", SEED], { env: GIT_ENV() });
  spawnSync("git", ["remote", "add", "origin", ORIGIN], { cwd: SEED, env: GIT_ENV() });
  commitIn(SEED, "base");
  gitIn(SEED, ["push", "-q", "origin", "main"]);
  spawnSync("git", ["clone", "-q", ORIGIN, CLONE], { env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "t@example.test"], { cwd: CLONE, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "t"], { cwd: CLONE, env: GIT_ENV() });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("scripts/repo-get-update", () => {
  it("a clean clone on the default branch fast-forwards to origin", () => {
    advanceOrigin();
    const r = updateClone();
    expect(r.status).toBe(0);
    expect(revIn(CLONE, "HEAD")).toBe(revIn(ORIGIN, "main"));
  });

  it("unpushed commits on the default branch survive an update, and the repo is skipped with a message", () => {
    commitIn(CLONE, "mine");
    const mine = revIn(CLONE, "HEAD");
    advanceOrigin();
    const r = updateClone();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Skipping");
    expect(r.out).toContain("unpushed");
    expect(revIn(CLONE, "HEAD")).toBe(mine);
  });

  it("uncommitted changes survive an update, and the repo is skipped with a message", () => {
    writeFileSync(join(CLONE, "base.txt"), "base\nlocal-edit\n");
    advanceOrigin();
    const r = updateClone();
    expect(r.status).toBe(0);
    expect(r.out).toContain("Skipping");
    expect(r.out).toContain("uncommitted");
    expect((spawnSync("cat", [join(CLONE, "base.txt")], { encoding: "utf8" }).stdout ?? "")).toContain("local-edit");
  });

  it("on a feature branch a clean update fast-forwards the default branch and leaves the feature branch's commits", () => {
    gitIn(CLONE, ["checkout", "-q", "-b", "feature"]);
    commitIn(CLONE, "feat");
    advanceOrigin();
    const r = updateClone();
    expect(r.status).toBe(0);
    expect(revIn(CLONE, "main")).toBe(revIn(ORIGIN, "main"));
    expect(spawnSync("test", ["-f", join(CLONE, "feat.txt")]).status).toBe(0);
    expect((gitIn(CLONE, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim()).toBe("feature");
  });

  it("a local default branch with unpushed commits is not overwritten while another branch is checked out", () => {
    commitIn(CLONE, "mine");
    const mine = revIn(CLONE, "HEAD");
    gitIn(CLONE, ["checkout", "-q", "-b", "feature"]);
    advanceOrigin();
    updateClone();
    expect(revIn(CLONE, "main")).toBe(mine);
  });

  it("the update never uses reset --hard", () => {
    const src = (spawnSync("cat", [SCRIPT], { encoding: "utf8" }).stdout ?? "") + (spawnSync("cat", [join(TOOLS, "ts", "repo-get.ts")], { encoding: "utf8" }).stdout ?? "");
    expect(src).not.toContain("reset --hard");
  });

  it("repo-update-all exits non-zero when a repo update fails", () => {
    const root = join(TMP, "root");
    mkdirSync(join(root, "repos", "broken", ".git"), { recursive: true });
    // a fake tools root whose repo-get always fails
    const fake = join(TMP, "tools");
    mkdirSync(join(fake, "ts"), { recursive: true });
    cpSync(join(TOOLS, "lib"), join(fake, "lib"), { recursive: true });
    writeFileSync(join(fake, "repo-get"), '#!/bin/bash\necho nope >&2\nexit 1\n');
    spawnSync("chmod", ["+x", join(fake, "repo-get")]);
    cpSync(join(TOOLS, "ts", "repo-update-all.ts"), join(fake, "ts", "repo-update-all.ts"));
    const r = spawnSync("node", [join(fake, "ts", "repo-update-all.ts"), "--jobs", "1"], {
      encoding: "utf8",
      env: { ...GIT_ENV(), DEVENV_ROOT: root, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: fake },
    });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Update failed");
  });
});
