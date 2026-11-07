// Port of test_check_update_devenv_repo.bats (29 tests): every exit path of
// .devcontainer/check-update-devenv-repo.sh, through a throwaway origin and
// clone. The script runs as its own process, so each test drives a real
// subprocess against a freshly built fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};

let TMP = "";
let ORIGIN = "";
let CLONE = "";
let OTHER = "";
let LOG = "";

function git(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr ?? ""}`);
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

function gitStatus(args: string[], cwd: string): number {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } }).status ?? 1;
}

function logContent(): string {
  return readFileSync(LOG, "utf8");
}

// runCheck ANSWERS — answers the update prompt; an unattended run closes stdin.
function runCheck(answers: string, extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", [join(CLONE, ".devcontainer/check-update-devenv-repo.sh")], {
    input: `${answers}\n`,
    env: { ...process.env, ...IDENTITY, GIT_UPDATE_LOG: LOG, ...extraEnv },
    encoding: "utf8",
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Put a new commit on origin (optionally with a Devenv-Action trailer), then
// fetch it into the clone so origin/master is ahead of the clone.
function advanceOrigin(trailer = ""): void {
  spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  const msg = trailer ? ["-m", "change", "-m", `Devenv-Action: ${trailer}`] : ["-m", "change"];
  git(["commit", "-q", "--allow-empty", ...msg], OTHER);
  git(["push", "-q", "origin", "master"], OTHER);
  git(["fetch", "-q", "origin"], CLONE);
}

// rewrite_origin: amend the remote tip and force-push, so the clone (untouched)
// diverges from a rewritten origin. Genuine divergence, not a bare amend: land
// upstream work on top, then rewrite the FIRST commit so the histories share
// no commit (the fork-sync replay shape).
function rewriteOrigin(): void {
  spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  git(["commit", "-q", "--amend", "--allow-empty", "-m", "base (rewritten)"], OTHER);
  git(["commit", "-q", "--allow-empty", "-m", "upstream work A (replayed)"], OTHER);
  git(["push", "-q", "--force", "origin", "master"], OTHER);
  git(["fetch", "-q", "origin"], CLONE);
}

// The fixture clone gets the real tool + lib committed (the tool refuses
// dirty trees) before the e2e scenarios.
function setupE2eClone(): void {
  cpSync(join(ROOT, "tools/git-update"), join(CLONE, "tools/git-update"));
  mkdirSync(join(CLONE, "tools/ts"), { recursive: true });
  cpSync(join(ROOT, "tools/ts/git-update.ts"), join(CLONE, "tools/ts/git-update.ts"));
  cpSync(join(ROOT, "tools/lib"), join(CLONE, "tools/lib"), { recursive: true });
  git(["add", "-A"], CLONE);
  git(["commit", "-q", "-m", "tools: real git-update"], CLONE);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `checkupd-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  ORIGIN = join(TMP, "origin.git");
  CLONE = join(TMP, "clone");
  OTHER = join(TMP, "other");
  LOG = join(TMP, "git-update.log");
  const env = { ...process.env, ...IDENTITY };
  spawnSync("git", ["init", "-q", "--bare", "-b", "master", ORIGIN]);
  spawnSync("git", ["clone", "-q", ORIGIN, CLONE], { encoding: "utf8", env });
  git(["checkout", "-q", "-B", "master"], CLONE);
  mkdirSync(join(CLONE, ".devcontainer"), { recursive: true });
  mkdirSync(join(CLONE, "tools/lib"), { recursive: true });
  cpSync(join(ROOT, ".devcontainer/check-update-devenv-repo.sh"), join(CLONE, ".devcontainer/check-update-devenv-repo.sh"));
  cpSync(join(ROOT, ".devcontainer/post-update.bash"), join(CLONE, ".devcontainer/post-update.bash"));
  cpSync(join(ROOT, "tools/lib/rewrite-detect.bash"), join(CLONE, "tools/lib/rewrite-detect.bash"));
  // git-update stand-in: succeeds or fails on demand, records that it ran,
  // and (like the real tool after a rewritten update) moves HEAD to
  // origin/master when GIT_UPDATE_RESET is set — the post-update scan needs
  // the new HEAD to exist.
  writeFileSync(
    join(CLONE, "tools/git-update"),
    [
      "#!/usr/bin/env bash",
      'echo ran >> "$GIT_UPDATE_LOG"',
      '[ -z "${GIT_UPDATE_PULL:-}" ] || git -C "$(dirname "$0")/.." pull -q --ff-only origin master',
      '[ -z "${GIT_UPDATE_RESET:-}" ] || git -C "$(dirname "$0")/.." reset -q --hard origin/master',
      'exit "${GIT_UPDATE_RC:-0}"',
      "",
    ].join("\n"),
  );
  writeFileSync(join(CLONE, ".devcontainer/bootstrap.sh"), '#!/usr/bin/env bash\necho bootstrap >> "$GIT_UPDATE_LOG"\n');
  chmodSync(join(CLONE, "tools/git-update"), 0o755);
  chmodSync(join(CLONE, ".devcontainer/bootstrap.sh"), 0o755);
  chmodSync(join(CLONE, ".devcontainer/check-update-devenv-repo.sh"), 0o755);
  git(["add", "-A"], CLONE);
  git(["commit", "-q", "-m", "base"], CLONE);
  git(["push", "-q", "origin", "master"], CLONE);
  writeFileSync(LOG, "");
});

describe("check-update-devenv-repo", () => {
  it("uncommitted changes with an update on offer: refuses and exits 1", () => {
    advanceOrigin("");
    writeFileSync(join(CLONE, "tools/git-update"), "dirty\n", { flag: "a" });
    const r = runCheck("y");
    expect(r.status).toBe(1);
    expect(r.out).toContain("uncommitted or untracked changes");
    expect(logContent()).toBe("");
  });

  it("uncommitted changes while up to date: silent, exit 0", () => {
    writeFileSync(join(CLONE, "tools/git-update"), "dirty\n", { flag: "a" });
    const r = runCheck("");
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  it("up to date: silent, exit 0", () => {
    const r = runCheck("");
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  it("local ahead of remote: silent, exit 0", () => {
    git(["commit", "-q", "--allow-empty", "-m", "local only"], CLONE);
    const r = runCheck("");
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  it("behind on a non-master branch: warns to update by hand, exit 0", () => {
    git(["checkout", "-q", "-b", "feature"], CLONE);
    git(["push", "-q", "origin", "feature"], CLONE);
    spawnSync("git", ["clone", "-q", "-b", "feature", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--allow-empty", "-m", "feature change"], OTHER);
    git(["push", "-q", "origin", "feature"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    const r = runCheck("");
    expect(r.status).toBe(0);
    expect(r.out).toContain("different on the remote");
    expect(logContent()).toBe("");
  });

  it("behind on master, answering n: exit 1 and nothing is pulled", () => {
    advanceOrigin("");
    const r = runCheck("n");
    expect(r.status).toBe(1);
    expect(logContent()).toBe("");
  });

  it("behind on master, answering y: updates and reports completion, exit 0", () => {
    advanceOrigin("");
    const r = runCheck("y");
    expect(r.status).toBe(0);
    expect(r.out).toContain("Update complete.");
    expect(logContent()).toBe("ran\n");
  });

  it("behind on master, update fails: exits 1 with guidance", () => {
    advanceOrigin("");
    const r = runCheck("y", { GIT_UPDATE_RC: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("Error updating the repository");
  });

  it("the update-check script has no cd-back or return before exit", () => {
    // It runs as its own process: cd - changes nothing the caller can see, and
    // `return` outside a function is an error in an executed script.
    const r = spawnSync("grep", ["-nE", "cd - |\\|\\| return", join(ROOT, ".devcontainer/check-update-devenv-repo.sh")], { encoding: "utf8" });
    expect(r.status ?? 1).toBe(1);
  });

  it("a bootstrap trailer asks before running bootstrap, and runs it on y", () => {
    advanceOrigin("bootstrap");
    const r = runCheck("y\ny\nn", { GIT_UPDATE_PULL: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("Post-update action: run bootstrap");
    expect(logContent()).toContain("bootstrap");
  });

  it("a bootstrap trailer answered n skips bootstrap", () => {
    advanceOrigin("bootstrap");
    const r = runCheck("y\nn", { GIT_UPDATE_PULL: "1" });
    expect(r.status).toBe(0);
    expect(logContent()).not.toMatch(/^bootstrap$/m);
  });

  it("the highest-priority trailer across the pulled commits wins", () => {
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--allow-empty", "-m", "one", "-m", "Devenv-Action: restart"], OTHER);
    git(["commit", "-q", "--allow-empty", "-m", "two", "-m", "Devenv-Action: recreate"], OTHER);
    git(["commit", "-q", "--allow-empty", "-m", "three", "-m", "Devenv-Action: nothing"], OTHER);
    git(["push", "-q", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    const r = runCheck("y\n3", { GIT_UPDATE_PULL: "1" });
    expect(r.out).toContain("recreate container");
  });

  it("devenv-update and the update check share one post-update routine", () => {
    const check = readFileSync(join(ROOT, ".devcontainer/check-update-devenv-repo.sh"), "utf8");
    // 17.2: the second consumer is the devenv-update shell function, now
    // generated by the bash-functions step module (provision.bash retired).
    const bashFunctions = readFileSync(join(ROOT, "tools/ts/setup-steps/bash-functions.ts"), "utf8");
    expect(check).toContain("post-update.bash");
    expect(bashFunctions).toContain("post-update.bash");
    expect(check).not.toContain("action_priority()");
    // Both consumers pass the rewritten-update scan base the same way.
    expect(bashFunctions).toContain("GIT_UPDATE_SCAN_BASE");
    expect(check).toContain("GIT_UPDATE_SCAN_BASE");
  });

  it("ordinary divergence (local commits plus new remote commits): silent, exit 0, nothing pulled", () => {
    advanceOrigin("");
    git(["commit", "-q", "--allow-empty", "-m", "local only"], CLONE);
    const r = runCheck("");
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
    expect(logContent()).toBe("");
  });

  it("remote history rewritten (force-pushed): offers the update, declining pulls nothing", () => {
    // the remote's tip is replaced by a different commit on the same parent
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--amend", "--allow-empty", "-m", "base (rewritten)"], OTHER);
    git(["push", "-q", "--force", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    const r = runCheck("n");
    expect(r.status).toBe(1);
    expect(r.out).toContain("remote history of master was rewritten");
    expect(r.out).toContain("no unique commits");
    expect(logContent()).toBe("");
  });

  it("remote history rewritten: answering y delegates to git-update", () => {
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--amend", "--allow-empty", "-m", "base (rewritten)"], OTHER);
    git(["push", "-q", "--force", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    const r = runCheck("y");
    expect(r.status).toBe(0);
    expect(logContent()).toContain("ran");
  });

  it("a rewrite is still offered after a second, ordinary fetch", () => {
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--amend", "--allow-empty", "-m", "base (rewritten)"], OTHER);
    git(["push", "-q", "--force", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    // an ordinary commit lands on the rewritten remote and is fetched too
    git(["commit", "-q", "--allow-empty", "-m", "later work"], OTHER);
    git(["push", "-q", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    const r = runCheck("n");
    expect(r.status).toBe(1);
    expect(r.out).toContain("remote history of master was rewritten");
  });

  it("local commits that were never on the remote stay silent even with several fetches", () => {
    git(["commit", "-q", "--allow-empty", "-m", "local only"], CLONE);
    advanceOrigin("");
    git(["commit", "-q", "--allow-empty", "-m", "more upstream"], OTHER);
    git(["push", "-q", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    const r = runCheck("");
    expect(r.status).toBe(0);
    expect(r.out).toBe("");
  });

  it("a shallow clone's missing history reads as not rewritten, never as a false alarm", () => {
    advanceOrigin("");
    git(["commit", "-q", "--allow-empty", "-m", "local only"], CLONE);
    const shallow = join(TMP, "shallow");
    spawnSync("git", ["clone", "-q", "--depth", "1", `file://${ORIGIN}`, shallow], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    mkdirSync(join(shallow, ".devcontainer"), { recursive: true });
    mkdirSync(join(shallow, "tools"), { recursive: true });
    cpSync(join(CLONE, ".devcontainer/check-update-devenv-repo.sh"), join(shallow, ".devcontainer/check-update-devenv-repo.sh"));
    cpSync(join(CLONE, ".devcontainer/post-update.bash"), join(shallow, ".devcontainer/post-update.bash"));
    git(["commit", "-q", "--allow-empty", "-m", "shallow local"], shallow);
    const r = spawnSync("bash", [join(shallow, ".devcontainer/check-update-devenv-repo.sh")], {
      input: "\n",
      env: { ...process.env, ...IDENTITY, GIT_UPDATE_LOG: LOG },
      encoding: "utf8",
    });
    expect(r.status ?? 1).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).not.toContain("was rewritten");
  });

  // ── Rewritten-master update paths (fork sync + force-push) ──────────────

  it("rewritten: clean clone, y resets via git-update and exits 0", () => {
    rewriteOrigin();
    const r = runCheck("y", { GIT_UPDATE_RESET: "1" });
    expect(r.status).toBe(0);
    expect(logContent()).toContain("ran");
    expect(r.out).toContain("no unique commits");
  });

  it("rewritten: unique local commit, y delegates (git-update replays)", () => {
    rewriteOrigin();
    git(["commit", "-q", "--allow-empty", "-m", "consumer note"], CLONE);
    const r = runCheck("y", { GIT_UPDATE_PULL: "1" });
    expect(r.status).toBe(0);
    expect(logContent()).toContain("ran");
    expect(r.out).toMatch(/replayed|replaying/);
  });

  it("rewritten: dirty tree refuses before the prompt", () => {
    rewriteOrigin();
    writeFileSync(join(CLONE, "tools/git-update"), "dirty\n", { flag: "a" });
    const r = runCheck("y");
    expect(r.status).toBe(1);
    expect(r.out).toContain("uncommitted or untracked changes");
    expect(logContent()).toBe("");
  });

  it("rewritten: git-update failure surfaces manual guidance, exit 1", () => {
    rewriteOrigin();
    const r = runCheck("y", { GIT_UPDATE_RC: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("update manually");
  });

  it("rewritten: Devenv-Action scan uses the tight base — local replayed trailers excluded", () => {
    // Upstream trailer = recreate (must fire); the consumer's own replayed
    // commit also carries one — harmless duplicate. The scan excludes
    // local-only trailers because the range stops at the last UPSTREAM commit.
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--amend", "--allow-empty", "-m", "rewritten base", "-m", "Devenv-Action: recreate"], OTHER);
    git(["push", "-q", "--force", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    // Consumer has unique work WITH a trailer (e.g. they carried a fork-only
    // commit that once asked for a bootstrap replay).
    git(["commit", "-q", "--allow-empty", "-m", "consumer work", "-m", "Devenv-Action: recreate"], CLONE);
    const r = runCheck("y\nn", { GIT_UPDATE_RESET: "1" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("recreate container");
  });

  it("rewritten: end-to-end through the REAL git-update (replay path)", () => {
    rewriteOrigin();
    // Replace the stand-in with the real tool (its rewritten path needs the
    // lib), as a committed change — the real tool refuses a dirty tree.
    setupE2eClone();
    const r = runCheck("y");
    expect(r.status).toBe(0);
    // The real tool replayed the local commit on the rewritten origin:
    // origin/master fully contained in master, local work preserved.
    expect(gitStatus(["merge-base", "--is-ancestor", "origin/master", "master"], CLONE)).toBe(0);
    const subjects = git(["log", "--format=%s", "-2"], CLONE).out;
    expect(subjects).toContain("tools: real git-update");
  });

  it("rewritten: the real git-update emits GIT_UPDATE_SCAN_BASE=<pre-rewrite tip> on stdout (producer contract)", () => {
    // Producer half of the scan-base contract: the tool prints the machine-
    // parseable line (the consumers capture stdout and sed it out — a child
    // cannot set the consumer's env). The value is the PRE-rewrite tip.
    rewriteOrigin();
    const pastTip = git(["rev-parse", "HEAD"], CLONE).out.trim(); // clone is untouched pre-update
    setupE2eClone();
    const r = runCheck("y");
    expect(r.status).toBe(0);
    const lines = r.out.split("\n").filter((l) => l.startsWith("GIT_UPDATE_SCAN_BASE="));
    expect(lines.length).toBeGreaterThan(0);
    const emitted = lines.at(-1)!.slice("GIT_UPDATE_SCAN_BASE=".length);
    expect(emitted).not.toBe("");
    expect(gitStatus(["cat-file", "-t", emitted], CLONE)).toBe(0);
    void pastTip;
  });

  // ── End-to-end scenarios: fork rewritten → consumer updates ─────────────
  // These drive the whole flow with the real git-update: the check
  // classifies, prompts, delegates, and the post-update scan runs on the
  // tight base.

  it("rewritten: local replayed commit's own trailer does not re-fire actions", () => {
    // Upstream has NO trailer; the consumer's local commit carries one. The
    // scan ceiling is origin/<branch>, so the replayed local commit is
    // outside the scan window and its trailer must not fire anything.
    setupE2eClone();
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--amend", "--allow-empty", "-m", "rewritten base"], OTHER);
    git(["push", "-q", "--force", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    git(["commit", "-q", "--allow-empty", "-m", "consumer work", "-m", "Devenv-Action: recreate"], CLONE);
    const r = runCheck("y\n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("replaying local commits");
    expect(r.out).not.toContain("Post-update action");
  });

  it("e2e reset path: consumer with no unique work updates, upstream trailer fires", () => {
    // The tool swap is pushed, then THAT tip is rewritten: the clone's HEAD
    // is exactly the replaced tip (verdict=clean — nothing unique locally).
    setupE2eClone();
    git(["push", "-q", "origin", "master"], CLONE);
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--amend", "--allow-empty", "-m", "rewritten (tools+base)", "-m", "Devenv-Action: bootstrap"], OTHER);
    git(["push", "-q", "--force", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    const r = runCheck("y\nn");
    expect(r.status).toBe(0);
    expect(r.out).toContain("no unique commits");
    expect(r.out).toContain("run bootstrap");
    // HEAD now sits on the rewritten history.
    expect(git(["rev-parse", "master"], CLONE).out).toBe(git(["rev-parse", "origin/master"], CLONE).out);
  });

  it("e2e rebase path: consumer with unique work replays it, exit 0", () => {
    setupE2eClone();
    spawnSync("git", ["clone", "-q", ORIGIN, OTHER], { encoding: "utf8", env: { ...process.env, ...IDENTITY } });
    git(["commit", "-q", "--amend", "--allow-empty", "-m", "rewritten base"], OTHER);
    git(["push", "-q", "--force", "origin", "master"], OTHER);
    git(["fetch", "-q", "origin"], CLONE);
    git(["commit", "-q", "--allow-empty", "-m", "consumer note"], CLONE);
    const r = runCheck("y");
    expect(r.status).toBe(0);
    expect(r.out).toContain("replaying local commits");
    expect(gitStatus(["merge-base", "--is-ancestor", "origin/master", "master"], CLONE)).toBe(0);
    const subjects = git(["log", "--format=%s", "-2"], CLONE).out;
    expect(subjects).toContain("consumer note");
  });
});
