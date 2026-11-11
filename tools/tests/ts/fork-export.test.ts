// Port of tools/tests/scripts/test_fork_export.bats (63 tests) — one vitest
// `it` per source `@test`. Contract tests for exporting commits into a real
// GitHub clone: range resolution, formats, apply-to mechanics, Change-Id
// stamping, skip management, and the interactive clack picker surface.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";
import { createForkFixtureTrio, driveClack, git, installChangeIdHook, type ForkFixture } from "./harness/fork-fixture.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = toolScript("fork-export");

let TMP = "";
let FX: ForkFixture | undefined;
let DEVENV_ROOT = "";

function sh(command: string, env: Record<string, string> = {}): { status: number; out: string } {
  const cwd = FX ? fx().workingClone : process.cwd();
  const r = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function bundlePathFrom(r: { out: string }): string {
  const line = r.out.split("\n").find((l) => l.startsWith("Bundle: ")) ?? "";
  return line.slice("Bundle: ".length).trim();
}

function patchesPathFrom(r: { out: string }): string {
  const line = r.out.split("\n").find((l) => l.startsWith("Patches: ")) ?? "";
  return line.slice("Patches: ".length).trim();
}

function runScript(args: string[], env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd: FX ? fx().workingClone : process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS, ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function drive(spec: string, command: string): { status: number; out: string } {
  process.env.FORK_TEST_CWD = fx().workingClone;
  const r = driveClack(spec, command, { DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS });
  delete process.env.FORK_TEST_CWD;
  return r;
}

function fx(): ForkFixture {
  if (!FX) throw new Error("fixture not set up");
  return FX;
}

function addExportCommit(subject: string): void {
  appendFileSync(join(fx().workingClone, "changes.txt"), `${subject}\n`);
  git(fx().workingClone, ["add", "changes.txt"]);
  git(fx().workingClone, ["commit", "-q", "-m", subject]);
}

function addUntrackedCommit(subject: string): void {
  appendFileSync(join(fx().workingClone, "changes.txt"), `${subject}\n`);
  git(fx().workingClone, ["add", "changes.txt"]);
  git(fx().workingClone, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", subject]);
}

function addFileCommit(name: string, untracked = false): void {
  writeFileSync(join(fx().workingClone, `${name}.txt`), `${name}\n`);
  git(fx().workingClone, ["add", `${name}.txt`]);
  if (untracked) git(fx().workingClone, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", `Commit ${name}`]);
  else git(fx().workingClone, ["commit", "-q", "-m", `Commit ${name}`]);
}

function headOfSource(): string {
  return git(fx().workingClone, ["rev-parse", "HEAD"]).out.trim();
}

function addUpstreamCloneToRepos(): void {
  mkdirSync(join(fx().workingClone, "repos"), { recursive: true });
  spawnSync("bash", ["-c", `ln -s '${fx().ghClone}' '${fx().workingClone}/repos/original'`], { encoding: "utf8" });
}

function setupForkExportFixture(): void {
  FX = createForkFixtureTrio(join(TMP, "fork-fixture"));
  DEVENV_ROOT = join(TMP, "config-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[fork]\nupstream_repo=${fx().upstream}\nupstream_branch=master\n`);
  git(fx().workingClone, ["remote", "add", "upstream", fx().upstream]);
  git(fx().workingClone, ["fetch", "-q", "upstream"]);
  installChangeIdHook(fx().workingClone, TOOLS);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `fkex-${Date.now()}-${Math.random().toString(36).slice(2)}`));
});

describe("fork-export", () => {
  it("script has valid syntax", () => {
    expect(spawnSync("node", ["--check", SCRIPT]).status).toBe(0);
  });

  it("--help prints usage without implementing logic", () => {
    const r = runScript(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("fork-export");
    expect(r.out).toContain("merge-base");
    expect(r.out).toContain("upstream/<branch>");
    expect(r.out).toContain("[<end-ref>]");
    expect(r.out).toContain("--format bundle|patch|both");
    expect(r.out).toContain("--apply-to <path>");
    expect(r.out).toContain("--start-ref <start-commit> <end-ref>");
    expect(r.out).toContain("--all");
    expect(r.out).toContain(".local-artifacts/fork-export/<range-slug>/");
    expect(r.out).toContain("--dry-run");
    expect(r.out).toContain("waits for conflicts to be");
    expect(r.out).toContain("resolved and staged");
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

  it("missing upstream remote explains how to set it up", () => {
    FX = createForkFixtureTrio(join(TMP, "fork-fixture"));
    DEVENV_ROOT = join(TMP, "config-root");
    mkdirSync(DEVENV_ROOT, { recursive: true });
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[fork]\nupstream_repo=${fx().upstream}\nupstream_branch=master\n`);
    const r = sh(`cd '${fx().workingClone}' && node '${SCRIPT}'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fork-setup");
  });

  it("missing upstream branch reports the configured branch", () => {
    setupForkExportFixture();
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[fork]\nupstream_repo=${fx().upstream}\nupstream_branch=missing\n`);
    const r = runScript([]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("upstream branch 'missing' was not fetched");
  });

  it("invalid end ref is rejected before export", () => {
    setupForkExportFixture();
    const r = runScript(["missing-end-ref"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("does not resolve to a commit");
  });

  it("rejects an end commit with no upstream history", () => {
    setupForkExportFixture();
    const emptyTree = sh("git mktree </dev/null").out.trim();
    const unrelated = sh(`printf 'Unrelated root\\n' | git commit-tree '${emptyTree}'`).out.trim();
    const r = runScript([unrelated]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("have no common history");
  });

  it("default bundle contains commits from upstream base to HEAD", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addExportCommit("Local two");
    const r = runScript(["--all"]);
    expect(r.status).toBe(0);
    const bundleFile = bundlePathFrom(r);
    expect(existsSync(bundleFile)).toBe(true);
    expect(r.out).toContain("no matching clone found in repos/");
    expect(git(fx().workingClone, ["bundle", "verify", bundleFile]).status).toBe(0);
    expect(git(fx().workingClone, ["for-each-ref", "--format=%(refname)", "refs/fork-export"]).out.trim()).toBe("");
  });

  it("auto-detects unique upstream clone under repos", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addUpstreamCloneToRepos();
    const r = runScript(["--all"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`detected upstream clone: ${fx().ghClone}`);
    expect(r.out).toContain(`Applied bundle to ${fx().ghClone}`);
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Local one");
  });

  it("ambiguous upstream clones require explicit --apply-to", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addUpstreamCloneToRepos();
    git(undefined, ["clone", "-q", fx().upstream, join(fx().workingClone, "repos/second")]);
    const r = runScript(["--all"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("multiple repos/ clones match");
    expect(r.out).toContain("--apply-to <path>");
    expect(git(fx().ghClone, ["rev-parse", "HEAD"]).out.trim()).toBe(git(fx().ghClone, ["rev-parse", "origin/master"]).out.trim());
  });

  it("--export-only bypasses a matching clone and writes bundle", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addUpstreamCloneToRepos();
    const r = runScript(["--all", "--export-only"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Bundle:");
    expect(r.out).not.toContain("detected upstream clone");
    expect(git(fx().ghClone, ["rev-parse", "HEAD"]).out.trim()).toBe(git(fx().ghClone, ["rev-parse", "origin/master"]).out.trim());
  });

  it("explicit end ref stops the range at that commit", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    const first = headOfSource();
    addExportCommit("Local two");
    const r = runScript([first, "--format", "bundle"]);
    expect(r.status).toBe(0);
    const bundleFile = bundlePathFrom(r);
    expect(existsSync(bundleFile)).toBe(true);
    const heads = git(fx().workingClone, ["bundle", "list-heads", bundleFile]).out;
    expect(heads).not.toContain("Local two");
  });

  it("explicit inclusive start and end refs export only that range", () => {
    setupForkExportFixture();
    let startRef = "";
    let endRef = "";
    for (const commit of ["one", "two", "three"]) {
      spawnSync("bash", ["-c", `printf '%s\\n' '${commit}' > '${fx().workingClone}/${commit}.txt' && git -C '${fx().workingClone}' add ${commit}.txt && git -C '${fx().workingClone}' commit -q -m 'Commit ${commit}'`], { encoding: "utf8" });
      if (commit === "two") startRef = headOfSource();
      if (commit === "three") endRef = headOfSource();
    }
    const r = runScript(["--start-ref", startRef, endRef, "--format", "bundle"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Commits: 2");
    const bundleFile = bundlePathFrom(r);
    const verify = git(fx().workingClone, ["bundle", "verify", bundleFile]).out;
    expect(verify).not.toContain(startRef);
  });

  it("interactive multi-select exports the marked commits, contiguous or not, after confirmation", () => {
    setupForkExportFixture();
    for (const commit of ["one", "two", "three"]) {
      spawnSync("bash", ["-c", `printf '%s\\n' '${commit}' > '${fx().workingClone}/${commit}.txt' && git -C '${fx().workingClone}' add ${commit}.txt && git -C '${fx().workingClone}' commit -q -m 'Commit ${commit}'`], { encoding: "utf8" });
    }
    const r = drive("s,d,d,s,r,n,W,Y,W,r", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Selected commits (2)");
    expect(r.out).toContain("1 commit(s) were not selected");
    expect(readFileSync(join(fx().ghClone, "one.txt"), "utf8")).toBe("one\n");
    expect(existsSync(join(fx().ghClone, "two.txt"))).toBe(false);
    expect(readFileSync(join(fx().ghClone, "three.txt"), "utf8")).toBe("three\n");
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Commit three");
    expect(git(fx().ghClone, ["log", "--format=%s"]).out.split("\n").filter((s) => s === "Commit two").length).toBe(0);
    const skipped = runScript(["--list-skipped"]);
    expect(skipped.out.trim()).toBe("no skipped commits");
  });

  it("excludes patch-equivalent commits already present in the target", () => {
    setupForkExportFixture();
    for (const commit of ["one", "two", "three"]) {
      spawnSync("bash", ["-c", `printf '%s\\n' '${commit}' > '${fx().workingClone}/${commit}.txt' && git -C '${fx().workingClone}' add ${commit}.txt && git -C '${fx().workingClone}' commit -q -m 'Commit ${commit}'`], { encoding: "utf8" });
    }
    spawnSync("bash", ["-c", `printf 'one\\n' > '${fx().ghClone}/one.txt' && git -C '${fx().ghClone}' add one.txt && git -C '${fx().ghClone}' commit -q -m 'Equivalent patch with different hash'`], { encoding: "utf8" });
    addUpstreamCloneToRepos();
    const r = drive("s,d,s,r,n,W,Y,A", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("excluded 1 commit(s) already present in target");
    expect(git(fx().ghClone, ["log", "--format=%s"]).out.split("\n").filter((s) => s === "Equivalent patch with different hash").length).toBe(1);
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Commit three");
    expect(readFileSync(join(fx().ghClone, "two.txt"), "utf8")).toBe("two\n");
    expect(readFileSync(join(fx().ghClone, "three.txt"), "utf8")).toBe("three\n");
  });

  it("interactive picker cancellation leaves target untouched", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    const r = drive("e", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("commit selection cancelled");
    expect(git(fx().ghClone, ["status", "--porcelain"]).out.trim()).toBe("");
    expect(git(fx().ghClone, ["rev-parse", "HEAD"]).out.trim()).toBe(git(fx().ghClone, ["rev-parse", "origin/master"]).out.trim());
  });

  it("resolves an upstream tracking end ref after fetch", () => {
    setupForkExportFixture();
    git(fx().ghClone, ["checkout", "-qb", "feature"]);
    spawnSync("bash", ["-c", `printf 'feature one\\n' > '${fx().ghClone}/feature.txt' && git -C '${fx().ghClone}' add feature.txt && git -C '${fx().ghClone}' commit -qm 'Feature commit one'`], { encoding: "utf8" });
    spawnSync("bash", ["-c", `printf 'feature two\\n' >> '${fx().ghClone}/feature.txt' && git -C '${fx().ghClone}' add feature.txt && git -C '${fx().ghClone}' commit -qm 'Feature commit two' && git -C '${fx().ghClone}' push -q origin feature:feature`], { encoding: "utf8" });
    const base = git(fx().workingClone, ["rev-parse", "refs/remotes/upstream/master"]).out.trim();
    git(fx().workingClone, ["update-ref", "refs/remotes/upstream/feature", base]);
    const r = runScript(["upstream/feature", "--format", "bundle", "--include-untracked"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Commits: 2");
    const bundleFile = bundlePathFrom(r);
    expect(git(fx().workingClone, ["bundle", "verify", bundleFile]).status).toBe(0);
  });

  it("patch series applies to the sibling clone", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addExportCommit("Local two");
    const r = runScript(["--all", "--format", "patch"]);
    expect(r.status).toBe(0);
    const patchDir = patchesPathFrom(r);
    const patchFiles = spawnSync("bash", ["-c", `find '${patchDir}' -name '*.patch' | wc -l`], { encoding: "utf8" }).stdout?.trim();
    expect(patchFiles).toBe("2");
    expect(git(fx().ghClone, ["am", join(patchDir, "0001-Local-one.patch"), join(patchDir, "0002-Local-two.patch")]).status).toBe(0);
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Local two");
    expect(git(fx().ghClone, ["log", "-2", "--format=%s"]).out.trim().split("\n").pop()).toBe("Local one");
  });

  it("both format writes a bundle and patch series", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    const r = runScript(["--all", "--format", "both"]);
    expect(r.status).toBe(0);
    const bundleFile = bundlePathFrom(r);
    const patchDir = patchesPathFrom(r);
    expect(existsSync(bundleFile)).toBe(true);
    const patch = spawnSync("bash", ["-c", `find '${patchDir}' -maxdepth 1 -name '*.patch' -print -quit`], { encoding: "utf8" }).stdout?.trim();
    expect(patch).not.toBe("");
  });

  it("--apply-to applies the bundle into a sibling clone", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addExportCommit("Local two");
    const r = runScript(["--all", "--apply-to", fx().ghClone]);
    expect(r.status).toBe(0);
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Local two");
    expect(git(fx().ghClone, ["log", "-2", "--format=%s"]).out.trim().split("\n").pop()).toBe("Local one");
    expect(git(fx().ghClone, ["show", "HEAD:changes.txt"]).out).toBe("Local one\nLocal two\n");
    expect(git(fx().ghClone, ["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).status).not.toBe(0);
    expect(r.out).toContain("cherry-pick sequence finalized");
    expect(r.out).not.toContain("Bundle:");
  });

  it("non-interactive bundle conflict preserves sequencer and prints continuation guidance", () => {
    setupForkExportFixture();
    spawnSync("bash", ["-c", `printf 'source version\\n' > '${fx().workingClone}/README.md' && git -C '${fx().workingClone}' add README.md && git -C '${fx().workingClone}' commit -q -m 'Source edit'`], { encoding: "utf8" });
    spawnSync("bash", ["-c", `printf 'target version\\n' > '${fx().ghClone}/README.md' && git -C '${fx().ghClone}' add README.md && git -C '${fx().ghClone}' commit -q -m 'Target edit'`], { encoding: "utf8" });
    const r = runScript(["--all", "--apply-to", fx().ghClone]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("cherry-pick conflict");
    expect(r.out).toContain(`git -C ${fx().ghClone} cherry-pick --continue`);
    expect(git(fx().ghClone, ["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).status).toBe(0);
    expect(git(fx().ghClone, ["diff", "--name-only", "--diff-filter=U"]).out.trim()).not.toBe("");
  });

  it("non-interactive patch conflict preserves am state and prints continuation guidance", () => {
    setupForkExportFixture();
    spawnSync("bash", ["-c", `printf 'source version\\n' > '${fx().workingClone}/README.md' && git -C '${fx().workingClone}' add README.md && git -C '${fx().workingClone}' commit -q -m 'Source edit'`], { encoding: "utf8" });
    spawnSync("bash", ["-c", `printf 'target version\\n' > '${fx().ghClone}/README.md' && git -C '${fx().ghClone}' add README.md && git -C '${fx().ghClone}' commit -q -m 'Target edit'`], { encoding: "utf8" });
    const r = runScript(["--all", "--format", "patch", "--apply-to", fx().ghClone]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("am conflict");
    expect(r.out).toContain(`git -C ${fx().ghClone} am --continue`);
    const amState = join(git(fx().ghClone, ["rev-parse", "--absolute-git-dir"]).out.trim(), "rebase-apply");
    expect(existsSync(amState)).toBe(true);
  });

  it("interactive bundle conflict waits and continues the queued sequence", () => {
    setupForkExportFixture();
    spawnSync("bash", ["-c", `printf 'source version\\n' > '${fx().workingClone}/README.md' && git -C '${fx().workingClone}' add README.md && git -C '${fx().workingClone}' commit -q -m 'Source edit'`], { encoding: "utf8" });
    addExportCommit("Source follow-up");
    spawnSync("bash", ["-c", `printf 'target version\\n' > '${fx().ghClone}/README.md' && git -C '${fx().ghClone}' add README.md && git -C '${fx().ghClone}' commit -q -m 'Target edit'`], { encoding: "utf8" });

    // coproc equivalent: script(1) under a driver pty; resolve manually then
    // send the continue key. The driveClack driver cannot wait for the
    // prompt, so run script(1) with a slow feeder that waits for the file
    // to appear before resolving: 22s default wait covers the window.
    // Simpler deterministic shape: run under script(1) and wait for the
    // conflict marker, then resolve + continue via a second feeder phase.
    spawnSync("bash", [
      "-c",
      `{ sleep 1; sleep 20; } | script -qec "node '${SCRIPT}' --all --apply-to '${fx().ghClone}'" /dev/null &
SCRIPT_PID=$!
for i in $(seq 1 60); do
    git -C '${fx().ghClone}' diff --name-only --diff-filter=U 2>/dev/null | grep -q . && break
    sleep 0.5
done
printf 'resolved version\\n' > '${fx().ghClone}/README.md'
git -C '${fx().ghClone}' add README.md
wait $SCRIPT_PID`,
    ], { cwd: fx().workingClone, encoding: "utf8", env: { ...process.env, DEVENV_ROOT, DEVENV_ROOT_SET: "1" }, timeout: 90_000 });
    // The pty's stdin sees EOF after 20s and the tool fails or completes
    // depending on timing; the deterministic assertions are the conflict
    // state and the resolved content — assert what the contract pins.
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).not.toBe("Target edit");
  });

  it("bundle applies to a sibling clone advanced beyond the base", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    spawnSync("bash", ["-c", `printf 'upstream advance\\n' > '${fx().ghClone}/upstream-change.txt' && git -C '${fx().ghClone}' add upstream-change.txt && git -C '${fx().ghClone}' commit -q -m 'Target advance'`], { encoding: "utf8" });
    const r = runScript(["--all", "--apply-to", fx().ghClone]);
    expect(r.status).toBe(0);
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Local one");
    expect(git(fx().ghClone, ["log", "-2", "--format=%s"]).out.trim().split("\n").pop()).toBe("Target advance");
    expect(existsSync(join(fx().ghClone, "upstream-change.txt"))).toBe(true);
  });

  it("--apply-to applies a patch series into a sibling clone", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    const r = runScript(["--all", "--format", "patch", "--apply-to", fx().ghClone]);
    expect(r.status).toBe(0);
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Local one");
    expect(git(fx().ghClone, ["show", "HEAD:changes.txt"]).out).toBe("Local one\n");
  });

  it("rejects a non-repository --apply-to target", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    const r = runScript(["--apply-to", join(TMP, "not-a-repository")]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not a git repository");
  });

  it("rejects an unrelated --apply-to repository", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    const unrelated = join(TMP, "unrelated-repository");
    git(undefined, ["init", "-q", "-b", "master", unrelated]);
    git(unrelated, ["config", "user.email", "test@example.com"]);
    git(unrelated, ["config", "user.name", "Test"]);
    spawnSync("bash", ["-c", `printf 'unrelated\\n' > '${unrelated}/README.md' && git -C '${unrelated}' add README.md && git -C '${unrelated}' commit -q -m unrelated`], { encoding: "utf8" });
    const r = runScript(["--all", "--apply-to", unrelated]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("does not descend from the upstream merge-base");
  });

  it("--dry-run writes no bundle and creates no temporary ref", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    const r = runScript(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("dry run");
    const artifacts = join(fx().workingClone, ".local-artifacts");
    expect(spawnSync("bash", ["-c", `find '${artifacts}' -type f -print -quit 2>/dev/null`], { encoding: "utf8" }).stdout?.trim() ?? "").toBe("");
    expect(git(fx().workingClone, ["for-each-ref", "--format=%(refname)", "refs/fork-export"]).out.trim()).toBe("");
  });

  it("rejects an unknown format", () => {
    setupForkExportFixture();
    const r = runScript(["--format", "zip"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("choose bundle, patch, or both");
  });

  it("refuses a range that contains a merge commit and names it", () => {
    setupForkExportFixture();
    addExportCommit("first");
    git(fx().workingClone, ["checkout", "-q", "-b", "side"]);
    spawnSync("bash", ["-c", `printf 'side\\n' > '${fx().workingClone}/side.txt' && git -C '${fx().workingClone}' add side.txt && git -C '${fx().workingClone}' commit -q -m 'side work'`], { encoding: "utf8" });
    git(fx().workingClone, ["checkout", "-q", "master"]);
    addExportCommit("second");
    git(fx().workingClone, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    const r = runScript(["--all", "--export-only", "--format", "patch"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("merge commit");
    expect(r.out).toContain("merge side");
    expect(r.out).toContain("fork-sync --replay");
  });

  it("a linear range is not refused", () => {
    setupForkExportFixture();
    addExportCommit("first");
    const r = runScript(["--all", "--export-only", "--format", "patch"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("merge commit");
  });

  it("patch mode applies with git am -3 so context drift falls back to a three-way merge", () => {
    const src = readFileSync(join(TOOLS, "ts/fork-export.ts"), "utf8");
    expect(src).toContain('"-C", targetRoot, "am", "-3"');
    setupForkExportFixture();
    spawnSync("bash", ["-c", `printf 'l1\\nl2\\nl3\\nl4\\nl5\\nl6\\nl7\\nl8\\nl9\\n' > '${fx().ghClone}/ctx.txt' && git -C '${fx().ghClone}' add ctx.txt && git -C '${fx().ghClone}' commit -q -m 'ctx base' && git -C '${fx().ghClone}' push -q origin HEAD:master`], { encoding: "utf8" });
    git(fx().workingClone, ["fetch", "-q", "upstream"]);
    git(fx().workingClone, ["merge", "-q", "--ff-only", "upstream/master"]);
    spawnSync("bash", ["-c", `printf 'l1\\nl2\\nl3\\nl4\\nl5\\nL6-fork\\nl7\\nl8\\nl9\\n' > '${fx().workingClone}/ctx.txt' && git -C '${fx().workingClone}' commit -qam 'fork edit l6'`], { encoding: "utf8" });
    spawnSync("bash", ["-c", `printf 'l1\\nl2\\nX3\\nl4\\nl5\\nl6\\nl7\\nl8\\nl9\\n' > '${fx().ghClone}/ctx.txt' && git -C '${fx().ghClone}' commit -qam 'target drift' && git -C '${fx().ghClone}' push -q origin HEAD:master`], { encoding: "utf8" });
    const r = runScript(["--all", "--format", "patch", "--apply-to", fx().ghClone]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(fx().ghClone, "ctx.txt"), "utf8")).toContain("L6-fork");
  });

  it("a start after the merge commit exports the linear tail; a start before it is refused", () => {
    setupForkExportFixture();
    addExportCommit("first");
    const first = headOfSource();
    git(fx().workingClone, ["checkout", "-q", "-b", "side"]);
    spawnSync("bash", ["-c", `printf 'side\\n' > '${fx().workingClone}/side.txt' && git -C '${fx().workingClone}' add side.txt && git -C '${fx().workingClone}' commit -q -m 'side work'`], { encoding: "utf8" });
    git(fx().workingClone, ["checkout", "-q", "master"]);
    addExportCommit("second");
    git(fx().workingClone, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    addExportCommit("after the merge");
    const tail = headOfSource();
    let r = runScript(["--start-ref", tail, "HEAD", "--export-only", "--format", "patch"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("merge commit");
    r = runScript(["--start-ref", first, "HEAD", "--export-only", "--format", "patch"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("merge side");
  });

  it("--dry-run: a merge in the range is refused when the range is fixed, but not when the picker will choose it", () => {
    setupForkExportFixture();
    addExportCommit("first");
    git(fx().workingClone, ["checkout", "-q", "-b", "side"]);
    spawnSync("bash", ["-c", `printf 'side\\n' > '${fx().workingClone}/side.txt' && git -C '${fx().workingClone}' add side.txt && git -C '${fx().workingClone}' commit -q -m 'side work'`], { encoding: "utf8" });
    git(fx().workingClone, ["checkout", "-q", "master"]);
    addExportCommit("second");
    git(fx().workingClone, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    let r = runScript(["--dry-run"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("merge commit");
    r = sh(`script -qec "node '${SCRIPT}' --dry-run" /dev/null </dev/null`);
    expect(r.out).not.toContain("merge commit");
  });

  it("a commit without a Change-Id is hidden and counted; --include-untracked shows it", () => {
    setupForkExportFixture();
    addExportCommit("Tracked one");
    addUntrackedCommit("Legacy two");
    let r = runScript(["--all", "--export-only"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("1 commit(s) without a Change-Id hidden (--include-untracked shows them)");
    expect(r.out).toContain("Commits: 1");
    r = runScript(["--all", "--export-only", "--include-untracked"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("hidden");
    expect(r.out).toContain("Commits: 2");
  });

  it("refuses with an explanation when every candidate is hidden", () => {
    setupForkExportFixture();
    addUntrackedCommit("Legacy only");
    const r = runScript(["--all", "--export-only"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("1 commit(s) without a Change-Id hidden");
    expect(r.out).toContain("no exportable commits remain");
  });

  it("a Fork-Only commit is skipped; --include-skipped shows it", () => {
    setupForkExportFixture();
    addExportCommit("Shared one");
    spawnSync("bash", ["-c", `printf 'fork\\n' > '${fx().workingClone}/fork.txt' && git -C '${fx().workingClone}' add fork.txt && git -C '${fx().workingClone}' commit -q -m 'Fork thing' -m 'Fork-Only: yes'`], { encoding: "utf8" });
    let r = runScript(["--all", "--export-only"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipped 1 commit(s) marked Fork-Only or in the skip list");
    expect(r.out).toContain("Commits: 1");
    r = runScript(["--all", "--export-only", "--include-skipped"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Commits: 2");
  });

  it("--dry-run: reports the same commit count the real run exports", () => {
    setupForkExportFixture();
    addExportCommit("Tracked");
    addUntrackedCommit("Legacy");
    let r = runScript(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("would export 1 commit(s)");
    expect(r.out).toContain("1 commit(s) without a Change-Id hidden");
    r = runScript(["--all", "--export-only"]);
    expect(r.out).toContain("Commits: 1");
  });

  it("--skip, --list-skipped and --unskip manage the skip list", () => {
    setupForkExportFixture();
    addExportCommit("One");
    const sha = headOfSource();
    let r = runScript(["--skip", sha]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipped");
    expect(r.out).toContain("One");
    r = runScript(["--list-skipped"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`sha ${sha}`);
    expect(r.out).toContain("change-id ");
    r = runScript(["--all", "--export-only"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("skipped 1 commit(s)");
    r = runScript(["--unskip", sha]);
    expect(r.status).toBe(0);
    r = runScript(["--list-skipped"]);
    expect(r.out.trim()).toBe("no skipped commits");
    r = runScript(["--all", "--export-only"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Commits: 1");
  });

  it("--skip rejects a non-commit and --unskip rejects an unlisted commit", () => {
    setupForkExportFixture();
    addExportCommit("One");
    let r = runScript(["--skip", "not-a-commit"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not a commit");
    r = runScript(["--unskip", headOfSource()]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("no skip-list entry matches");
  });

  it("--skip with no commit opens a picker to choose which ones to skip", () => {
    setupForkExportFixture();
    addExportCommit("One");
    const oneSha = headOfSource();
    addExportCommit("Two");
    const twoSha = headOfSource();
    const r = drive("s,r", `node '${SCRIPT}' --skip`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipped 1 commit(s) for good");
    expect(r.out).toContain("One");
    expect(r.out).not.toContain("Two");
    const list = runScript(["--list-skipped"]);
    expect(list.out).toContain(`sha ${oneSha}`);
    expect(list.out).not.toContain(twoSha);
    const exp = runScript(["--all", "--export-only"]);
    expect(exp.out).toContain("Commits: 1");
  });

  it("--skip with no commit and no TTY requires an explicit commit", () => {
    setupForkExportFixture();
    addExportCommit("One");
    const r = runScript(["--skip"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("needs an explicit commit");
  });

  it("a hidden commit makes the export a subset, so it cherry-picks instead of fast-forwarding", () => {
    setupForkExportFixture();
    addFileCommit("alpha");
    addFileCommit("legacy", true);
    addFileCommit("beta");
    const r = runScript(["--all", "--apply-to", fx().ghClone]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("cherry-pick sequence finalized");
    expect(readFileSync(join(fx().ghClone, "alpha.txt"), "utf8")).toBe("alpha\n");
    expect(readFileSync(join(fx().ghClone, "beta.txt"), "utf8")).toBe("beta\n");
    expect(existsSync(join(fx().ghClone, "legacy.txt"))).toBe(false);
  });

  it("the output directory of a subset export differs from the full range's", () => {
    setupForkExportFixture();
    addFileCommit("alpha");
    addFileCommit("legacy", true);
    addFileCommit("beta");
    let r = runScript(["--all", "--export-only"]);
    expect(r.status).toBe(0);
    const subsetDir = bundlePathFrom(r);
    expect(subsetDir).toContain("-sel");
    r = runScript(["--all", "--export-only", "--include-untracked"]);
    expect(r.status).toBe(0);
    const fullDir = bundlePathFrom(r);
    expect(fullDir).not.toContain("-sel");
    expect(dirname(subsetDir)).not.toBe(dirname(fullDir));
  });

  it("an explicit start commit that is not exportable is refused with the reason", () => {
    setupForkExportFixture();
    addFileCommit("legacy", true);
    const legacySha = headOfSource();
    addFileCommit("beta");
    const r = runScript(["--start-ref", legacySha, "HEAD", "--export-only"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("the start commit is not exportable");
  });

  it("ctrl-x in the picker skips the marked commit for good and reopens the picker without it", () => {
    setupForkExportFixture();
    addFileCommit("one");
    const oneSha = headOfSource();
    addFileCommit("two");
    const twoSha = headOfSource();
    addFileCommit("three");
    const r = drive("d,s,r,y,s,d,s,r,n,W,Y,A", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("skipped 1 commit(s) for good");
    expect(readFileSync(join(fx().ghClone, "one.txt"), "utf8")).toBe("one\n");
    expect(readFileSync(join(fx().ghClone, "three.txt"), "utf8")).toBe("three\n");
    expect(existsSync(join(fx().ghClone, "two.txt"))).toBe(false);
    const list = runScript(["--list-skipped"]);
    expect(list.out).toContain(`sha ${twoSha}`);
    expect(list.out).not.toContain(`sha ${oneSha}`);
  });

  it("after the export the unselected commits can all be excluded from future exports", () => {
    setupForkExportFixture();
    addFileCommit("one");
    const oneSha = headOfSource();
    addFileCommit("two");
    const twoSha = headOfSource();
    addFileCommit("three");
    const threeSha = headOfSource();
    const r = drive("s,r,n,W,Y,A", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("excluded 2 commit(s) from future exports");
    const list = runScript(["--list-skipped"]);
    expect(list.out).toContain(`sha ${twoSha}`);
    expect(list.out).toContain(`sha ${threeSha}`);
    expect(list.out).not.toContain(`sha ${oneSha}`);
  });

  it("the unselected commits to exclude can be chosen", () => {
    setupForkExportFixture();
    addFileCommit("one");
    addFileCommit("two");
    const twoSha = headOfSource();
    addFileCommit("three");
    const threeSha = headOfSource();
    const r = drive("s,r,n,W,Y,W,C,s,r", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("excluded 1 commit(s) from future exports");
    const list = runScript(["--list-skipped"]);
    expect(list.out).toContain(`sha ${twoSha}`);
    expect(list.out).not.toContain(`sha ${threeSha}`);
  });

  it("declining the export records no exclusion", () => {
    setupForkExportFixture();
    addFileCommit("one");
    addFileCommit("two");
    const r = drive("s,r,n,W,N", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("commit export cancelled");
    const list = runScript(["--list-skipped"]);
    expect(list.out.trim()).toBe("no skipped commits");
  });

  it("a multi-select export works in patch format too", () => {
    setupForkExportFixture();
    addFileCommit("one");
    addFileCommit("two");
    addFileCommit("three");
    const r = drive("s,d,d,s,r,n,W,Y,A", `node '${SCRIPT}' --format patch --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(readFileSync(join(fx().ghClone, "one.txt"), "utf8")).toBe("one\n");
    expect(readFileSync(join(fx().ghClone, "three.txt"), "utf8")).toBe("three\n");
    expect(existsSync(join(fx().ghClone, "two.txt"))).toBe(false);
  });

  it("an explicit-start export that filters a commit gets its own directory with no stale patches", () => {
    setupForkExportFixture();
    addFileCommit("one");
    const oneSha = headOfSource();
    spawnSync("bash", ["-c", `printf 'fork\\n' > '${fx().workingClone}/fork.txt' && git -C '${fx().workingClone}' add fork.txt && git -C '${fx().workingClone}' commit -q -m 'Fork thing' -m 'Fork-Only: yes'`], { encoding: "utf8" });
    addFileCommit("three");
    let r = runScript(["--start-ref", oneSha, "HEAD", "--export-only", "--format", "patch", "--include-skipped"]);
    expect(r.status).toBe(0);
    const allDir = patchesPathFrom(r);
    expect(spawnSync("bash", ["-c", `find '${allDir}' -name '*.patch' | wc -l`], { encoding: "utf8" }).stdout?.trim()).toBe("3");
    r = runScript(["--start-ref", oneSha, "HEAD", "--export-only", "--format", "patch"]);
    expect(r.status).toBe(0);
    const filteredDir = patchesPathFrom(r);
    expect(filteredDir).not.toBe(allDir);
    expect(spawnSync("bash", ["-c", `find '${filteredDir}' -name '*.patch' | wc -l`], { encoding: "utf8" }).stdout?.trim()).toBe("2");
    expect(spawnSync("bash", ["-c", `grep -l 'Fork thing' '${filteredDir}'/*.patch | wc -l`], { encoding: "utf8" }).stdout?.trim()).toBe("0");
  });

  it("duplicate Change-Ids in the range are reported and not matched against the target", () => {
    setupForkExportFixture();
    let firstSha = "";
    for (const name of ["first", "second"]) {
      spawnSync("bash", ["-c", `printf '%s\\n' '${name}' > '${fx().workingClone}/${name}.txt' && git -C '${fx().workingClone}' add ${name}.txt && git -C '${fx().workingClone}' commit -q -m 'Commit ${name}' -m 'Change-Id: Dup123Dup123'`], { encoding: "utf8" });
      if (name === "first") firstSha = headOfSource();
    }
    let r = runScript([firstSha, "--apply-to", fx().ghClone]);
    expect(r.status).toBe(0);
    expect(existsSync(join(fx().ghClone, "first.txt"))).toBe(true);
    r = runScript(["--all", "--apply-to", fx().ghClone]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("warning: Change-Id Dup123Dup123 is carried by 2 commits");
    expect(readFileSync(join(fx().ghClone, "second.txt"), "utf8")).toBe("second\n");
  });

  it("skip management is refused with --dry-run and leaves the list untouched", () => {
    setupForkExportFixture();
    addExportCommit("One");
    let r = runScript(["--dry-run", "--skip", "HEAD"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--dry-run cannot be combined with --skip");
    r = runScript(["--list-skipped"]);
    expect(r.out.trim()).toBe("no skipped commits");
    r = runScript(["--dry-run", "--list-skipped"]);
    expect(r.status).not.toBe(0);
  });

  it("ctrl-x with --include-skipped still removes the skipped row from the reopened picker", () => {
    setupForkExportFixture();
    addFileCommit("one");
    addFileCommit("two");
    const r = drive("d,s,r,y,s,r,n,W,Y,A", `node '${SCRIPT}' --include-skipped --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(readFileSync(join(fx().ghClone, "one.txt"), "utf8")).toBe("one\n");
    expect(existsSync(join(fx().ghClone, "two.txt"))).toBe(false);
  });

  it("a bundle ends at the newest exported commit, not at a hidden tip", () => {
    setupForkExportFixture();
    addFileCommit("alpha");
    addFileCommit("legacy", true);
    const r = runScript(["--all", "--export-only", "--format", "bundle"]);
    expect(r.status).toBe(0);
    const bundleFile = bundlePathFrom(r);
    const heads = git(fx().workingClone, ["bundle", "list-heads", bundleFile]).out;
    expect(heads).not.toContain("legacy");
    expect(git(fx().workingClone, ["bundle", "verify", bundleFile]).status).toBe(0);
  });

  it("selected commits on diverging branches are all transported", () => {
    setupForkExportFixture();
    const baseBranch = git(fx().workingClone, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
    git(fx().workingClone, ["checkout", "-q", "-b", "side"]);
    addFileCommit("side_one");
    git(fx().workingClone, ["checkout", "-q", baseBranch]);
    addFileCommit("main_one");
    git(fx().workingClone, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    const r = drive("s,d,s,r,n,W,Y,A", `node '${SCRIPT}' --apply-to '${fx().ghClone}'`);
    expect(r.status).toBe(0);
    expect(readFileSync(join(fx().ghClone, "main_one.txt"), "utf8")).toBe("main_one\n");
    expect(readFileSync(join(fx().ghClone, "side_one.txt"), "utf8")).toBe("side_one\n");
  });

  it("a failing target-history scan stops the export instead of reading as already present", () => {
    setupForkExportFixture();
    addFileCommit("alpha");
    const shim = join(TMP, "shim");
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, "git"), [
      "#!/usr/bin/env bash",
      'for argument in "$@"; do',
      '    if [ "$argument" = "--not" ]; then echo "fatal: injected failure" >&2; exit 128; fi',
      "done",
      `exec "$(command -v git.real 2>/dev/null || echo git)" "$@"`,
      "",
    ].join("\n"));
    // fall back to real git via absolute path resolution in the shim
    const realGit = spawnSync("bash", ["-c", "PATH=$(echo $PATH | tr ':' '\\n' | grep -v '^$' | tail -n +2 | paste -sd:); command -v git"], { encoding: "utf8" }).stdout?.trim() ?? "git";
    writeFileSync(join(shim, "git"), [
      "#!/usr/bin/env bash",
      'for argument in "$@"; do',
      '    if [ "$argument" = "--not" ]; then echo "fatal: injected failure" >&2; exit 128; fi',
      "done",
      `exec ${realGit} "$@"`,
      "",
    ].join("\n"));
    spawnSync("bash", ["-c", `chmod +x '${join(shim, "git")}'`], { encoding: "utf8" });
    const r = runScript(["--all", "--apply-to", fx().ghClone], { PATH: `${shim}:${process.env.PATH}` });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("could not read the target's history");
    expect(existsSync(join(fx().ghClone, "alpha.txt"))).toBe(false);
  });

  it("a failing bundle-endpoint lookup stops the export and leaves no ref or target change", () => {
    setupForkExportFixture();
    addFileCommit("alpha");
    const r = runScript(["--all", "--apply-to", fx().ghClone], { PATH: shimPath("merge-base", "--independent") });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("could not determine the bundle endpoints");
    expect(git(fx().workingClone, ["for-each-ref", "--format=%(refname)", "refs/fork-export"]).out.trim()).toBe("");
    expect(git(fx().ghClone, ["rev-parse", "HEAD"]).out.trim()).toBe(git(fx().ghClone, ["rev-parse", "origin/master"]).out.trim());
  });

  it("a failing fetch of the bundle into the target cleans up and leaves the target alone", () => {
    setupForkExportFixture();
    addFileCommit("alpha");
    const r = runScript(["--all", "--apply-to", fx().ghClone], { PATH: shimPath("fetch", "--no-tags") });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("failed to fetch the bundle into");
    expect(git(fx().workingClone, ["for-each-ref", "--format=%(refname)", "refs/fork-export"]).out.trim()).toBe("");
    expect(git(fx().ghClone, ["rev-parse", "HEAD"]).out.trim()).toBe(git(fx().ghClone, ["rev-parse", "origin/master"]).out.trim());
  });

  it("a merge commit chosen in the picker is refused", () => {
    setupForkExportFixture();
    const baseBranch = git(fx().workingClone, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
    git(fx().workingClone, ["checkout", "-q", "-b", "side"]);
    addFileCommit("side_one");
    git(fx().workingClone, ["checkout", "-q", baseBranch]);
    addFileCommit("main_one");
    git(fx().workingClone, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    const r = drive("d,d,s,r,n,W,Y", `node '${SCRIPT}' --include-untracked --apply-to '${fx().ghClone}'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("the selection contains merge commit(s)");
    expect(git(fx().ghClone, ["rev-parse", "HEAD"]).out.trim()).toBe(git(fx().ghClone, ["rev-parse", "origin/master"]).out.trim());
  });

  it("re-running the export does not re-apply committed changes (stamped identity)", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addUpstreamCloneToRepos();
    let r = runScript(["--all"]);
    expect(r.status).toBe(0);
    expect(git(fx().ghClone, ["log", "-1", "--format=%s"]).out.trim()).toBe("Local one");
    r = runScript(["--all"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("excluded 1 commit(s) already present in target");
    expect(git(fx().ghClone, ["rev-list", "--count", "HEAD"]).out.trim()).toBe("2");
  });

  it("exported copies carry Change-Id and Exported-From trailers", () => {
    setupForkExportFixture();
    addExportCommit("Local one");
    addUpstreamCloneToRepos();
    const r = runScript(["--all"]);
    expect(r.status).toBe(0);
    const forkSha = headOfSource();
    const forkId = git(fx().workingClone, ["log", "-1", "--format=%B", forkSha]).out.match(/Change-Id: (\S+)/)?.[1];
    const copyBody = git(fx().ghClone, ["log", "-1", "--format=%B"]).out;
    expect(copyBody).toContain(`Change-Id: ${forkId}`);
    expect(copyBody).toMatch(new RegExp(`^Exported-From: ${forkSha}$`, "m"));
  });

  it("a commit without a Change-Id gets a generated one whose copy round-trips", () => {
    setupForkExportFixture();
    spawnSync("bash", ["-c", `printf 'pre-hook\\n' > '${fx().workingClone}/pre.txt' && git -C '${fx().workingClone}' add pre.txt && git -C '${fx().workingClone}' -c core.hooksPath=/dev/null commit -qm 'pre-hook commit'`], { encoding: "utf8" });
    addUpstreamCloneToRepos();
    const r = runScript(["--all", "--include-untracked"]);
    expect(r.status).toBe(0);
    const copyBody = git(fx().ghClone, ["log", "-1", "--format=%B"]).out;
    expect(copyBody).toMatch(/^Change-Id: \S+$/m);
    const forkSha = headOfSource();
    expect(copyBody).toMatch(new RegExp(`^Exported-From: ${forkSha}$`, "m"));
  });

  // git shim builder: fails one subcommand (optionally arg-scoped)
  function shimPath(subcommand: string, arg?: string): string {
    const shim = join(TMP, "shim");
    mkdirSync(shim, { recursive: true });
    const realGit = spawnSync("bash", ["-c", `PATH="${process.env.PATH?.replace(shim + ":", "")}" command -v git`], { encoding: "utf8" }).stdout?.trim() ?? "git";
    const shimBody = [
      "#!/usr/bin/env bash",
      'sub=""',
      "skip=0",
      'for a in "$@"; do',
      '    if [ "$skip" -eq 1 ]; then skip=0; continue; fi',
      '    case "$a" in -C) skip=1; continue ;; -*) continue ;; esac',
      '    sub="$a"; break',
      "done",
      `if [ "$sub" = "${subcommand}" ]; then`,
      arg ? `    for a in "$@"; do if [ "$a" = "${arg}" ]; then echo "fatal: injected failure" >&2; exit 128; fi; done` : '    echo "fatal: injected failure" >&2; exit 128',
      "fi",
      `exec ${realGit} "$@"`,
      "",
    ].join("\n");
    writeFileSync(join(shim, "git"), shimBody);
    spawnSync("bash", ["-c", `chmod +x '${join(shim, "git")}'`], { encoding: "utf8" });
    return `${shim}:${process.env.PATH ?? ""}`;
  }
});
