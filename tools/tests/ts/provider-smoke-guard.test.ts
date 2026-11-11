// The provider smoke suites exercise a LIVE backend, so they are special-case,
// on-demand suites: never collected and never executed by the regular run.
// This guard pins the three properties that keep it that way.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, matchesGlob, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TESTS_DIR, "..", "..", "..");
const PROVIDERS_DIR = join(REPO_ROOT, "tools", "lib", "providers");

/** Every smoke suite that sits beside a provider adapter (azure/smoke.ts, github/smoke.ts). */
function smokeSuites(): string[] {
  return readdirSync(PROVIDERS_DIR)
    .map((name) => join(PROVIDERS_DIR, name, "smoke.ts"))
    .filter((p) => existsSync(p));
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return testFiles(p);
    return name.endsWith(".ts") ? [p] : [];
  });
}

describe("provider smoke suites stay out of the regular run", () => {
  it("at least the Azure smoke suite exists beside its adapter", () => {
    const suites = smokeSuites().map((p) => relative(REPO_ROOT, p));
    expect(suites).toContain(join("tools", "lib", "providers", "azure", "smoke.ts"));
  });

  it("no vitest include pattern can collect a smoke suite", async () => {
    const config = (await import("../../../vitest.config.ts")).default;
    const include = config.test?.include ?? [];
    expect(include.length).toBeGreaterThan(0);
    // Semantic check: every smoke file under tools/ (whatever its name) must
    // fail to match every include pattern the regular run uses.
    const smokeFiles = [
      ...smokeSuites(),
      ...testFiles(join(REPO_ROOT, "tools")).filter((p) => /(^|[\\/])smoke[^\\/]*\.ts$/.test(p)),
    ].map((p) => relative(REPO_ROOT, p).split("\\").join("/"));
    expect(smokeFiles.length).toBeGreaterThan(0);
    for (const file of new Set(smokeFiles)) {
      for (const pattern of include) {
        expect(matchesGlob(file, pattern), `${file} would be collected by ${pattern}`).toBe(false);
      }
    }
  });

  it("the include patterns would collect a smoke-named test file placed under tests/ts", async () => {
    // Proves the check above is not vacuous: a file moved into the collected
    // tree WOULD match, so the guard fails on that regression.
    const config = (await import("../../../vitest.config.ts")).default;
    const include = config.test?.include ?? [];
    expect(include.some((pattern) => matchesGlob("tools/tests/ts/provider-smoke.test.ts", pattern))).toBe(true);
  });

  it("no regular test references a smoke suite", () => {
    const self = fileURLToPath(import.meta.url);
    const offenders = testFiles(TESTS_DIR)
      .filter((p) => p !== self)
      .filter((p) => /providers[\\/](?:azure|github)[\\/]smoke|["'`]smoke\.ts["'`]/.test(readFileSync(p, "utf8")))
      .map((p) => relative(REPO_ROOT, p));
    expect(offenders).toEqual([]);
  });

  it("the Azure smoke suite refuses to run without an explicit opt-in", () => {
    const r = spawnSync(process.execPath, [join(PROVIDERS_DIR, "azure", "smoke.ts")], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("refuses to run");
  });

  it.each(smokeSuites().map((p) => [relative(REPO_ROOT, p), p] as const))(
    "%s gates on an explicit opt-in variable before touching a backend",
    (_name, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(/refuses to run/);
      expect(source).toMatch(/process\.exit\(2\)/);
    },
  );
});
