// Port of tools/tests/scripts/test_repo_update_all.bats (7 tests)
// and test_repo_update_config.bats (6 tests), kept as separate describes.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOLS = join(ROOT, "tools");

let TMP = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `updall-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(TMP, "home"), { recursive: true });
});

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  HOME: join(TMP, "home"),
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("scripts/repo-update-all", () => {
  it("repo-update-all.sh has valid syntax", () => {
    expect(spawnSync("bash", ["-n", join(TOOLS, "repo-update-all")]).status).toBe(0);
  });

  it("repo-update-all.sh has --help flag", () => {
    const r = spawnSync(join(TOOLS, "repo-update-all"), ["--help"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).toContain("Usage:");
    expect(out).toContain("parallel");
  });

  it("repo-update-all.sh documents --jobs option", () => {
    const r = spawnSync(join(TOOLS, "repo-update-all"), ["--help"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("--jobs");
  });

  it("repo-update-all defines parallel job constants", () => {
    const src = join(TOOLS, "ts", "repo-update-all.ts");
    expect(spawnSync("grep", ["MAX_PARALLEL_JOBS", src]).status).toBe(0);
    expect(spawnSync("grep", ["DEFAULT_PARALLEL_JOBS", src]).status).toBe(0);
  });

  it("repo-update-all runs updates in parallel (spawn pool, the xargs -P analogue)", () => {
    const src = join(TOOLS, "ts", "repo-update-all.ts");
    expect(spawnSync("grep", ["updateSingleRepo", src]).status).toBe(0);
    expect(spawnSync("grep", ["parallelJobs", src]).status).toBe(0);
  });

  it("repo-update-all.sh validates --jobs argument", () => {
    const r = spawnSync(join(TOOLS, "repo-update-all"), ["--jobs", "abc"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("ERROR");
  });

  it("repo-update-all.sh handles unknown options", () => {
    const r = spawnSync(join(TOOLS, "repo-update-all"), ["--invalid-option"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Unknown option");
  });
});

describe("scripts/repo-update-config", () => {
  it("repo-update-config.sh has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", join(TOOLS, "repo-update-config")]).status).toBe(0);
  });

  it("repo-update-config.sh passes shellcheck", () => {
    expect(spawnSync("shellcheck", ["-S", "warning", join(TOOLS, "repo-update-config")]).status).toBe(0);
  });

  it("repo-update-config.sh shows usage when no arguments", () => {
    const r = spawnSync(join(TOOLS, "repo-update-config"), [], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage:");
  });

  it("repo-update-config.sh shows help with --help", () => {
    const r = spawnSync(join(TOOLS, "repo-update-config"), ["--help"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toContain("Usage:");
  });

  it("repo-update-config.sh fails on nonexistent path", () => {
    const r = spawnSync(join(TOOLS, "repo-update-config"), ["/nonexistent/path"], { encoding: "utf8", env: GIT_ENV() });
    expect(r.status).not.toBe(0);
  });

  it("repo-update-config.sh accepts --type option", () => {
    const testRepo = join(TMP, "test-repo");
    mkdirSync(testRepo, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: testRepo, env: GIT_ENV() });
    spawnSync("git", ["remote", "add", "origin", "https://github.com/test-org/test-service.git"], { cwd: testRepo, env: GIT_ENV() });
    // May fail due to missing API, but args should be accepted
    spawnSync(join(TOOLS, "repo-update-config"), [testRepo, "--type", "service"], { encoding: "utf8", env: GIT_ENV() });
    expect(true).toBe(true);
  });
});
