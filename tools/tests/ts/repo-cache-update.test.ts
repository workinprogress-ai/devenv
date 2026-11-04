// Port of tools/tests/scripts/test_repo_cache_update.bats (3 tests).
// repo-cache-update: the dependency index needs an organization package
// prefix ([nuget] package_prefix); a fork without C# packages sets none and
// must not be broken by that.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SCRIPT = join(ROOT, "tools", "repo-cache-update");

let TMP = "";
let REPO_CACHE_DIR = "";
let DEVENV_ROOT = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `cacheupd-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  REPO_CACHE_DIR = join(TMP, "cache");
  mkdirSync(REPO_CACHE_DIR, { recursive: true });
  DEVENV_ROOT = join(TMP, "devenv-root");
  mkdirSync(DEVENV_ROOT, { recursive: true });
});

const { CS_DEP_ORG_PREFIX: _cs, DEVENV_REPO: _dr, ...procEnv } = process.env;

function runUpdate(extraEnv: Record<string, string> = {}, unset: string[] = []): { status: number; out: string; stderr: string } {
  const envVars: Record<string, string> = {
    ...procEnv,
    REPO_CACHE_DIR,
    DEVENV_ROOT,
    DEVENV_ROOT_SET: "1",
    PATH: procEnv.PATH ?? "",
    ...extraEnv,
  };
  for (const key of unset) delete envVars[key];
  const r = spawnSync("bash", [SCRIPT, "--no-refresh"], { encoding: "utf8", env: envVars });
  return { status: r.status ?? 1, out: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("scripts/repo-cache-update", () => {
  it("no package prefix: the index is skipped with a warning naming the key, and the run succeeds", () => {
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[organization]\nname=x\n");
    const r = runUpdate({}, ["CS_DEP_ORG_PREFIX"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("[nuget] package_prefix");
    // stdout is exactly the cache directory; the warning never reaches it
    expect(r.out.trim()).toBe(REPO_CACHE_DIR);
    expect(existsSync(join(REPO_CACHE_DIR, ".index"))).toBe(false);
  });

  it("a configured package prefix: the index is built", () => {
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[nuget]\npackage_prefix=Acme.\n");
    const r = runUpdate({}, ["CS_DEP_ORG_PREFIX"]);
    expect(r.status).toBe(0);
    // logInfo writes to stderr; the bats $output combined both streams.
    expect(r.out + r.stderr).toContain("Building dependency index");
    expect(existsSync(join(REPO_CACHE_DIR, ".index"))).toBe(true);
  });

  it("the CS_DEP_ORG_PREFIX override also enables the index", () => {
    writeFileSync(join(DEVENV_ROOT, "devenv.config"), "[organization]\nname=x\n");
    const r = runUpdate({ CS_DEP_ORG_PREFIX: "Other." });
    expect(r.status).toBe(0);
    expect(r.out + r.stderr).toContain("Building dependency index");
  });
});
