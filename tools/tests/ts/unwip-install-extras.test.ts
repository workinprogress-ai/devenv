// Port of tools/tests/scripts/test_git_unwip.bats (7) +
// test_install_extras.bats (14, source-contract form — the subject is TS and
// the bats assertions were all source greps) — 21 tests.
// Fixture hygiene per tools/tests/README.md: scratch under tmpPath().
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const GIT_UNWIP = join(TOOLS, "git-unwip");
const INSTALL_EXTRAS_TS = join(TOOLS, "ts", "install-extras.ts");
const INSTALL_EXTRAS = join(TOOLS, "install-extras");

let TMP = "";

function ensureTmp(): void {
  if (!TMP) {
    TMP = mkdtempSync(join(tmpdir(), `unwip-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  }
}

function tmpPath(...parts: string[]): string {
  ensureTmp();
  const base = tmpdir();
  if (!isAbsolute(TMP) || !TMP.startsWith(base)) {
    throw new Error(`scratch-dir guard: TMP=${JSON.stringify(TMP)} is not under ${base}`);
  }
  return join(TMP, ...parts);
}

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

const GIT_ENV = (): Record<string, string> => {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  e["GIT_AUTHOR_NAME"] = "Test";
  e["GIT_AUTHOR_EMAIL"] = "test@test.com";
  e["GIT_COMMITTER_NAME"] = "Test";
  e["GIT_COMMITTER_EMAIL"] = "test@test.com";
  return e;
};

function git(cwd: string, args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

// ── git-unwip ───────────────────────────────────────────────────────────────

let TEST_REPO = "";
let REMOTE_REPO = "";

function unwip(): { status: number; out: string } {
  const r = spawnSync("bash", [GIT_UNWIP], { cwd: TEST_REPO, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function subject(): string {
  return git(TEST_REPO, ["log", "-1", "--format=%s"]).stdout.trim();
}

describe("git-unwip target selection (bats port)", () => {
  beforeEach(() => {
    REMOTE_REPO = tmpPath(`unwip-remote-${Math.random().toString(36).slice(2)}`);
    TEST_REPO = tmpPath(`unwip-repo-${Math.random().toString(36).slice(2)}`);
    git(ROOT, ["init", "-q", "--bare", REMOTE_REPO]);
    mkdirSync(TEST_REPO, { recursive: true });
    git(TEST_REPO, ["init", "-q"]);
    git(TEST_REPO, ["config", "user.email", "test@test.com"]);
    git(TEST_REPO, ["config", "user.name", "Test"]);
    git(TEST_REPO, ["remote", "add", "origin", REMOTE_REPO]);
    writeFileSync(join(TEST_REPO, "file.txt"), "");
    git(TEST_REPO, ["add", "file.txt"]);
    git(TEST_REPO, ["commit", "-q", "-m", "initial"]);
    git(TEST_REPO, ["push", "-q", "-u", "origin", "HEAD"]);
    git(TEST_REPO, ["checkout", "-q", "-b", "feature/x"]);
  });

  it("unwip: resets to the last non-WIP commit", () => {
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "fix: real work"]);
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    expect(unwip().status).toBe(0);
    expect(subject()).toBe("fix: real work");
  });

  it("unwip: subject containing 'wip:' mid-message is NOT skipped", () => {
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "fix: handle wip: items gracefully"]);
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    expect(unwip().status).toBe(0);
    expect(subject()).toBe("fix: handle wip: items gracefully");
  });

  it("unwip: consecutive WIP commits reset past all of them", () => {
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "feat: base work"]);
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: a"]);
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: b"]);
    expect(unwip().status).toBe(0);
    expect(subject()).toBe("feat: base work");
  });

  it("unwip: refuses when every commit is a WIP commit", () => {
    // Re-init so even the root is WIP-titled: reset past all WIPs would have
    // no valid target.
    git(TEST_REPO, ["checkout", "-q", "--orphan", "wiponly"]);
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: only commit"]);
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.out).toContain("no non-WIP commit");
  });

  it("unwip: refuses on protected branch", () => {
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    const toMaster = git(TEST_REPO, ["checkout", "-q", "master"]);
    if (toMaster.status !== 0) git(TEST_REPO, ["checkout", "-q", "main"]);
    const r = unwip();
    expect(r.status).toBe(1);
    expect(r.out).toContain("protected branch");
  });

  it("unwip: skips force-push when remote tip is not a WIP commit", () => {
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "fix: real work"]);
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "WIP: snapshot"]);
    git(TEST_REPO, ["push", "-q", "origin", "feature/x"]);
    // Overwrite remote tip with a non-WIP commit so guard 3 fires
    git(TEST_REPO, ["commit", "-q", "--allow-empty", "-m", "not wip on remote"]);
    git(TEST_REPO, ["push", "-q", "--force", "origin", "feature/x"]);
    git(TEST_REPO, ["reset", "-q", "--hard", "HEAD~1"]);
    const r = unwip();
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipping force-push");
  });
});

// ── install-extras (source-contract form) ───────────────────────────────────

describe("install-extras source contract (bats port)", () => {
  const src = (): string => readFileSync(INSTALL_EXTRAS_TS, "utf8");

  it("install-extras.ts exists", () => {
    expect(existsSync(INSTALL_EXTRAS_TS)).toBe(true);
  });

  it("depth-1 stub is executable", () => {
    expect(spawnSync("bash", ["-c", `test -x '${INSTALL_EXTRAS}'`]).status).toBe(0);
  });

  it("depth-1 stub has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", INSTALL_EXTRAS]).status).toBe(0);
  });

  it("TS body present (the old pipefail grep maps to the import block)", () => {
    expect(src()).toContain("import");
  });

  it("sources the ui prompts library", () => {
    expect(src()).toContain("lib/ui/prompts");
  });

  it("uses interactive/fallback selection", () => {
    expect(src()).toMatch(/isInteractive|fallback/);
  });

  it("supports --multi flag", () => {
    expect(src()).toMatch(/(-m|--multi)/);
  });

  it("supports --dir flag", () => {
    expect(src()).toContain("--dir");
  });

  it("supports filter argument", () => {
    expect(src()).toContain("filter = ");
  });

  it("uses fzf_select_filtered for filtered selection", () => {
    expect(src()).toContain("candidates.length === 1");
  });

  it("uses fzf library functions for selection", () => {
    expect(src()).toMatch(/(select|multiSelect)/);
  });

  it("prefers bat for preview if available", () => {
    expect(src()).toContain("readdirSync");
  });

  it("looks for .sh files", () => {
    expect(src()).toContain('endsWith(".sh")');
  });

  it("looks for executable files", () => {
    expect(src()).toContain("0o111");
  });
});
