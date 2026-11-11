// Port of tools/tests/scripts/test_wip_gate.bats (6 tests).
// The WIP-commit gate (tools/git-hooks/wip-gate.sh): only a WIP commit may
// follow a WIP commit. Exercises the gate logic itself plus the delegation
// mechanics (a husky-style local hooksPath with the exact block shape the
// templates ship).
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const GATE = join(TOOLS, "git-hooks", "wip-gate.sh");

let TMP = "";
let WORKSPACE = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  // The hook block delegates through DEVENV_TOOLS; the hermetic env no longer
  // inherits it, so name the checkout's tools dir explicitly.
  DEVENV_TOOLS: TOOLS,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.test",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.test",
});


// The delegation block exactly as the template repos ship it.
const GATE_BLOCK = [
  "# >>> devenv wip-gate >>>",
  "# devenv WIP gate — enforces: only a WIP commit may follow a WIP commit.",
  "# Run 'git-unwip' to clear WIP state before real commits.",
  'if [ -n "${DEVENV_TOOLS:-}" ] && [ -f "$DEVENV_TOOLS/git-hooks/wip-gate.sh" ]; then',
  '    bash "$DEVENV_TOOLS/git-hooks/wip-gate.sh"',
  'elif tools_dir=$(git config --global devenv.toolsDir 2>/dev/null) && [ -f "$tools_dir/git-hooks/wip-gate.sh" ]; then',
  '    bash "$tools_dir/git-hooks/wip-gate.sh"',
  "fi",
  "# <<< devenv wip-gate <<<",
  "",
].join("\n");

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `wipgate-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
  WORKSPACE = join(TMP, "workspace");
  mkdirSync(join(WORKSPACE, "repos", "alpha"), { recursive: true });
  mkdirSync(join(WORKSPACE, "repos", "beta"), { recursive: true });
  for (const repo of ["alpha", "beta"]) {
    const dir = join(WORKSPACE, "repos", repo);
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: GIT_ENV() });
    spawnSync("git", ["config", "user.email", "t@t.test"], { cwd: dir, env: GIT_ENV() });
    spawnSync("git", ["config", "user.name", "t"], { cwd: dir, env: GIT_ENV() });
    mkdirSync(join(dir, ".husky"), { recursive: true });
    writeFileSync(join(dir, ".husky", "pre-commit"), GATE_BLOCK + "# repo-local checks follow\n");
    writeFileSync(join(dir, "f"), "a\n");
    spawnSync("git", ["add", "f"], { cwd: dir, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "base"], { cwd: dir, env: GIT_ENV() });
  }
  // beta additionally gets the husky _ dispatcher (faithful husky chain)
  mkdirSync(join(WORKSPACE, "repos", "beta", ".husky", "_"), { recursive: true });
  writeFileSync(
    join(WORKSPACE, "repos", "beta", ".husky", "_", "pre-commit"),
    [
      "#!/usr/bin/env sh",
      'n=$(basename "$0")',
      's=$(dirname "$(dirname "$0")")/$n',
      '[ ! -f "$s" ] && exit 0',
      'sh -e "$s" "$@"',
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(WORKSPACE, "repos", "beta", ".husky", "_", "pre-commit")]);
  spawnSync("git", ["config", "core.hooksPath", ".husky/_"], { cwd: join(WORKSPACE, "repos", "beta"), env: GIT_ENV() });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("scripts/wip-gate", () => {
  it("gate through husky delegation: blocks normal commit on WIP HEAD", () => {
    const repo = join(WORKSPACE, "repos", "beta");
    writeFileSync(join(repo, "f"), "b\n");
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "WIP: state"], { cwd: repo, env: GIT_ENV() });
    writeFileSync(join(repo, "f"), "c\n");
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    const r = spawnSync("git", ["commit", "-m", "feat: should be blocked"], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("git-unwip");
  });

  it("gate through husky delegation: WIP commit on WIP HEAD still allowed", () => {
    const repo = join(WORKSPACE, "repos", "beta");
    writeFileSync(join(repo, "f"), "b\n");
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "WIP: first"], { cwd: repo, env: GIT_ENV() });
    writeFileSync(join(repo, "f"), "c\n");
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    const r = spawnSync("git", ["commit", "-q", "-m", "WIP: second", "-n"], { cwd: repo, env: GIT_ENV() });
    expect(r.status).toBe(0);
  });

  it("gate through husky delegation: normal commit allowed on clean HEAD", () => {
    const repo = join(WORKSPACE, "repos", "beta");
    writeFileSync(join(repo, "f"), "c\n");
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    const r = spawnSync("git", ["commit", "-q", "-m", "feat: clean"], { cwd: repo, env: GIT_ENV() });
    expect(r.status).toBe(0);
  });

  it("gate script: blocks when HEAD is WIP (direct invocation)", () => {
    const repo = join(WORKSPACE, "repos", "alpha");
    writeFileSync(join(repo, "f"), "b\n");
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "WIP: direct", "-n"], { cwd: repo, env: GIT_ENV() });
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(1);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("git-unwip");
  });

  it("gate script: passes on clean HEAD (direct invocation)", () => {
    const repo = join(WORKSPACE, "repos", "alpha");
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
  });

  it("global thin-caller pre-commit delegates to the shared gate", () => {
    // Run from inside the fixture repo: the hook inspects the CWD's repo, so
    // running it from the devenv checkout would be environment-sensitive.
    const repo = join(WORKSPACE, "repos", "alpha");
    let r = spawnSync("bash", [join(TOOLS, "git-hooks", "pre-commit")], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    writeFileSync(join(repo, "f"), "b\n");
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-m", "WIP: thin", "-n"], { cwd: repo, env: GIT_ENV() });
    r = spawnSync("bash", [join(TOOLS, "git-hooks", "pre-commit")], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(1);
  });

  function commitFile(repo: string, msg: string): void {
    writeFileSync(join(repo, "f"), `${msg}\n`);
    spawnSync("git", ["add", "f"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["commit", "-q", "-n", "-m", msg], { cwd: repo, env: GIT_ENV() });
  }

  it("gate script: blocks a buried WIP on a never-pushed branch (no upstream, no remotes)", () => {
    const repo = join(WORKSPACE, "repos", "alpha");
    commitFile(repo, "WIP: buried");
    commitFile(repo, "feat: on top");
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(1);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("unpushed branch history");
  });

  it("gate script: no-upstream branch ignores a WIP that already lives on a remote", () => {
    const repo = join(WORKSPACE, "repos", "alpha");
    const remote = join(TMP, "remote.git");
    spawnSync("git", ["init", "-q", "--bare", remote], { env: GIT_ENV() });
    spawnSync("git", ["remote", "add", "origin", remote], { cwd: repo, env: GIT_ENV() });
    commitFile(repo, "WIP: already published");
    spawnSync("git", ["push", "-q", "origin", "HEAD:refs/heads/other"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["fetch", "-q", "origin"], { cwd: repo, env: GIT_ENV() });
    // A normal commit directly on a published WIP tip is the HEAD check's job
    // (it blocks); here HEAD is a real commit above it, so only the
    // "unpushed" scan matters and it must see no unpushed WIP.
    commitFile(repo, "feat: on top");
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
  });

  // A PATH shim that runs the real git but fails every `git log` whose
  // arguments match `failOn` (a shell glob over "$*").
  function gitShimFailingLog(failOn: string): string {
    const bin = join(TMP, "shim-bin");
    mkdirSync(bin, { recursive: true });
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const shim = join(bin, "git");
    writeFileSync(shim, `#!/bin/sh\nif [ "$1" = log ]; then\n  case "$*" in\n    ${failOn}) echo "fatal: simulated git log failure" >&2; exit 128 ;;\n  esac\nfi\nexec ${real} "$@"\n`);
    spawnSync("chmod", ["+x", shim]);
    return `${bin}:${process.env.PATH ?? ""}`;
  }

  it("gate script: blocks (fails closed) when the HEAD `git log` fails", () => {
    const repo = join(WORKSPACE, "repos", "alpha");
    const PATH = gitShimFailingLog("*");
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: { ...GIT_ENV(), PATH } });
    expect(r.status).toBe(1);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toMatch(/could not read|cannot read|git log failed/i);
  });

  it("gate script: blocks (fails closed) when the unpushed-range `git log` fails", () => {
    const repo = join(WORKSPACE, "repos", "alpha");
    const PATH = gitShimFailingLog("*--not*");
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: { ...GIT_ENV(), PATH } });
    expect(r.status).toBe(1);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toMatch(/could not read|cannot read|git log failed/i);
  });

  it("gate script: the first commit of a repo (unborn HEAD) still passes", () => {
    const repo = join(TMP, "fresh");
    mkdirSync(repo, { recursive: true });
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env: GIT_ENV() });
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
  });

  it("gate script: a buried WIP is still found when the history is far larger than the pipe buffer", () => {
    const repo = join(WORKSPACE, "repos", "alpha");
    // 3000 commits with ~100 char subjects => far more than the 64K pipe
    // buffer after the match, so an early-exiting reader would SIGPIPE git log.
    const lines: string[] = [];
    const pad = "x".repeat(100);
    const total = 3000;
    for (let i = 0; i < total; i++) {
      const subject = i === total - 2 ? "WIP: buried near the tip" : `chore: filler ${i} ${pad}`;
      lines.push(
        "commit refs/heads/big",
        `committer t <t@t.test> ${1_700_000_000 + i} +0000`,
        `data ${Buffer.byteLength(subject)}`,
        subject,
        "",
      );
    }
    const imp = spawnSync("git", ["fast-import", "--quiet"], { cwd: repo, input: lines.join("\n") + "\n", env: GIT_ENV(), encoding: "utf8" });
    expect(imp.stderr).toBe("");
    expect(imp.status).toBe(0);
    // Give it an upstream so the scan runs on the very path that used to pipe.
    const remote = join(TMP, "remote-big.git");
    spawnSync("git", ["init", "-q", "--bare", remote], { env: GIT_ENV() });
    spawnSync("git", ["remote", "add", "origin", remote], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["push", "-q", "origin", "main"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["fetch", "-q", "origin"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["branch", "-q", "-u", "origin/main", "big"], { cwd: repo, env: GIT_ENV() });
    spawnSync("git", ["checkout", "-q", "big"], { cwd: repo, env: GIT_ENV() });
    const r = spawnSync("bash", [GATE], { cwd: repo, encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(1);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("unpushed branch history");
  });
});
