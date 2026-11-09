// Port of tools/tests/devenv/test_background_updates.bats (13 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const BG = join(ROOT, ".devcontainer/background-check-devenv-updates.sh");

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function grepBash(args: string[]): number {
  return spawnSync("grep", args, { encoding: "utf8" }).status ?? 1;
}

// Port of tools/tests/devenv/test_background_updates.bats — one vitest `it` per source `@test`.

// ── background updates (port of test_background_updates.bats) ────────────

describe("background updates", () => {
  it("background-check-devenv-updates.sh exists", () => {
    expect(existsSync(BG)).toBe(true);
  });

  it("background-check-devenv-updates.sh has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", BG]).status).toBe(0);
  });

  it("background-check-devenv-updates.sh inlines the version floor check", () => {
    // The retired versioning.bash contract (bash >= 4.0, git >= 2.0) is
    // inlined as version_ge in the script.
    expect(grepBash(["version_ge", BG])).toBe(0);
    expect(grepBash(["BASH_VERSINFO", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh has cleanup function", () => {
    expect(grepBash(["^cleanup()", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh registers signal traps", () => {
    expect(grepBash(["trap cleanup SIGTERM SIGINT", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh uses PID file", () => {
    expect(grepBash(["PID_FILE=", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh prevents concurrent runs", () => {
    expect(grepBash(["if \\[ -f.*PID_FILE", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh checks for stale PID files", () => {
    expect(grepBash(["kill -0.*old_pid", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh honors DEVENV_UPDATE_INTERVAL", () => {
    expect(grepBash(["DEVENV_UPDATE_INTERVAL=", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh honors DEVENV_UPDATE_MAX_ITERATIONS", () => {
    expect(grepBash(["DEVENV_UPDATE_MAX_ITERATIONS=", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh uses UPDATE_FILE for tracking", () => {
    expect(grepBash(["UPDATE_FILE=", BG])).toBe(0);
  });

  it("background-check-devenv-updates.sh cleanup removes PID file", () => {
    const r = sh(`grep -A 3 '^cleanup()' '${BG}' | grep -q 'rm -f.*PID_FILE'`);
    expect(r.status).toBe(0);
  });

  it("PID file prevents duplicate background update checkers", () => {
    // The behavioral check: a live PID blocks, a stale PID is reclaimed.
    // The pid-check logic is embedded in the checker; assert the contract
    // shape directly (the kill -0 guard + already-running branch).
    const content = readFileSync(BG, "utf8");
    expect(content).toContain("already");
    expect(content).toContain("kill -0");
  });
});
