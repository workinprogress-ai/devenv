// Port of tools/tests/scripts/test_fork_setup.bats (7 tests).
// fork-setup: one-time upstream setup. Contract tests over the three-repo
// fork fixture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = toolScript("fork-setup");

let TMP = "";
let DEVENV_ROOT = "";
let UPSTREAM = "";
let ADO_ORIGIN = "";
let WORKING_CLONE = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
  GIT_AUTHOR_NAME: "Test User",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.test",
});

function git(args: string[], cwd = WORKING_CLONE): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

// Three-repo fixture: a bare upstream, a bare ado-origin cloned from it, and
// a working clone of the ado-origin (mirrors create_fork_fixture_trio).
function createForkFixtureTrio(baseDir: string): void {
  mkdirSync(baseDir, { recursive: true });
  UPSTREAM = join(baseDir, "upstream.git");
  ADO_ORIGIN = join(baseDir, "ado-origin.git");
  WORKING_CLONE = join(baseDir, "working-clone");
  const seed = join(baseDir, "_seed");
  spawnSync("git", ["init", "-q", "--bare", "-b", "master", UPSTREAM], { env: GIT_ENV() });
  spawnSync("git", ["clone", "-q", UPSTREAM, seed], { env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: seed, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: seed, env: GIT_ENV() });
  writeFileSync(join(seed, "README.md"), "");
  spawnSync("git", ["add", "README.md"], { cwd: seed, env: GIT_ENV() });
  spawnSync("git", ["commit", "-q", "-m", "Initial commit"], { cwd: seed, env: GIT_ENV() });
  spawnSync("git", ["push", "-q", "origin", "HEAD:master"], { cwd: seed, env: GIT_ENV() });
  rmSync(seed, { recursive: true, force: true });
  spawnSync("git", ["clone", "-q", "--bare", UPSTREAM, ADO_ORIGIN], { env: GIT_ENV() });
  spawnSync("git", ["clone", "-q", ADO_ORIGIN, WORKING_CLONE], { env: GIT_ENV() });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: WORKING_CLONE, env: GIT_ENV() });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: WORKING_CLONE, env: GIT_ENV() });
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `forksetup-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
});

afterEach(() => {
  spawnSync("rm", ["-rf", TMP]);
});

function setupForkFixture(): void {
  createForkFixtureTrio(join(TMP, "fork-fixture"));
  DEVENV_ROOT = join(TMP, "config-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  writeFileSync(join(DEVENV_ROOT, "devenv.config"), `[fork]\nupstream_repo=${UPSTREAM}\nupstream_branch=master\n`);
}

function runForkSetup(args: string[] = [], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd: WORKING_CLONE || TMP,
    encoding: "utf8",
    env: {
      ...GIT_ENV(),
      DEVENV_TOOLS: TOOLS,
      DEVENV_ROOT: DEVENV_ROOT ?? join(TMP, "empty-config"),
      DEVENV_ROOT_SET: "1",
      ...extraEnv,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scripts/fork-setup", () => {
  it("fork-setup: script has valid syntax", () => {
    expect(spawnSync("node", ["--check", SCRIPT]).status).toBe(0);
  });

  it("fork-setup: --help prints usage without implementing logic", () => {
    const r = runForkSetup(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("fork-setup");
    expect(r.out).toContain("fetch-only");
    expect(r.out).toContain("upstream_repo");
    expect(r.out).toContain("upstream_branch");
    expect(r.out).toContain("--dry-run");
  });

  it("fork-setup: requires upstream_repo and upstream_branch in [fork] config", () => {
    DEVENV_ROOT = join(TMP, "config-root");
    mkdirSync(DEVENV_ROOT, { recursive: true });
    WORKING_CLONE = TMP;
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[fork]\nupstream_repo=https://example.invalid/devenv.git\n");
    let r = runForkSetup();
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("upstream_branch");
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[fork]\nupstream_branch=master\n");
    r = runForkSetup();
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("upstream_repo");
  });

  it("fork-setup: adds a fetch-only upstream remote", () => {
    setupForkFixture();
    const r = runForkSetup();
    expect(r.status).toBe(0);
    expect((git(["remote", "get-url", "upstream"]).stdout ?? "").trim()).toBe(UPSTREAM);
    expect((git(["remote", "get-url", "--push", "upstream"]).stdout ?? "").trim()).toBe("/dev/null");
    expect(r.out).toContain("master");
  });

  it("fork-setup: repeated setup is idempotent", () => {
    setupForkFixture();
    let r = runForkSetup();
    expect(r.status).toBe(0);
    const before = (git(["config", "--local", "--list", "--show-origin"]).stdout ?? "")
      .split("\n")
      .sort()
      .join("\n");
    r = runForkSetup();
    expect(r.status).toBe(0);
    expect(r.out).toContain("already configured");
    const after = (git(["config", "--local", "--list", "--show-origin"]).stdout ?? "")
      .split("\n")
      .sort()
      .join("\n");
    expect(after).toBe(before);
  });

  it("fork-setup: refuses to overwrite a conflicting upstream remote", () => {
    setupForkFixture();
    git(["remote", "add", "upstream", ADO_ORIGIN]);
    const r = runForkSetup();
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("already points to a different URL");
    expect((git(["remote", "get-url", "upstream"]).stdout ?? "").trim()).toBe(ADO_ORIGIN);
  });

  it("fork-setup: --dry-run leaves remotes unchanged", () => {
    setupForkFixture();
    const r = runForkSetup(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("dry run");
    expect((git(["remote", "get-url", "upstream"]).stdout ?? "").trim()).toBe("");
  });
});
