// Port of tools/tests/devenv/test_run_tests_local.bats (16 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const RUNNER = join(ROOT, "tools/tests/run-devenv-tests.sh");

function sh(script: string, env?: Record<string, string>): { status: number; out: string } {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: env ? { ...process.env, ...env } : undefined });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function runnerContent(): string {
  return readFileSync(RUNNER, "utf8");
}

// The runner executes the vitest lane only (the bats corpus retired with the
// Phase-11 port). A stub `pnpm` on PATH records the runner's invocation
// without executing the suite inside a probe (and without letting any suite
// reach the network).
function runnerCollectedFiles(): { status: number; out: string; vitestInvoked: boolean } {
  const t = mkdtempSync(join(tmpdir(), "runner-probe-"));
  const bin = join(t, "bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "bats");
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "${t}/bats.args"\n`);
  chmodSync(stub, 0o755);
  const pnpmStub = join(bin, "pnpm");
  writeFileSync(pnpmStub, `#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "${t}/pnpm.args"\n`);
  chmodSync(pnpmStub, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` };
  spawnSync("bash", [RUNNER, "--sequential"], { encoding: "utf8", env, stdio: "ignore" });
  let out = "";
  try {
    out = readFileSync(`${t}/bats.args`, "utf8");
  } catch {
    out = ""; // the runner no longer invokes bats at all
  }
  let vitestInvoked = false;
  try {
    vitestInvoked = readFileSync(`${t}/pnpm.args`, "utf8").includes("vitest");
  } catch {
    vitestInvoked = false;
  }
  rmSync(t, { recursive: true, force: true });
  return { status: 0, out, vitestInvoked };
}

describe("run tests local (runner contract)", () => {
  it("run-devenv-tests.sh exists and is executable", () => {
    expect(sh(`test -x '${RUNNER}'`).status).toBe(0);
  });

  it("run-devenv-tests.sh has valid bash syntax", () => {
    expect(spawnSync("bash", ["-n", RUNNER]).status).toBe(0);
  });

  it("run-devenv-tests.sh defines the parallel job constants", () => {
    const c = runnerContent();
    expect(c).toContain("readonly MAX_PARALLEL_JOBS=");
    expect(c).toContain("DEFAULT_PARALLEL_JOBS=");
  });

  it("run-devenv-tests.sh default jobs derive from nproc with fallback", () => {
    expect(runnerContent()).toContain("nproc");
  });

  it("run-devenv-tests.sh validates --jobs arguments", () => {
    const c = runnerContent();
    expect(c).toContain("--jobs)");
    expect(c).toContain("requires a numeric argument");
  });

  it("run-devenv-tests.sh supports --sequential", () => {
    expect(runnerContent()).toContain("--sequential)");
  });

  it("run-devenv-tests.sh caps requested jobs with a warning", () => {
    const c = runnerContent();
    expect(c).toContain("WARNING: Requested");
    expect(c).toContain("parallel_jobs=$MAX_PARALLEL_JOBS");
  });

  it("run-devenv-tests.sh passes worker count to vitest only when parallel", () => {
    const c = runnerContent();
    expect(c).toContain('vitest_args+=(--maxWorkers="$parallel_jobs")');
  });

  it("run-devenv-tests.sh invokes vitest once as the whole gate", () => {
    const c = runnerContent();
    expect(c).not.toContain("bats --verbose-run");
    expect(c).toContain('pnpm exec vitest run "${vitest_args[@]}"');
  });

  it("run-devenv-tests.sh echoes total duration", () => {
    const c = runnerContent();
    expect(c).toContain("start_time=$(date +%s)");
    expect(c).toContain("vitest: $((end_time - vitest_start_time))s");
  });

  it("run-devenv-tests.sh rejects unknown options with exit 1", () => {
    const msg = sh(`bash '${RUNNER}' --bogus-option 2>&1`);
    expect(msg.out).toContain("ERROR: Unknown option");
    const r = sh(`'${RUNNER}' --bogus-option >/dev/null 2>&1`);
    expect(r.status).toBe(1);
  });

  it("run-devenv-tests.sh rejects non-numeric --jobs with exit 1", () => {
    const r = sh(`'${RUNNER}' --jobs abc >/dev/null 2>&1`);
    expect(r.status).toBe(1);
  });

  it("the runner invokes no bats (the corpus retired with the Phase-11 port)", () => {
    const r = runnerCollectedFiles();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("/tests/scripts/");
    expect(r.out).not.toContain("/tests/devenv/");
    expect(r.out).not.toContain("/tests/skills/");
  });

  it("the runner runs the vitest lane as the whole gate", () => {
    const r = runnerCollectedFiles();
    // One command is the whole gate: the runner must invoke vitest itself
    // (not rely on `pnpm test`'s &&-composition), so hooks and CI get the
    // full TS corpus from the runner alone.
    expect(r.vitestInvoked, "runner did not invoke the vitest lane").toBe(true);
  });

  it("the runner never invokes the manual-only live/ suite", () => {
    const r = runnerCollectedFiles();
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("/tests/live/");
  });

  it("the tests README documents the manual-only live/ suite lane", () => {
    const readme = readFileSync(join(ROOT, "tools/tests/README.md"), "utf8");
    expect(readme).toMatch(/manual-only.*live\/|live\/.*manual/i);
  });
});
