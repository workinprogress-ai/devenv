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
});
