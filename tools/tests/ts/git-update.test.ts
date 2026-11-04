// Port of tools/tests/scripts/test_git_update.bats (15 tests).
// git-update classification states, driven in throwaway repos: up to date,
// strictly behind, ahead, diverged, and the rewritten-origin fixture family
// (reset / replay-via-rebase / dirty refusal / merge-commit refusal /
// rebase-conflict abort).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "tools", "git-update");

let TMP = "";
let ORIGIN = "";
let CLONE = "";
let OLD_TIP = "";

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

function git(args: string[]): { status: number; stdout: string } {
  return gitIn(CLONE, args);
}

function revIn(repo: string, ref: string): string {
  return (gitIn(repo, ["rev-parse", ref]).stdout ?? "").trim();
}

function runUpdate(args: string[] = []): { status: number; out: string } {
  const r = spawnSync(SCRIPT, args, { cwd: CLONE, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// advance_origin: commit on a second clone and push, so the first clone's
// origin/master moves strictly ahead of it.
function advanceOrigin(message: string): void {
  const other = join(TMP, "other");
  if (!existsMk(other)) {
    spawnSync("git", ["clone", "-q", ORIGIN, other], { env: GIT_ENV() });
  }
  gitIn(other, ["commit", "-q", "--allow-empty", "-m", message]);
  gitIn(other, ["push", "-q", "origin", "master"]);
}

function existsMk(p: string): boolean {
  try {
    spawnSync("test", ["-d", p]);
    return spawnSync("bash", ["-c", `[ -d '${p}' ]`]).status === 0;
  } catch {
    return false;
  }
}

// rewrite_origin: on a second clone, amend the tip (changing history), then
// force-push. Leaves OLD_TIP (the pre-rewrite origin/master as the first
// clone knew it) and fetches in the first clone.
function rewriteOrigin(): void {
  const other = join(TMP, "rewriter");
  if (spawnSync("bash", ["-c", `[ -d '${other}' ]`]).status !== 0) {
    spawnSync("git", ["clone", "-q", ORIGIN, other], { env: GIT_ENV() });
  }
  OLD_TIP = revIn(other, "origin/master");
  gitIn(other, ["commit", "-q", "--allow-empty", "--amend", "-m", "rewritten base"]);
  gitIn(other, ["push", "-q", "--force", "origin", "master"]);
  gitIn(CLONE, ["fetch", "-q", "origin"]);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `gitupd-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  ORIGIN = join(TMP, "origin.git");
  CLONE = join(TMP, "clone");
  spawnSync("git", ["init", "-q", "--bare", "-b", "master", ORIGIN], { env: GIT_ENV() });
  spawnSync("git", ["clone", "-q", ORIGIN, CLONE], { env: GIT_ENV() });
  git(["commit", "-q", "--allow-empty", "-m", "base"]);
  git(["push", "-q", "origin", "master"]);
});

afterEach(() => {
  spawnSync("rm", ["-rf", TMP]);
});

describe("scripts/git-update", () => {
  it("git-update: --help prints usage without touching the repo", () => {
    const r = runUpdate(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Usage: git-update");
  });

  it("git-update: unknown argument is refused", () => {
    const r = runUpdate(["--frobnicate"]);
    expect(r.status).toBe(2);
  });

  it("git-update: up to date reports so and exits 0", () => {
    const r = runUpdate();
    expect(r.status).toBe(0);
    expect(r.out).toContain("up to date");
  });

  it("git-update: strictly behind pulls and exits 0", () => {
    advanceOrigin("new upstream commit");
    const r = runUpdate();
    expect(r.status).toBe(0);
    expect(revIn(CLONE, "HEAD")).toBe(revIn(CLONE, "origin/master"));
  });

  it("git-update: ahead of remote refuses with push guidance", () => {
    git(["commit", "-q", "--allow-empty", "-m", "local work"]);
    const r = runUpdate();
    expect(r.status).toBe(1);
    expect(r.out).toContain("ahead of the remote");
  });

  it("git-update: diverged refuses with manual-intervention guidance", () => {
    advanceOrigin("new upstream commit");
    git(["commit", "-q", "--allow-empty", "-m", "local work"]);
    const r = runUpdate();
    expect(r.status).toBe(1);
    expect(r.out).toContain("diverged");
    expect(r.out).toContain("Manual intervention");
    // Nothing was pulled or merged: local HEAD unchanged.
    expect(revIn(CLONE, "master")).not.toBe(revIn(CLONE, "origin/master"));
  });

  // ── Rewritten-origin fixture ────────────────────────────────────────────────

  it("fixture: reflog of origin/master records the pre-rewrite tip after a force-push", () => {
    rewriteOrigin();
    // The clone is still on the pre-rewrite commit; origin/master moved.
    expect(revIn(CLONE, "master")).toBe(OLD_TIP);
    expect(revIn(CLONE, "origin/master")).not.toBe(OLD_TIP);
    // The client-side reflog of the remote-tracking ref holds the old tip.
    const reflog = (gitIn(CLONE, ["reflog", "show", "--format=%H", "origin/master"]).stdout ?? "");
    expect(reflog).toContain(OLD_TIP);
  });

  it("fixture: local HEAD is a past origin/master tip — the reset-safety proof", () => {
    // Local HEAD equals a reflog-recorded past remote tip: nothing unique to lose.
    rewriteOrigin();
    const localHead = revIn(CLONE, "master");
    const reflog = (gitIn(CLONE, ["reflog", "show", "--format=%H", "origin/master"]).stdout ?? "")
      .split("\n")
      .slice(0, 50);
    expect(reflog).toContain(localHead);
  });

  it("fixture: local commit on top of the old tip — NOT a past remote tip", () => {
    // A consumer with unique work: their HEAD is a child of the old tip, not a
    // recorded remote tip itself — the rebase path, never the reset path.
    rewriteOrigin();
    git(["commit", "-q", "--allow-empty", "-m", "consumer note"]);
    const localHead = revIn(CLONE, "master");
    const reflog = (gitIn(CLONE, ["reflog", "show", "--format=%H", "origin/master"]).stdout ?? "")
      .split("\n")
      .slice(0, 50);
    expect(reflog).not.toContain(localHead);
  });

  it("fixture: the check's reachability conditions identify the old tip as the base", () => {
    // Phase-1 probe for the lib contract: the exact conditions from the
    // rewrite scan pick OLD_TIP out of the reflog as "rewritten, and here is
    // the pre-rewrite base".
    rewriteOrigin();
    const localHead = revIn(CLONE, "master");
    const originNow = revIn(CLONE, "origin/master");
    const tips = (gitIn(CLONE, ["reflog", "show", "--format=%H", "origin/master"]).stdout ?? "")
      .split("\n")
      .filter(Boolean)
      .slice(0, 50);
    let found = false;
    for (const tip of tips) {
      if (!tip || tip === originNow) continue;
      const isAncestorLocal = gitIn(CLONE, ["merge-base", "--is-ancestor", tip, localHead]).status === 0;
      const isAncestorOrigin = gitIn(CLONE, ["merge-base", "--is-ancestor", tip, originNow]).status === 0;
      const exists = gitIn(CLONE, ["cat-file", "-e", `${tip}^{commit}`]).status === 0;
      if (isAncestorLocal && !isAncestorOrigin && exists) {
        if (tip === OLD_TIP) found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  // ── Rewritten-path behavior (Phase 2) ──────────────────────────────────────

  it("git-update: rewritten remote + nothing unique resets to origin", () => {
    rewriteOrigin();
    const r = runUpdate();
    expect(r.status).toBe(0);
    expect(revIn(CLONE, "master")).toBe(revIn(CLONE, "origin/master"));
    expect(r.out).toContain("rewritten");
    expect(r.out).toContain("Resetting");
  });

  it("git-update: rewritten remote + unique local commits replays them via rebase", () => {
    rewriteOrigin();
    git(["commit", "-q", "--allow-empty", "-m", "consumer note"]);
    const r = runUpdate();
    expect(r.status).toBe(0);
    // origin/master is fully contained in master (rebased ON TOP of it).
    expect(git(["merge-base", "--is-ancestor", "origin/master", "master"]).status).toBe(0);
    expect(r.out).toContain("replaying local commits");
    // The consumer's commit survived the replay.
    const log = (git(["log", "--format=%s", "-2"]).stdout ?? "");
    expect(log).toContain("consumer note");
  });

  it("git-update: rewritten remote + dirty tree refuses before touching anything", () => {
    rewriteOrigin();
    writeFileSync(join(CLONE, "dirty.txt"), "uncommitted\n");
    git(["add", "dirty.txt"]);
    const r = runUpdate();
    expect(r.status).toBe(1);
    expect(r.out).toContain("Commit or discard");
    // Local HEAD unchanged: still on the pre-rewrite tip.
    expect(revIn(CLONE, "master")).toBe(OLD_TIP);
  });

  it("git-update: rewritten remote + local merge commit refuses the auto-rebase", () => {
    rewriteOrigin();
    // A local merge commit on top of the old tip (octopus-free, two parents).
    gitIn(CLONE, ["checkout", "-q", "-b", "side", OLD_TIP]);
    git(["commit", "-q", "--allow-empty", "-m", "side work"]);
    gitIn(CLONE, ["checkout", "-q", "master"]);
    git(["commit", "-q", "--allow-empty", "-m", "main work"]);
    git(["merge", "-q", "--no-ff", "side", "-m", "local merge"]);
    const r = runUpdate();
    expect(r.status).toBe(1);
    expect(r.out).toContain("merge commit");
    // Untouched: still on the local merge.
    expect((git(["log", "--format=%s", "-1"]).stdout ?? "").trim()).toBe("local merge");
  });

  it("git-update: rebase conflict on rewritten remote aborts and leaves branch unchanged", () => {
    rewriteOrigin();
    // Give origin a FILE at a path the consumer also wrote locally: the rebase
    // of the local commit onto the rewritten history must conflict.
    git(["commit", "-q", "--allow-empty", "-m", "pre-conflict base"]);
    const other = join(TMP, "conflictor");
    spawnSync("git", ["clone", "-q", ORIGIN, other], { env: GIT_ENV() });
    writeFileSync(join(other, "note.txt"), "upstream version\n");
    gitIn(other, ["add", "note.txt"]);
    gitIn(other, ["commit", "-q", "--amend", "--no-edit"]);
    gitIn(other, ["push", "-q", "--force", "origin", "master"]);
    // New OLD_TIP after this second rewrite, then the consumer builds on it.
    OLD_TIP = (gitIn(other, ["rev-parse", "origin/master~1"]).stdout ?? "").trim();
    gitIn(CLONE, ["fetch", "-q", "origin"]);
    writeFileSync(join(CLONE, "note.txt"), "local version\n");
    git(["add", "note.txt"]);
    git(["commit", "-q", "-m", "local note"]);
    const r = runUpdate();
    expect(r.status).toBe(1);
    expect(r.out).toContain("aborted");
    expect(r.out).toContain("git rebase --onto origin/master");
    // Repo is recoverable: no rebase in progress, branch back at its pre-run tip.
    expect(spawnSync("bash", ["-c", `[ ! -d '${CLONE}/.git/rebase-merge' ] && [ ! -d '${CLONE}/.git/rebase-apply' ]`]).status).toBe(0);
    expect((git(["log", "--format=%s", "-1"]).stdout ?? "").trim()).toBe("local note");
  });
});
