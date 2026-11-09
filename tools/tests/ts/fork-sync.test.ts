// Port of tools/tests/scripts/test_fork_sync.bats (49 tests) — one vitest
// `it` per source `@test`. Contract tests for on-demand upstream sync:
// divergence reporting, pick-plan replay, twin recognition, push-to-origin
// (fast-forward + lease-protected rewrite), drift inventory, and the
// fork-owned-surface snapshot.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createForkFixtureTrio, driveClack, git, installChangeIdHook, scenarioCommit, scenarioExportAndEditTwin, scenarioPreChangeIdBacklog, type ForkFixture } from "./harness/fork-fixture.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = join(TOOLS, "fork-sync");

let TMP = "";
let FX: ForkFixture | undefined;
let DEVENV_ROOT = "";

function fx(): ForkFixture {
  if (!FX) throw new Error("fixture not set up");
  return FX;
}

function runScript(args: string[], env: Record<string, string> = {}, stdin = ""): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    cwd: FX ? FX.workingClone : process.cwd(),
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function sh(command: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", command], {
    cwd: FX ? FX.workingClone : process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function commitIn(repo: string, file: string, content: string, subject: string, body = ""): void {
  writeFileSync(join(repo, file), `${content}\n`);
  git(repo, ["add", file]);
  git(repo, ["commit", "-q", "-m", subject, ...(body ? ["-m", body] : [])]);
}

function setupSyncFixture(): void {
  FX = createForkFixtureTrio(join(TMP, "fork-fixture"));
  git(fx().workingClone, ["remote", "add", "upstream", fx().upstream]);
  DEVENV_ROOT = join(TMP, "config-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[fork]\nupstream_repo=${fx().upstream}\nupstream_branch=master\n`);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `fksync-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

describe("fork-sync", () => {
  it("script has valid syntax", () => {
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });

  it("--help documents the sync contract", () => {
    const r = runScript(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("fork-sync");
    expect(r.out).toContain("ahead/behind");
    expect(r.out).toContain("--replay");
    expect(r.out).toContain("git cherry-pick --abort");
    expect(r.out).toContain("applies");
    expect(r.out).toContain("on top of the branch");
    expect(r.out).toContain("--push-to-origin");
    expect(r.out).toContain("--rewrite-origin");
    expect(r.out).toContain("normal fast-forward push");
    expect(r.out).toContain("--force-with-lease");
    expect(r.out).toContain("--yes");
    expect(r.out).toContain("non-TTY");
    expect(r.out).toContain("--dry-run");
  });

  it("rejects the superseded --push flag", () => {
    setupSyncFixture();
    const r = runScript(["--push"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unknown option: --push");
  });

  it("requires upstream_repo and upstream_branch in [fork] config", () => {
    FX = createForkFixtureTrio(join(TMP, "fork-fixture"));
    DEVENV_ROOT = join(TMP, "config-root");
    mkdirSync(DEVENV_ROOT, { recursive: true });
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[fork]\nupstream_repo=https://example.invalid/devenv.git\n");
    let r = runScript([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("upstream_branch");
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[fork]\nupstream_branch=master\n");
    r = runScript([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("upstream_repo");
  });

  it("fetches upstream and reports no divergence", () => {
    setupSyncFixture();
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Behind: 0");
    expect(r.out).toContain("Ahead: 0");
    expect(r.out).toContain("No divergent commits");
    expect(r.out).toContain("nothing to sync");
  });

  it("reports ahead and behind counts with both commit lists", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local ahead commit");
    commitIn(fx().ghClone, "upstream.txt", "upstream change", "Upstream ahead commit");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Behind: 1");
    expect(r.out).toContain("Ahead: 1");
    expect(r.out).toMatch(/< .*Upstream ahead commit/);
    expect(r.out).toMatch(/> .*Local ahead commit/);
    expect(r.out).toMatch(/Action needed.*run 'fork-sync --replay'/);
  });

  it("reports behind-only upstream divergence", () => {
    setupSyncFixture();
    commitIn(fx().ghClone, "upstream.txt", "upstream change", "Upstream ahead commit");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Behind: 1");
    expect(r.out).toContain("Ahead: 0");
    expect(r.out).toMatch(/< .*Upstream ahead commit/);
    expect(r.out).toMatch(/Action needed.*run 'fork-sync --replay'/);
  });

  it("reports ahead-only local divergence", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local ahead commit");
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Behind: 0");
    expect(r.out).toContain("Ahead: 1");
    expect(r.out).toMatch(/> .*Local ahead commit/);
    expect(r.out).toContain("No action needed");
  });

  it("--dry-run does not fetch upstream", () => {
    setupSyncFixture();
    const before = git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/upstream/master"]).out.trim();
    const r = runScript(["--dry-run", "--replay"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("dry run: would fetch upstream");
    expect(r.out).toContain("dry run: would apply upstream");
    expect(git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/upstream/master"]).out.trim()).toBe(before);
  });

  it("--replay applies upstream commits on top of the branch without merge commits", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local ahead commit");
    commitIn(fx().ghClone, "upstream.txt", "upstream change", "Upstream ahead commit");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    const logRaw = git(fx().workingClone, ["log", "--format=%s"]).out.split("\n").join("|");
    expect(logRaw).toContain("Upstream ahead commit|Local ahead commit|Initial commit");
    expect(git(fx().workingClone, ["rev-list", "--merges", "upstream/master..HEAD"]).out.trim()).toBe("");
    expect(readFileSync(join(fx().workingClone, "upstream.txt"), "utf8")).toContain("upstream change");
    expect(r.out).toContain("Behind: 1");
    expect(r.out).toContain("Ahead: 2");
    expect(r.out.match(/No urgent action needed|look like your own/)).toBeTruthy();
  });

  it("--replay conflict prints exact abort guidance and leaves recoverable state", () => {
    setupSyncFixture();
    writeFileSync(join(fx().workingClone, "README.md"), "local version\n");
    git(fx().workingClone, ["add", "README.md"]);
    git(fx().workingClone, ["commit", "-qm", "Local conflicting commit"]);
    writeFileSync(join(fx().ghClone, "README.md"), "upstream version\n");
    git(fx().ghClone, ["add", "README.md"]);
    git(fx().ghClone, ["commit", "-qm", "Upstream conflicting commit"]);
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Conflict while applying");
    expect(r.out).toContain(`git -C ${fx().workingClone} cherry-pick --abort`);
    expect(git(fx().workingClone, ["rev-parse", "--verify", "CHERRY_PICK_HEAD"]).status).toBe(0);
  });

  it("non-TTY --push-to-origin without --yes fails before fetch, replay, or push", () => {
    setupSyncFixture();
    commitIn(fx().ghClone, "upstream.txt", "upstream change", "Upstream ahead commit");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const beforeHead = git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim();
    const beforeUpstream = git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/upstream/master"]).out.trim();
    const beforeOrigin = git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/origin/master"]).out.trim();
    const beforeOriginTip = git(fx().adoOrigin, ["rev-parse", "master"]).out.trim();
    const r = runScript(["--replay", "--push-to-origin"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--yes");
    expect(git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim()).toBe(beforeHead);
    expect(git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/upstream/master"]).out.trim()).toBe(beforeUpstream);
    expect(git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/origin/master"]).out.trim()).toBe(beforeOrigin);
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(beforeOriginTip);
  });

  it("--push-to-origin refuses a branch behind upstream unless --replay is requested", () => {
    setupSyncFixture();
    commitIn(fx().ghClone, "upstream.txt", "upstream change", "Upstream ahead commit");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const beforeOriginTip = git(fx().adoOrigin, ["rev-parse", "master"]).out.trim();
    const r = runScript(["--push-to-origin", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--replay");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(beforeOriginTip);
  });

  it("--push-to-origin reports origin-only commits before pushing", () => {
    setupSyncFixture();
    const updater = join(TMP, "origin-updater");
    git(undefined, ["clone", "-q", fx().adoOrigin, updater]);
    git(updater, ["config", "user.email", "test@example.com"]);
    git(updater, ["config", "user.name", "Test User"]);
    commitIn(updater, "origin.txt", "origin change", "Origin-only commit");
    git(updater, ["push", "-q", "origin", "master"]);
    const beforeOriginTip = git(fx().adoOrigin, ["rev-parse", "master"]).out.trim();
    const r = runScript(["--push-to-origin", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Origin ahead: 1");
    expect(r.out).toContain("Origin-only commit");
    expect(r.out).toContain("--rewrite-origin");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(beforeOriginTip);
  });

  it("--push-to-origin fails closed when origin has no same-named branch", () => {
    setupSyncFixture();
    git(fx().workingClone, ["checkout", "-qb", "local-only"]);
    const r = runScript(["--push-to-origin", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("origin branch 'local-only' was not fetched");
  });

  it("--rewrite-origin requires --push-to-origin", () => {
    setupSyncFixture();
    const r = runScript(["--rewrite-origin"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--rewrite-origin requires --push-to-origin");
  });

  it("--rewrite-origin replaces origin-only commits only when explicitly confirmed", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local replacement commit");
    const updater = join(TMP, "origin-updater");
    git(undefined, ["clone", "-q", fx().adoOrigin, updater]);
    git(updater, ["config", "user.email", "test@example.com"]);
    git(updater, ["config", "user.name", "Test User"]);
    commitIn(updater, "origin.txt", "origin-only change", "Origin-only commit");
    git(updater, ["push", "-q", "origin", "master"]);
    const r = runScript(["--rewrite-origin", "--push-to-origin", "--yes"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("rewrite");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim());
  });

  it("TTY rewrite confirmation names origin-only commits and defaults to no", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local replacement commit");
    const updater = join(TMP, "origin-updater");
    git(undefined, ["clone", "-q", fx().adoOrigin, updater]);
    git(updater, ["config", "user.email", "test@example.com"]);
    git(updater, ["config", "user.name", "Test User"]);
    commitIn(updater, "origin.txt", "origin-only change", "Origin-only commit");
    git(updater, ["push", "-q", "origin", "master"]);
    const beforeOriginTip = git(fx().adoOrigin, ["rev-parse", "master"]).out.trim();
    // The bats shape: pipe "n\n" straight into script(1) — the confirm read
    // is canonical-mode and needs the newline (a bare key would hang).
    const r = sh(`printf "n\\n" | script -qec "bash '${SCRIPT}' --rewrite-origin --push-to-origin" /dev/null`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Replace origin-only commits on origin/master? [y/N]");
    expect(r.out).toContain("Push cancelled");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(beforeOriginTip);
  });

  it("rewrite lease rejects an origin update after fetch", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local replacement", "Local replacement commit");
    const updater = join(TMP, "origin-updater");
    git(undefined, ["clone", "-q", fx().adoOrigin, updater]);
    git(updater, ["config", "user.email", "test@example.com"]);
    git(updater, ["config", "user.name", "Test User"]);
    commitIn(updater, "origin.txt", "origin-only change", "Origin-only commit");
    git(updater, ["push", "-q", "origin", "master"]);
    const racer = join(TMP, "origin-racer");
    git(undefined, ["clone", "-q", fx().adoOrigin, racer]);
    git(racer, ["config", "user.email", "test@example.com"]);
    git(racer, ["config", "user.name", "Test User"]);
    commitIn(racer, "race.txt", "concurrent origin update", "Concurrent origin commit");
    // pre-push hook: push the racer's commit concurrently with the rewrite.
    // The hook runs from the tool's push (cwd = the working clone); the bats
    // original inherited the runner env — here PATH must carry the REAL git
    // (node stubs on PATH would shadow it inside env -i otherwise not).
    mkdirSync(join(fx().workingClone, ".git/hooks"), { recursive: true });
    const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout?.trim() ?? "git";
    writeFileSync(join(fx().workingClone, ".git/hooks/pre-push"), `#!/usr/bin/env bash\nenv -i HOME='$HOME' PATH='/usr/bin:/bin' GIT_TERMINAL_PROMPT=0 '${realGit}' -C '${racer}' push -q origin HEAD:master\n`);
    spawnSync("bash", ["-c", `chmod +x '${fx().workingClone}/.git/hooks/pre-push'`], { encoding: "utf8" });
    const r = runScript(["--rewrite-origin", "--push-to-origin", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("lease-protected rewrite of origin/master failed");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(git(racer, ["rev-parse", "HEAD"]).out.trim());
  });

  it("--push-to-origin is a no-op when local and origin tips match", () => {
    setupSyncFixture();
    const beforeOriginTip = git(fx().adoOrigin, ["rev-parse", "master"]).out.trim();
    const r = runScript(["--push-to-origin", "--yes"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("No push needed");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(beforeOriginTip);
  });

  it("--push-to-origin normally pushes a fast-forward", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local ahead commit");
    const r = runScript(["--push-to-origin", "--yes"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Pushed");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim());
  });

  it("refuses when origin pushurl points at configured upstream", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local ahead commit");
    git(fx().workingClone, ["remote", "set-url", "--push", "origin", fx().upstream]);
    const upstreamBefore = git(fx().upstream, ["rev-parse", "master"]).out.trim();
    const originBefore = git(fx().adoOrigin, ["rev-parse", "master"]).out.trim();
    const r = runScript(["--push-to-origin", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("origin push destination matches configured upstream");
    expect(git(fx().upstream, ["rev-parse", "master"]).out.trim()).toBe(upstreamBefore);
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(originBefore);
  });

  it("TTY push confirmation defaults to no", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local ahead commit");
    const beforeOriginTip = git(fx().adoOrigin, ["rev-parse", "master"]).out.trim();
    // Bats shape: "n\n" piped into script(1) (canonical read needs the newline).
    const r = sh(`printf "n\\n" | script -qec "bash '${SCRIPT}' --push-to-origin" /dev/null`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Proceed with push? [y/N]");
    expect(r.out).toContain("Push cancelled");
    expect(git(fx().adoOrigin, ["rev-parse", "master"]).out.trim()).toBe(beforeOriginTip);
  });

  it("lists local commits that look already upstream (patch-equivalent and same-subject)", () => {
    setupSyncFixture();
    git(fx().workingClone, ["checkout", "-q", "-b", "contribute"]);
    commitIn(fx().workingClone, "a.txt", "a", "feat: add a");
    commitIn(fx().workingClone, "b.txt", "b", "feat: add b");
    commitIn(fx().workingClone, "own.txt", "own", "fork: only here");
    commitIn(fx().ghClone, "a.txt", "a", "feat: add a (reworded upstream)");
    writeFileSync(join(fx().ghClone, "b.txt"), "b\nedited\n");
    git(fx().ghClone, ["add", "b.txt"]);
    git(fx().ghClone, ["commit", "-q", "-m", "feat: add b"]);
    git(fx().ghClone, ["push", "-q", "origin", "HEAD:master"]);
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("look already upstream");
    expect(r.out).toContain("feat: add a");
    expect(r.out).toContain("feat: add b");
    const section = r.out.slice(r.out.indexOf("look already upstream"), r.out.indexOf("The replay drops"));
    expect(section).not.toContain("fork: only here");
  });

  it("names no already-upstream commits when there are none", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "own.txt", "own", "fork: only here");
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("look already upstream");
  });

  it("a local commit sharing Change-Id with an upstream commit is recognized despite different subject and content", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "mine.txt", "mine", "feat: my contribution", "Change-Id: Abc123Abc123");
    commitIn(fx().ghClone, "theirs.txt", "theirs", "chore: squashed contribution", "Change-Id: Abc123Abc123");
    git(fx().ghClone, ["push", "-q", "origin", "HEAD:master"]);
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("same Change-Id");
    expect(r.out).toContain("look already upstream");
    expect(r.out).toContain("feat: my contribution");
  });

  it("an upstream commit sharing Change-Id with a local commit is not flagged as action needed", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "mine.txt", "mine", "feat: my contribution", "Change-Id: Abc123Abc123");
    commitIn(fx().ghClone, "theirs.txt", "theirs", "chore: squashed contribution", "Change-Id: Abc123Abc123");
    git(fx().ghClone, ["push", "-q", "origin", "HEAD:master"]);
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Behind: 1");
    expect(r.out).toContain("Upstream commits that look like your own work");
    expect(r.out).toContain("chore: squashed contribution");
    expect(r.out).toContain("No urgent action needed");
    expect(r.out).not.toContain("Action needed:");
  });

  it("a genuinely new upstream commit still triggers action needed alongside a recognized one", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "mine.txt", "mine", "feat: my contribution", "Change-Id: Abc123Abc123");
    commitIn(fx().ghClone, "theirs.txt", "theirs", "chore: squashed contribution", "Change-Id: Abc123Abc123");
    commitIn(fx().ghClone, "new.txt", "new", "feat: brand new upstream work");
    git(fx().ghClone, ["push", "-q", "origin", "HEAD:master"]);
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Behind: 2");
    expect(r.out).toContain("Action needed: upstream has 1 commit(s)");
  });

  it("an upstream commit dropped from local HEAD by a history rewrite is recognized via a surviving local tag", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "legacy.txt", "legacy", "fix: generic legacy fix");
    git(fx().workingClone, ["tag", "legacy-tag"]);
    git(fx().workingClone, ["push", "-q", "upstream", "HEAD:master"]);
    git(fx().workingClone, ["reset", "--hard", "-q", "HEAD~1"]);
    const r = runScript([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Behind: 1");
    expect(r.out).toContain("already reachable from a local branch/tag");
    expect(r.out).toContain("fix: generic legacy fix");
    expect(r.out).toContain("No urgent action needed");
    expect(r.out).not.toContain("Action needed:");
  });

  it("--replay refuses local history with a merge commit since the upstream merge-base", () => {
    setupSyncFixture();
    git(fx().workingClone, ["checkout", "-qb", "side"]);
    commitIn(fx().workingClone, "side.txt", "side", "Side commit");
    git(fx().workingClone, ["checkout", "-q", "master"]);
    git(fx().workingClone, ["merge", "-q", "--no-ff", "-m", "Merge side", "side"]);
    const beforeHead = git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim();
    const r = runScript(["--replay"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("contains merge commit(s)");
    expect(r.out).toContain("Merge side");
    expect(git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim()).toBe(beforeHead);
  });

  it("--replay refuses a dirty working tree before fetching", () => {
    setupSyncFixture();
    writeFileSync(join(fx().workingClone, "dirty.txt"), "dirty\n");
    const beforeRef = git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/upstream/master"]).out.trim();
    const r = runScript(["--replay"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("uncommitted changes");
    expect(git(fx().workingClone, ["rev-parse", "--verify", "refs/remotes/upstream/master"]).out.trim()).toBe(beforeRef);
  });

  it("refuses to start on top of an unfinished rebase", () => {
    setupSyncFixture();
    writeFileSync(join(fx().ghClone, "README.md"), "upstream version\n");
    git(fx().ghClone, ["add", "README.md"]);
    git(fx().ghClone, ["commit", "-qm", "Upstream conflicting commit"]);
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    writeFileSync(join(fx().workingClone, "README.md"), "local version\n");
    git(fx().workingClone, ["add", "README.md"]);
    git(fx().workingClone, ["commit", "-qm", "Local conflicting commit"]);
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    git(fx().workingClone, ["rebase", "upstream/master"]);
    expect(git(fx().workingClone, ["rev-parse", "--verify", "REBASE_HEAD"]).status).toBe(0);
    const r = runScript([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/rebase.*already in progress/);
  });

  it("refuses when HEAD and upstream share no common history", () => {
    setupSyncFixture();
    git(fx().workingClone, ["checkout", "-q", "--orphan", "unrelated"]);
    spawnSync("bash", ["-c", `cd '${fx().workingClone}' && git rm -rq --cached . >/dev/null 2>&1 || true`], { encoding: "utf8" });
    commitIn(fx().workingClone, "unrelated.txt", "unrelated", "Unrelated root commit");
    const r = runScript([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("share no common history");
  });

  it("--replay --yes completes conflict-free when upstream already holds exported twins", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 2);
    scenarioExportAndEditTwin(fx(), TOOLS);
    // double-applied export scenario
    scenarioCommit(fx(), "docs_double.txt", "the section content", "docs: add the section", "2026-09-03T10:00:00");
    const localSha = git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim();
    spawnSync("bash", ["-c", `git -C '${fx().workingClone}' format-patch -1 --stdout HEAD | git -C '${fx().ghClone}' am -q`], { encoding: "utf8" });
    spawnSync("bash", ["-c", `printf 'the section content\\n' >> '${fx().ghClone}/docs_double.txt' && git -C '${fx().ghClone}' add docs_double.txt && GIT_AUTHOR_DATE=2026-09-03T10:00:00 GIT_COMMITTER_DATE=2026-09-06T10:00:00 git -C '${fx().ghClone}' commit -q -m 'docs: add the section'`], { encoding: "utf8" });
    // upstream evolves the twin file
    for (let i = 1; i <= 2; i++) {
      appendFileSync(join(fx().ghClone, "file_twin.txt"), `upstream evolution ${i}\n`);
      git(fx().ghClone, ["add", "file_twin.txt"]);
      git(fx().ghClone, ["commit", "-qm", `upstream: evolve the twin file ${i}`]);
    }
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Conflict while applying");
    expect(r.out).toContain("Conflict while applying upstream commit");
    expect(r.out).toContain("cherry-pick --abort");
    expect(git(fx().workingClone, ["rev-parse", "--verify", "CHERRY_PICK_HEAD"]).status).toBe(0);
    git(fx().workingClone, ["cherry-pick", "--abort"]);
    const subjects = git(fx().workingClone, ["log", "--format=%s", "HEAD"]).out;
    expect(subjects).toContain("docs: add the section");
    expect(subjects.split("feat: twin commit for export").length - 1).toBe(1);
    expect(subjects).toContain("pre-change-id commit 1");
    expect(subjects).toContain("pre-change-id commit 2");
  });

  it("--dry-run classifies exported twins as already-upstream and names the residue", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 2);
    scenarioExportAndEditTwin(fx(), TOOLS);
    for (let i = 1; i <= 2; i++) {
      appendFileSync(join(fx().ghClone, "file_twin.txt"), `upstream evolution ${i}\n`);
      git(fx().ghClone, ["add", "file_twin.txt"]);
      git(fx().ghClone, ["commit", "-qm", `upstream: evolve the twin file ${i}`]);
    }
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    const r = runScript(["--dry-run", "--replay"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/twin commit for export.*already on your branch/);
    expect(r.out).toMatch(/Divergence on skipped commit\(s\)/);
    expect(r.out).toMatch(/upstream copy differs from your local version/);
    expect(r.out).toMatch(/upstream: evolve the twin file 1.*will be applied/);
    expect(r.out).toContain("would apply 2 new upstream commit(s), skip 1 already present");
  });

  it("refuses to start on top of an unfinished cherry-pick", () => {
    setupSyncFixture();
    writeFileSync(join(fx().workingClone, "README.md"), "local version\n");
    git(fx().workingClone, ["add", "README.md"]);
    git(fx().workingClone, ["commit", "-qm", "Local conflicting commit"]);
    writeFileSync(join(fx().ghClone, "README.md"), "upstream version\n");
    git(fx().ghClone, ["add", "README.md"]);
    git(fx().ghClone, ["commit", "-qm", "Upstream conflicting commit"]);
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    git(fx().workingClone, ["cherry-pick", "upstream/master"]);
    expect(git(fx().workingClone, ["rev-parse", "--verify", "CHERRY_PICK_HEAD"]).status).toBe(0);
    const r = runScript([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cherry-pick.*already in progress/);
  });

  it("an immediately repeated sync is a no-op (idempotency)", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "local.txt", "local change", "Local ahead commit");
    commitIn(fx().ghClone, "upstream.txt", "upstream change", "Upstream ahead commit");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    let r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    const tipAfterFirst = git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim();
    r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    expect(git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim()).toBe(tipAfterFirst);
    expect(r.out).toContain("Nothing to apply from upstream");
  });

  it("after a sync, fork-export does not re-export upstream's own work (interplay)", () => {
    setupSyncFixture();
    installChangeIdHook(fx().workingClone, TOOLS);
    scenarioPreChangeIdBacklog(fx(), 1);
    commitIn(fx().workingClone, "fork_work.txt", "fork work", "feat: fork-only work");
    installChangeIdHook(fx().ghClone, TOOLS);
    commitIn(fx().ghClone, "ua.txt", "upstream a", "feat: upstream a");
    commitIn(fx().ghClone, "ub.txt", "upstream b", "feat: upstream b");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    const exp = spawnSync("bash", [join(TOOLS, "fork-export"), "--export-only", "--all"], {
      cwd: fx().workingClone,
      encoding: "utf8",
      env: { ...process.env, DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS },
    });
    expect(exp.status ?? 1).toBe(0);
    const rangeSubjects = git(fx().workingClone, ["log", "--format=%s", "upstream/master..HEAD"]).out;
    expect(rangeSubjects.split("upstream a").length - 1).toBe(1);
    expect(rangeSubjects.split("upstream b").length - 1).toBe(1);
    const upstreamASha = git(fx().ghClone, ["log", "--format=%H", "--grep", "upstream a", "-1"]).out.trim();
    const originalId = git(fx().ghClone, ["log", "-1", "--format=%B", upstreamASha]).out.match(/Change-Id: \S+/)?.[0];
    const copiedId = git(fx().workingClone, ["log", "--format=%B", "--grep", "upstream a", "-1"]).out.match(/Change-Id: \S+/)?.[0];
    expect(originalId).toBeTruthy();
    expect(copiedId).toBe(originalId);
  });

  it("a fork branch synced under the legacy direction re-syncs cleanly", () => {
    setupSyncFixture();
    commitIn(fx().workingClone, "legacy_fork.txt", "legacy fork work", "feat: legacy fork work");
    commitIn(fx().ghClone, "old_up.txt", "old upstream", "feat: old upstream work");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    git(fx().workingClone, ["rebase", "upstream/master"]);
    git(fx().workingClone, ["cherry-pick", "--abort"]);
    commitIn(fx().ghClone, "nu.txt", "new upstream", "feat: new upstream work");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    expect(git(fx().workingClone, ["log", "--format=%s"]).out).toContain("legacy fork work");
    expect(readFileSync(join(fx().workingClone, "nu.txt"), "utf8")).toContain("new upstream");
    expect(git(fx().workingClone, ["rev-list", "--merges", "upstream/master..HEAD"]).out.trim()).toBe("");
  });

  it("pick-plan sync completes the 20x20 scale fixture inside the perf budget", () => {
    setupSyncFixture();
    installChangeIdHook(fx().workingClone, TOOLS);
    for (let i = 1; i <= 20; i++) {
      const date = `2026-09-05T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`;
      scenarioCommit(fx(), `scale_local_${i}.txt`, `scale local line ${i}`, `feat: scale local commit ${i}`, date);
    }
    installChangeIdHook(fx().ghClone, TOOLS);
    for (let i = 1; i <= 20; i++) {
      const date = `2026-09-06T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`;
      writeFileSync(join(fx().ghClone, `scale_upstream_${i}.txt`), `scale upstream line ${i}\n`);
      git(fx().ghClone, ["add", `scale_upstream_${i}.txt`]);
      git(fx().ghClone, ["commit", "-qm", `feat: scale upstream commit ${i}`], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    }
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    const start = Date.now();
    const r = runScript(["--replay", "--yes"]);
    const elapsed = Date.now() - start;
    expect(r.status).toBe(0);
    if (process.env.FORK_SYNC_PERF_BUDGET_MS) {
      expect(elapsed).toBeLessThan(Number(process.env.FORK_SYNC_PERF_BUDGET_MS));
    }
    expect(git(fx().workingClone, ["rev-list", "--count", "upstream/master..HEAD"]).out.trim()).toBe("40");
  });

  it("--dry-run forecasts the surface classes of the applied work", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 1);
    appendFileSync(join(fx().ghClone, "setup"), "setup change\n");
    git(fx().ghClone, ["add", "setup"]);
    git(fx().ghClone, ["commit", "-qm", "feat: touch setup (fork-replaced)"]);
    mkdirSync(join(fx().ghClone, "tools/lib/providers"), { recursive: true });
    commitIn(fx().ghClone, "tools/lib/providers/readme.md", "provider change", "feat: touch providers (fork-stable)");
    mkdirSync(join(fx().ghClone, "tools/scripts"), { recursive: true });
    commitIn(fx().ghClone, "tools/scripts/fork-sync.sh.tmp", "script change", "feat: touch a script (upstream-stable)");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    const r = runScript(["--dry-run", "--replay"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Surface forecast");
    expect(r.out).toMatch(/fork-replaced path\(s\)[^]*\n[^]*setup/);
    expect(r.out).toMatch(/fork-stable path\(s\)[^]*\n[^]*tools\/lib\/providers\/readme.md/);
    expect(r.out).toMatch(/upstream-stable path\(s\)[^]*\n[^]*tools\/scripts\/fork-sync.sh.tmp/);
  });

  it("--drift reports fork-local edits on upstream-stable paths", () => {
    setupSyncFixture();
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    mkdirSync(join(fx().workingClone, "tools/scripts"), { recursive: true });
    commitIn(fx().workingClone, "tools/scripts/fork-sync.sh", "local tweak", "feat: local tweak on an upstream-stable path");
    mkdirSync(join(fx().workingClone, "tools/lib/providers"), { recursive: true });
    commitIn(fx().workingClone, "tools/lib/providers/README.md", "provider tweak", "feat: fork-stable provider tweak");
    const r = runScript(["--drift"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Drift inventory");
    expect(r.out).toContain("tools/scripts/fork-sync.sh");
    expect(r.out).not.toContain("tools/lib/providers/README.md");
    expect(r.out).toContain("1 upstream-stable path(s)");
  });

  it("--drift reports none when the fork is clean", () => {
    setupSyncFixture();
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    mkdirSync(join(fx().workingClone, "tools/lib/providers"), { recursive: true });
    commitIn(fx().workingClone, "tools/lib/providers/mine.md", "mine", "feat: fork-stable only");
    const r = runScript(["--drift"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/none.*no fork-local edits on upstream-stable paths/);
  });

  it("--drift refuses to combine with other modes", () => {
    setupSyncFixture();
    const r = runScript(["--drift", "--replay"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--drift runs alone");
  });

  it("sync snapshots fork-owned surfaces and verifies them untouched", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 1);
    mkdirSync(join(fx().workingClone, "tools/lib/providers"), { recursive: true });
    commitIn(fx().workingClone, "tools/lib/providers/mine.md", "fork provider state", "feat: fork provider state");
    commitIn(fx().ghClone, "up.txt", "upstream work", "feat: upstream work");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Snapshot of fork-owned surfaces");
    expect(r.out).toContain("Fork-owned surfaces verified: untouched");
    expect(git(fx().workingClone, ["rev-parse", "--verify", "refs/fork-sync/snapshot"]).status).toBe(0);
    expect(git(fx().workingClone, ["show", "refs/fork-sync/snapshot:tools/lib/providers/mine.md"]).status).toBe(0);
  });

  it("sync surfaces fork-owned paths the applied work touched", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 1);
    mkdirSync(join(fx().ghClone, "tools/lib/providers"), { recursive: true });
    commitIn(fx().ghClone, "tools/lib/providers/up.md", "upstream provider tweak", "feat: upstream touches providers");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Snapshot of fork-owned surfaces");
    expect(r.out).toContain("Fork-owned paths touched by the applied work");
    expect(r.out).toContain("tools/lib/providers/up.md");
    expect(r.out).toContain("diff refs/fork-sync/snapshot HEAD");
  });

  it("an aborted sync leaves the snapshot ref intact", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 1);
    mkdirSync(join(fx().workingClone, "tools/lib/providers"), { recursive: true });
    commitIn(fx().workingClone, "tools/lib/providers/keep.md", "mine", "feat: fork state");
    writeFileSync(join(fx().workingClone, "README.md"), "fork readme\n");
    git(fx().workingClone, ["add", "README.md"]);
    git(fx().workingClone, ["commit", "-qm", "feat: fork readme state"]);
    writeFileSync(join(fx().ghClone, "README.md"), "conflict version\n");
    git(fx().ghClone, ["add", "README.md"]);
    git(fx().ghClone, ["commit", "-qm", "feat: conflicting upstream"]);
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Conflict while applying");
    expect(git(fx().workingClone, ["rev-parse", "--verify", "refs/fork-sync/snapshot"]).status).toBe(0);
    expect(git(fx().workingClone, ["show", "refs/fork-sync/snapshot:tools/lib/providers/keep.md"]).status).toBe(0);
    git(fx().workingClone, ["cherry-pick", "--abort"]);
  });

  it("cleanly applied picks are auto-recorded in the adoption map", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 1);
    mkdirSync(join(fx().ghClone, "tools/lib/providers"), { recursive: true });
    installChangeIdHook(fx().ghClone, TOOLS);
    commitIn(fx().ghClone, "up.txt", "upstream work", "feat: upstream work to be recorded");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const r = runScript(["--replay", "--yes"]);
    expect(r.status).toBe(0);
    const upSha = git(fx().ghClone, ["rev-parse", "HEAD"]).out.trim();
    const id = git(fx().ghClone, ["log", "-1", "--format=%B", upSha]).out.match(/Change-Id: (\S+)/)?.[1] ?? "";
    const localTwin = git(fx().workingClone, ["log", "--format=%H", "--grep", `Change-Id: ${id}`, "-1"]).out.trim();
    expect(localTwin).not.toBe("");
    const map = join(git(fx().workingClone, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).out.trim(), "fork-adoption-map");
    expect(readFileSync(map, "utf8")).toContain(upSha);
    expect(readFileSync(map, "utf8")).toContain(localTwin);
    const r2 = runScript(["--replay", "--yes"]);
    expect(r2.status).toBe(0);
    expect(r2.out).toContain("Nothing to apply from upstream");
  });

  it("non-TTY --replay without --yes fails closed before applying", () => {
    setupSyncFixture();
    scenarioPreChangeIdBacklog(fx(), 1);
    commitIn(fx().ghClone, "up.txt", "upstream work", "feat: upstream work");
    git(fx().ghClone, ["push", "-q", "origin", "master"]);
    const beforeTip = git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim();
    const r = runScript(["--replay"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("non-TTY --replay requires --yes");
    expect(git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim()).toBe(beforeTip);
  });
});
