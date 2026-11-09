// Port of tools/tests/scripts/test_repo_get_validation.bats (16 tests).
// repo-get input validation, usage surface, and real --all runs against a
// stubbed provider CLI and stubbed git.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");
const SCRIPT = join(TOOLS, "repo-get");
const TS_SOURCE = join(TOOLS, "ts", "repo-get.ts");

let TMP = "";
let DEVENV_ROOT = "";
let STUB_LOG = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `getval-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  DEVENV_ROOT = join(TMP, "devenv-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
  // The helper's sandboxed config: github provider, org test-org.
  writeFileSync(
    join(DEVENV_ROOT, "devenv.config"),
    "[provider]\nname=github\n\n[organization]\nname=Test Organization\norg=test-org\nemail_domain=test.example.com\n\n[workflows]\nstatus_workflow=TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production\n",
  );
});

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function setupRepoGetWorld(): void {
  mkdirSync(join(TMP, "bin"), { recursive: true });
  mkdirSync(join(DEVENV_ROOT, "repos"), { recursive: true });
  STUB_LOG = join(TMP, "calls.log");
  writeFileSync(STUB_LOG, "");
  writeFileSync(
    join(TMP, "bin", "gh"),
    [
      "#!/usr/bin/env bash",
      'echo "gh $*" >> "$STUB_LOG"',
      "case \"$1\" in",
      "  # real gh answers --json with a JSON array: one {name} per line of $STUB_ORG_REPOS",
      "  repo) printf '%b' \"${STUB_ORG_REPOS:-}\" | jq -R -s -c 'split(\"\\n\") | map(select(length > 0)) | map({name: .})' ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(TMP, "bin", "git"),
    [
      "#!/usr/bin/env bash",
      'echo "git $*" >> "$STUB_LOG"',
      'if [ "$1" = clone ]; then',
      '    case "$2" in *"/${STUB_CLONE_FAIL:-@none@}.git"|*"/${STUB_CLONE_FAIL:-@none@}") exit 1 ;; esac',
      '    mkdir -p "$3"',
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  spawnSync("chmod", ["+x", join(TMP, "bin", "gh"), join(TMP, "bin", "git")]);
}

function runRepoGet(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...procEnv,
      DEVENV_ROOT,
      DEVENV_ROOT_SET: "1",
      DEVENV_TOOLS: TOOLS,
      STUB_LOG,
      PATH: `${join(TMP, "bin")}:${procEnv.PATH ?? ""}`,
      ...extraEnv,
    },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scripts/repo-get-validation", () => {
  it("repo-get: has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });

  it("repo-get: carries the git/core library equivalent", () => {
    expect(spawnSync("grep", ["-q", "provider-core.ts", TS_SOURCE]).status).toBe(0);
  });

  it("repo-get: carries the error-handling equivalent", () => {
    expect(spawnSync("grep", ["-q", "core/exit-codes.ts", TS_SOURCE]).status).toBe(0);
  });

  it("repo-get: fails when repository name is missing and no git context", () => {
    // Run from non-git directory
    const r = spawnSync(SCRIPT, [], { cwd: TMP, encoding: "utf8", env: { ...procEnv, DEVENV_ROOT, DEVENV_ROOT_SET: "1", DEVENV_TOOLS: TOOLS } });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage:");
  });

  it("repo-get: rejects invalid characters in repo name", () => {
    let r = runRepoGet(["repo@name"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid repository name");
    r = runRepoGet(["repo name"]);
    expect(r.status).not.toBe(0);
  });

  it("repo-get: rejects reserved names", () => {
    let r = runRepoGet(["repos"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid repository name");
    r = runRepoGet(["."]);
    expect(r.status).not.toBe(0);
  });

  it("repo-get: requires alphanumeric start", () => {
    const r = runRepoGet(["-repo"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Invalid repository name");
  });

  it("repo-get: --all flag is present in usage help", () => {
    expect(spawnSync("grep", ["-q", "-e", "--all", TS_SOURCE]).status).toBe(0);
  });

  it("repo-get: usage mentions --all option", () => {
    const r = spawnSync("grep", ["Usage", TS_SOURCE], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("--all");
  });

  it("repo-get: defines get_available_repos function", () => {
    expect(spawnSync("grep", ["-q", "filterAvailableRepositories", TS_SOURCE]).status).toBe(0);
  });

  it("repo-get: --all mode sets ALL_MODE=true", () => {
    expect(spawnSync("grep", ["-q", "allMode = true", TS_SOURCE]).status).toBe(0);
  });

  // ==========================================================================
  // Real runs of repo-get against a stubbed provider CLI and stubbed git
  // ==========================================================================

  it("repo-get --all exits 0 without cloning when every org repo is already local", () => {
    setupRepoGetWorld();
    mkdirSync(join(DEVENV_ROOT, "repos", "repo-alpha"), { recursive: true });
    mkdirSync(join(DEVENV_ROOT, "repos", "repo-beta"), { recursive: true });
    const r = runRepoGet(["--all"], { STUB_ORG_REPOS: "repo-alpha\nrepo-beta\n" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("already cloned");
    const log = spawnSync("cat", [STUB_LOG], { encoding: "utf8" }).stdout ?? "";
    expect(log.split("\n").some((l) => l.startsWith("git clone"))).toBe(false);
  });

  it("repo-get --all clones exactly the org repos that are not yet local", () => {
    setupRepoGetWorld();
    mkdirSync(join(DEVENV_ROOT, "repos", "repo-beta"), { recursive: true });
    const r = runRepoGet(["--all"], { STUB_ORG_REPOS: "repo-alpha\nrepo-beta\nrepo-gamma\n" });
    expect(r.status).toBe(0);
    expect(spawnSync("test", ["-d", join(DEVENV_ROOT, "repos", "repo-alpha")]).status).toBe(0);
    expect(spawnSync("test", ["-d", join(DEVENV_ROOT, "repos", "repo-gamma")]).status).toBe(0);
    const log = spawnSync("cat", [STUB_LOG], { encoding: "utf8" }).stdout ?? "";
    const clones = log.split("\n").filter((l) => l.startsWith("git clone"));
    expect(clones.length).toBe(2);
    expect(log).toContain("test-org/repo-alpha");
    expect(log).toContain("test-org/repo-gamma");
    expect(clones.some((l) => l.includes("repo-beta"))).toBe(false);
  });

  it("repo-get --all reports a failed clone, exits 1, and still clones the rest", () => {
    setupRepoGetWorld();
    const r = runRepoGet(["--all"], {
      STUB_ORG_REPOS: "repo-alpha\nrepo-gamma\n",
      STUB_CLONE_FAIL: "repo-alpha",
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("Failed to clone repo-alpha");
    expect(spawnSync("test", ["-d", join(DEVENV_ROOT, "repos", "repo-gamma")]).status).toBe(0);
  });

  it("repo-get --all: a failed clone does not go on to configure or fetch anything", () => {
    setupRepoGetWorld();
    const r = runRepoGet(["--all"], {
      STUB_ORG_REPOS: "repo-alpha\n",
      STUB_CLONE_FAIL: "repo-alpha",
    });
    expect(r.status).toBe(1);
    const log = spawnSync("cat", [STUB_LOG], { encoding: "utf8" }).stdout ?? "";
    expect(log.split("\n").some((l) => /^git (config|fetch|remote)/.test(l))).toBe(false);
  });

  it("repo-get strips a trailing slash before validating and updating an existing repo", () => {
    setupRepoGetWorld();
    mkdirSync(join(DEVENV_ROOT, "repos", "my-repo"), { recursive: true });
    const r = runRepoGet(["my-repo/"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Invalid repository name");
    const log = spawnSync("cat", [STUB_LOG], { encoding: "utf8" }).stdout ?? "";
    // The shared git runner scopes runs with a -C <dir> argv prefix; match
    // the fetch wherever it appears in the logged argv.
    expect(log.split("\n").some((l) => /(^| )fetch /.test(l.replace(/^git /, "")))).toBe(true);
  });
});
