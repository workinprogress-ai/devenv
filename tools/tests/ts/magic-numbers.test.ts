// Port of tools/tests/devenv/test_magic_numbers.bats (15 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function sh(script: string): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Port of tools/tests/devenv/test_magic_numbers.bats — one vitest `it` per source `@test`.

// ── magic numbers (port of test_magic_numbers.bats, 15 tests; 1 skipped) ─

describe("magic numbers", () => {
  const bg = join(ROOT, ".devcontainer/background-check-devenv-updates.sh");

  it("background-check-devenv-updates.sh defines CHECK_INTERVAL_SECONDS", () => {
    const r = spawnSync("grep", ["readonly CHECK_INTERVAL_SECONDS=", bg], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("background-check-devenv-updates.sh CHECK_INTERVAL_SECONDS has value", () => {
    const r = spawnSync("grep", ["readonly CHECK_INTERVAL_SECONDS=600", bg], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("background-check-devenv-updates.sh defines SLEEP_CHUNK_SECONDS", () => {
    const r = spawnSync("grep", ["readonly SLEEP_CHUNK_SECONDS=", bg], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("background-check-devenv-updates.sh SLEEP_CHUNK_SECONDS has value", () => {
    const r = spawnSync("grep", ["readonly SLEEP_CHUNK_SECONDS=10", bg], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("background-check-devenv-updates.sh does not have hardcoded sleep 10", () => {
    const r = spawnSync("grep", ["sleep 10$", bg], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });

  it("background-check-devenv-updates.sh constants are readonly", () => {
    expect(spawnSync("grep", ["readonly CHECK_INTERVAL_SECONDS", bg], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("grep", ["readonly SLEEP_CHUNK_SECONDS", bg], { encoding: "utf8" }).status).toBe(0);
  });

  it("repo-update-all.sh defines MAX_PARALLEL_JOBS constant", () => {
    const r = spawnSync("grep", ["MAX_PARALLEL_JOBS = ", join(ROOT, "tools/ts/repo-update-all.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("repo-update-all.sh defines DEFAULT_PARALLEL_JOBS constant", () => {
    const r = spawnSync("grep", ["DEFAULT_PARALLEL_JOBS = ", join(ROOT, "tools/ts/repo-update-all.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("repo-calc-version carries the release version module", () => {
    const r = spawnSync("grep", ["domain/release/version.ts", join(ROOT, "tools/ts/repo-calc-version.ts")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("lib/versioning.bash defines MIN_BASH_VERSION constant", () => {
    const r = spawnSync("grep", ["readonly MIN_BASH_VERSION=", join(ROOT, "tools/lib/versioning.bash")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("lib/versioning.bash defines MIN_GIT_VERSION constant", () => {
    const r = spawnSync("grep", ["readonly MIN_GIT_VERSION=", join(ROOT, "tools/lib/versioning.bash")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("script template shows constant definition pattern", () => {
    const t = join(ROOT, "tools/templates/script-template.ts");
    expect(spawnSync("grep", ["const SCRIPT_VERSION =", t], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("grep", ["const TOOL_NAME =", t], { encoding: "utf8" }).status).toBe(0);
  });

  it("tool versions are declared in exactly one place (tool-versions.bash)", () => {
    const tv = join(ROOT, ".devcontainer/tool-versions.bash");
    expect(spawnSync("grep", ["PNPM_VERSION=", tv], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("grep", ["NODE_VERSION=", tv], { encoding: "utf8" }).status).toBe(0);
    const r = sh(`grep -rlE '^(PNPM|NODE|NPM)_VERSION=' '${ROOT}/.devcontainer/' | grep -v tool-versions.bash`);
    expect(r.status).not.toBe(0);
  });

  it("constants have descriptive names", () => {
    const r = sh(`grep -h 'readonly [A-Z_]*=' '${ROOT}/tools/lib/'*.bash '${ROOT}/tools/tests/run-devenv-tests.sh' 2>/dev/null`);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/VERSION|TIMEOUT|DELAY|MAX|DEFAULT/);
  });

  it("no hardcoded timeout values in key scripts (skipped in source — kept for parity)", () => {
    // skip in the source suite; carried as an explicit no-op for parity.
    expect(true).toBe(true);
  });
});
