// repo-get safety gates: repository scripts (.repo/init.sh, .repo/update.sh)
// run only for org-owned origins or under an explicit --run-scripts, updates
// never leave a repository mid-rebase, and the clone argv ends option parsing
// before the URL. Fixtures: local bare repos as origins; an insteadOf rule in a
// per-test global git config makes an org-shaped https URL resolve to a local
// path, so no real remote is ever contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CALLS_LOG_NAME,
  pathWithStubs,
  rmrf,
  runTool,
  stubCalls,
  stubCli,
  stubGh,
  tmpDir,
  tmpToolboxRoot,
} from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let TMP = "";
let ROOT = "";
let BIN = "";
let GLOBAL_CFG = "";
let ORIGIN = "";

const ORG_URL = "https://github.com/test-org/r1.git";

function env(): Record<string, string> {
  return { DEVENV_ROOT: ROOT, PATH: pathWithStubs(BIN), GIT_CONFIG_GLOBAL: GLOBAL_CFG };
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env() } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return (r.stdout ?? "").trim();
}

function commitFile(cwd: string, file: string, content: string, msg: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

function sentinelScript(name: string, sentinel: string): string {
  return `#!/bin/sh\necho ran > "${sentinel}"\n`;
}

/** Seed ORIGIN with a base commit and (optionally) repo scripts that touch sentinels. */
function seedOrigin(sentinels: { init: string; update: string } | null): void {
  ORIGIN = join(TMP, "r1.git");
  git(TMP, ["init", "-q", "--bare", "-b", "main", ORIGIN]);
  const seed = join(TMP, "seed");
  git(TMP, ["init", "-q", "-b", "main", seed]);
  git(seed, ["remote", "add", "origin", ORIGIN]);
  commitFile(seed, "base.txt", "base\n", "base");
  if (sentinels !== null) {
    mkdirSync(join(seed, ".repo"));
    writeFileSync(join(seed, ".repo", "init.sh"), sentinelScript("init", sentinels.init));
    writeFileSync(join(seed, ".repo", "update.sh"), sentinelScript("update", sentinels.update));
    chmodSync(join(seed, ".repo", "init.sh"), 0o755);
    chmodSync(join(seed, ".repo", "update.sh"), 0o755);
    git(seed, ["add", ".repo"]);
    git(seed, ["commit", "-q", "-m", "chore: repo scripts"]);
  }
  git(seed, ["push", "-q", "origin", "main"]);
}

beforeEach(() => {
  TMP = tmpDir("git-safety-repo-get");
  ROOT = tmpToolboxRoot("repo-get-root");
  BIN = tmpDir("repo-get-bin");
  stubGh(BIN);
  GLOBAL_CFG = join(TMP, "gitconfig");
  writeFileSync(
    GLOBAL_CFG,
    "[user]\n\tname = t\n\temail = t@example.test\n[protocol \"file\"]\n\tallow = always\n",
  );
  mkdirSync(join(ROOT, "repos"), { recursive: true });
});

afterEach(() => {
  rmrf(TMP);
  rmrf(ROOT);
  rmrf(BIN);
});

function repoGet(args: string[]): { status: number; output: string } {
  const r = runTool("repo-get", args, { env: env() });
  return { status: r.status, output: r.output };
}

describe("repo-get script execution policy", () => {
  it("a foreign URL clone does not run .repo scripts without --run-scripts", () => {
    const init = join(TMP, "init-ran");
    const update = join(TMP, "update-ran");
    seedOrigin({ init, update });
    const r = repoGet([ORIGIN]);
    expect(r.status).toBe(0);
    expect(existsSync(join(ROOT, "repos", "r1", ".git"))).toBe(true);
    expect(existsSync(init)).toBe(false);
    expect(existsSync(update)).toBe(false);
  });

  it("a foreign URL clone runs the scripts when --run-scripts is passed", () => {
    const init = join(TMP, "init-ran");
    const update = join(TMP, "update-ran");
    seedOrigin({ init, update });
    const r = repoGet(["--run-scripts", ORIGIN]);
    expect(r.status).toBe(0);
    expect(existsSync(init)).toBe(true);
    expect(existsSync(update)).toBe(true);
  });

  it("updating a foreign URL clone does not run update.sh without --run-scripts", () => {
    const init = join(TMP, "init-ran");
    const update = join(TMP, "update-ran");
    seedOrigin({ init, update });
    git(TMP, ["clone", "-q", ORIGIN, join(ROOT, "repos", "r1")]);
    expect(repoGet([ORIGIN]).status).toBe(0);
    expect(existsSync(update)).toBe(false);
    expect(existsSync(init)).toBe(false);
  });

  it("org mode update does not run update.sh for a clone whose origin is not org-owned", () => {
    const init = join(TMP, "init-ran");
    const update = join(TMP, "update-ran");
    seedOrigin({ init, update });
    git(TMP, ["clone", "-q", ORIGIN, join(ROOT, "repos", "r1")]);
    const r = repoGet(["r1"]);
    expect(r.status).toBe(0);
    expect(existsSync(update)).toBe(false);
  });

  it("org mode update runs update.sh for an org-owned origin", () => {
    const init = join(TMP, "init-ran");
    const update = join(TMP, "update-ran");
    seedOrigin({ init, update });
    writeFileSync(GLOBAL_CFG, `${readFileSync(GLOBAL_CFG, "utf8")}[url "${ORIGIN}"]\n\tinsteadOf = ${ORG_URL}\n`);
    git(TMP, ["clone", "-q", ORG_URL, join(ROOT, "repos", "r1")]);
    const r = repoGet(["r1"]);
    expect(r.status).toBe(0);
    expect(existsSync(update)).toBe(true);
  });

  it("org mode clone of an org repository runs init.sh", () => {
    const init = join(TMP, "init-ran");
    const update = join(TMP, "update-ran");
    seedOrigin({ init, update });
    writeFileSync(GLOBAL_CFG, `${readFileSync(GLOBAL_CFG, "utf8")}[url "${ORIGIN}"]\n\tinsteadOf = ${ORG_URL}\n`);
    const r = repoGet(["r1"]);
    expect(r.status).toBe(0);
    expect(existsSync(init)).toBe(true);
  });

  it("documents --run-scripts in --help", () => {
    const r = repoGet(["--help"]);
    expect(r.output).toContain("--run-scripts");
  });
});

describe("repo-get updates", () => {
  it("a non-fast-forward branch update is skipped, never rebased", () => {
    seedOrigin(null);
    const clone = join(ROOT, "repos", "r1");
    git(TMP, ["clone", "-q", ORIGIN, clone]);
    git(clone, ["checkout", "-q", "-b", "feature"]);
    commitFile(clone, "shared.txt", "mine\n", "mine");
    git(clone, ["push", "-q", "-u", "origin", "feature"]);
    // Someone rewrites the shared file on the remote branch; local has its own change too.
    const other = join(TMP, "other");
    git(TMP, ["clone", "-q", ORIGIN, other]);
    git(other, ["checkout", "-q", "feature"]);
    commitFile(other, "shared.txt", "theirs\n", "theirs");
    git(other, ["push", "-q", "origin", "feature"]);
    commitFile(clone, "shared.txt", "mine-2\n", "mine two");
    const before = git(clone, ["rev-parse", "HEAD"]);
    const r = repoGet(["r1"]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/fast-forward/i);
    expect(existsSync(join(clone, ".git", "rebase-merge"))).toBe(false);
    expect(existsSync(join(clone, ".git", "rebase-apply"))).toBe(false);
    expect(git(clone, ["rev-parse", "HEAD"])).toBe(before);
  });

  it("a fast-forwardable branch update still fast-forwards", () => {
    seedOrigin(null);
    const clone = join(ROOT, "repos", "r1");
    git(TMP, ["clone", "-q", ORIGIN, clone]);
    git(clone, ["checkout", "-q", "-b", "feature"]);
    commitFile(clone, "f.txt", "1\n", "one");
    git(clone, ["push", "-q", "-u", "origin", "feature"]);
    const other = join(TMP, "other");
    git(TMP, ["clone", "-q", ORIGIN, other]);
    git(other, ["checkout", "-q", "feature"]);
    commitFile(other, "g.txt", "2\n", "two");
    git(other, ["push", "-q", "origin", "feature"]);
    const r = repoGet(["r1"]);
    expect(r.status).toBe(0);
    expect(git(clone, ["rev-parse", "HEAD"])).toBe(git(other, ["rev-parse", "HEAD"]));
  });
});

describe("repo-get clone argv", () => {
  it("separates the URL from options with --", () => {
    seedOrigin(null);
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    stubCli(
      BIN,
      "git",
      `#!/bin/sh\nprintf '%s\\n' "git $*" >> "${join(BIN, CALLS_LOG_NAME)}"\nexec "${realGit}" "$@"\n`,
    );
    expect(repoGet([ORIGIN]).status).toBe(0);
    const clones = stubCalls(BIN, "git").filter((l) => /\bclone\b/.test(l));
    expect(clones.length).toBeGreaterThan(0);
    expect(clones[0]).toContain(` -- ${ORIGIN}`);
  });
});
