// The provider smoke suites exercise a LIVE backend, so they are special-case,
// on-demand suites: never collected and never executed by the regular run.
// This guard pins the properties that keep it that way, for every suite
// (Azure and GitHub): outside the vitest include, never referenced by a
// regular test, refusing to run without an opt-in and without contacting a
// backend, (GitHub) the real-organisation guard and the opted-in path stopping
// at authentication before anything is created, and a scenario registry that
// matches the contract's verb table.
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TESTS_DIR, "..", "..", "..");
const PROVIDERS_DIR = join(REPO_ROOT, "tools", "lib", "providers");

// PATH stubs for the backend CLIs: any invocation leaves a marker file and
// fails loudly, so a suite that reaches for a backend is caught.
let stubDir = "";
const scratch: string[] = [];
const backendHits = (): string => join(stubDir, "hit");

/** A directory of failing CLI stubs; each invocation appends one line to `hit`. */
function makeStubs(): string {
  const dir = mkdtempSync(join(tmpdir(), "smoke-guard-"));
  scratch.push(dir);
  for (const cli of ["gh", "curl", "az", "git"]) {
    const file = join(dir, cli);
    writeFileSync(file, `#!/bin/sh\necho "${cli} $*" >> "${join(dir, "hit")}"\nexit 99\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

/** A fixture DEVENV_ROOT whose devenv.config configures the given organisation
 * (none when `org` is empty). */
function fixtureRoot(org: string): string {
  const dir = mkdtempSync(join(tmpdir(), "smoke-guard-root-"));
  scratch.push(dir);
  if (org !== "") writeFileSync(join(dir, "devenv.config"), `[provider]\nname=github\n\n[organization]\norg=${org}\n`);
  return dir;
}

beforeAll(() => {
  stubDir = makeStubs();
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Run a smoke suite with a minimal environment (no opt-in variables, no
 * inherited credentials) and only the failing CLI stubs on PATH. */
function runSuite(provider: string, args: string[], env: Record<string, string> = {}, stubs = stubDir) {
  return spawnSync(process.execPath, [join(PROVIDERS_DIR, provider, "smoke.ts"), ...args], {
    encoding: "utf8",
    env: { PATH: `${stubs}:/usr/bin:/bin`, HOME: stubs, ...env },
  });
}

/** Every smoke suite that sits beside a provider adapter (azure/smoke.ts, github/smoke.ts). */
function smokeSuites(): string[] {
  return readdirSync(PROVIDERS_DIR)
    .map((name) => join(PROVIDERS_DIR, name, "smoke.ts"))
    .filter((p) => existsSync(p));
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    // lstat, not stat: symlinks are skipped (the machine-managed repo cache
    // holds links whose targets may not exist, which stat would throw on).
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return [];
    if (st.isDirectory()) return testFiles(p);
    return name.endsWith(".ts") ? [p] : [];
  });
}

describe("provider smoke suites stay out of the regular run", () => {
  it("both smoke suites exist beside their adapters", () => {
    const suites = smokeSuites().map((p) => relative(REPO_ROOT, p));
    expect(suites).toContain(join("tools", "lib", "providers", "azure", "smoke.ts"));
    expect(suites).toContain(join("tools", "lib", "providers", "github", "smoke.ts"));
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

  it.each([
    ["azure", "azure"],
    ["github", "github"],
  ])("the %s smoke suite refuses to run without an explicit opt-in and contacts no backend", (_name, dir) => {
    const r = runSuite(dir, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("refuses to run");
    expect(existsSync(backendHits()), "a backend CLI was invoked").toBe(false);
  });

  it("the github smoke suite refuses a partial opt-in, each missing variable named", () => {
    const base = { GITHUB_SMOKE: "write" };
    const noOwner = runSuite("github", [], base);
    expect(noOwner.status).toBe(2);
    expect(noOwner.stderr).toContain("GITHUB_SMOKE_OWNER");
    const noConfirm = runSuite("github", [], { ...base, GITHUB_SMOKE_OWNER: "some-org" });
    expect(noConfirm.status).toBe(2);
    expect(noConfirm.stderr).toContain("GITHUB_SMOKE_CONFIRM=some-org");
    const wrongConfirm = runSuite("github", [], { ...base, GITHUB_SMOKE_OWNER: "some-org", GITHUB_SMOKE_CONFIRM: "other" });
    expect(wrongConfirm.status).toBe(2);
    const readOnlyValue = runSuite("github", [], { GITHUB_SMOKE: "1", GITHUB_SMOKE_OWNER: "some-org", GITHUB_SMOKE_CONFIRM: "some-org" });
    expect(readOnlyValue.status).toBe(2);
    expect(existsSync(backendHits()), "a backend CLI was invoked").toBe(false);
  });

  it("the azure smoke suite refuses an incomplete or unconfirmed opt-in with exit 2 and contacts no backend", () => {
    const target = { AZURE_DEVOPS_ORG: "some-org", AZURE_SMOKE_TEST_PROJECT: "some-project", AZURE_PAT: "not-a-token" };
    const wrongValue = runSuite("azure", [], { AZURE_SMOKE: "yes", ...target });
    expect(wrongValue.status).toBe(2);
    expect(wrongValue.stderr).toContain("refuses to run");
    const noConfirm = runSuite("azure", [], { AZURE_SMOKE: "write", ...target });
    expect(noConfirm.status).toBe(2);
    expect(noConfirm.stderr).toContain("AZURE_SMOKE_CONFIRM=some-project");
    const wrongConfirm = runSuite("azure", [], { AZURE_SMOKE: "write", AZURE_SMOKE_CONFIRM: "other-project", ...target });
    expect(wrongConfirm.status).toBe(2);
    expect(existsSync(backendHits()), "a backend CLI was invoked").toBe(false);
  });

  it("the github smoke suite refuses the real organisation without the explicit variable", () => {
    const root = fixtureRoot("real-org");
    for (const typed of ["real-org", "Real-Org"]) {
      const r = runSuite("github", [], { GITHUB_SMOKE: "write", GITHUB_SMOKE_OWNER: typed, GITHUB_SMOKE_CONFIRM: typed, DEVENV_ROOT: root });
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toContain("configured in devenv.config");
    }
    expect(existsSync(backendHits()), "a backend CLI was invoked").toBe(false);
  });

  it("the github smoke suite refuses when the configured organisation cannot be read", () => {
    const root = fixtureRoot("");
    const r = runSuite("github", [], { GITHUB_SMOKE: "write", GITHUB_SMOKE_OWNER: "some-org", GITHUB_SMOKE_CONFIRM: "some-org", DEVENV_ROOT: root });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("could not be evaluated");
    expect(existsSync(backendHits()), "a backend CLI was invoked").toBe(false);
  });

  it("a fully opted-in github run stops at authentication and issues no create or write call", () => {
    // Own stubs: this run is expected to reach the backend CLI, once.
    const stubs = makeStubs();
    const cases: Array<[string, Record<string, string>]> = [
      ["an organisation other than the configured one", { GITHUB_SMOKE_OWNER: "test-org", GITHUB_SMOKE_CONFIRM: "test-org", DEVENV_ROOT: fixtureRoot("real-org") }],
      ["the real organisation with the explicit variable", { GITHUB_SMOKE_OWNER: "real-org", GITHUB_SMOKE_CONFIRM: "real-org", GITHUB_SMOKE_ALLOW_REAL_ORG: "real-org", DEVENV_ROOT: fixtureRoot("real-org") }],
      ["an unreadable configuration with the explicit variable", { GITHUB_SMOKE_OWNER: "test-org", GITHUB_SMOKE_CONFIRM: "test-org", GITHUB_SMOKE_ALLOW_REAL_ORG: "test-org", DEVENV_ROOT: fixtureRoot("") }],
    ];
    for (const [label, env] of cases) {
      rmSync(join(stubs, "hit"), { force: true });
      const r = runSuite("github", [], { GITHUB_SMOKE: "write", ...env }, stubs);
      expect(r.status, `${label}: ${r.stderr}`).toBe(1);
      expect(r.stderr, label).toContain("gh is not authenticated");
      const hits = readFileSync(join(stubs, "hit"), "utf8").trim().split("\n");
      expect(hits, label).toEqual(["gh auth status"]);
      expect(hits.join("\n"), label).not.toMatch(/-X|POST|create|delete|--method/);
    }
  });

  it("github smoke registry covers every contract verb of the github column, or excludes it with a reason", () => {
    const r = runSuite("github", ["--list-coverage"]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(backendHits()), "a backend CLI was invoked").toBe(false);
    const registry = JSON.parse(r.stdout) as {
      scenarios: Array<{ id: string; verbs: string[] }>;
      excluded: Array<{ verb: string; reason: string }>;
    };
    const rows = contractRows();
    const applicable = new Set(rows.filter((row) => row.github !== "-" && !row.github.startsWith("gap:")).map((row) => row.verb));
    const gaps = new Set(rows.filter((row) => row.github.startsWith("gap:")).map((row) => row.verb));
    const covered = new Set(registry.scenarios.flatMap((s) => s.verbs));
    const excluded = new Set(registry.excluded.map((e) => e.verb));

    expect([...applicable].filter((v) => !covered.has(v) && !excluded.has(v)), "contract verbs neither exercised nor excluded").toEqual([]);
    expect([...covered].filter((v) => !applicable.has(v)), "scenario verbs unknown to the contract's github column").toEqual([]);
    expect([...excluded].filter((v) => covered.has(v)), "verbs both exercised and excluded").toEqual([]);
    expect([...excluded].sort(), "excluded verbs must be exactly the github gaps").toEqual([...gaps].sort());
    for (const e of registry.excluded) expect(e.reason.trim(), `${e.verb} needs a reason`).not.toBe("");
    const ids = registry.scenarios.map((s) => s.id);
    expect(new Set(ids).size, "scenario ids are unique").toBe(ids.length);
  });
});

/** The verb and github cell of every row of the contract's coverage table. */
function contractRows(): Array<{ verb: string; github: string }> {
  const text = readFileSync(join(PROVIDERS_DIR, "CONTRACT.md"), "utf8");
  const open = "<!-- contract:verbs -->";
  const from = text.indexOf(open);
  const to = text.indexOf("<!-- /contract:verbs -->");
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return text
    .slice(from + open.length, to)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("```"))
    .map((l) => {
      const parts = l.split("|").map((p) => p.trim());
      return { verb: parts[0] ?? "", github: parts[2] ?? "" };
    });
}
