// cs-dependencies-trace over a hand-built cache: the default target (the
// working directory) must resolve to its real directory name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

const TRACE = toolScript("cs-dependencies-trace");
let TMP = "";
let CACHE = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), "cstrace-"));
  CACHE = join(TMP, "cache");
  mkdirSync(join(CACHE, ".index"), { recursive: true });
  mkdirSync(join(CACHE, "repo-alpha", "src"), { recursive: true });
  mkdirSync(join(CACHE, "repo-beta", "src"), { recursive: true });
  writeFileSync(join(CACHE, "repo-alpha", "src", "WIP.Alpha.csproj"), "<Project />");
  writeFileSync(join(CACHE, "repo-beta", "src", "WIP.Beta.csproj"), "<Project />");
  writeFileSync(join(CACHE, ".index", "package_to_repo.tsv"), "WIP.Alpha\trepo-alpha\nWIP.Beta\trepo-beta\n");
  writeFileSync(join(CACHE, ".index", "repo_packages.tsv"), "repo-alpha\tWIP.Alpha\nrepo-beta\tWIP.Beta\n");
  writeFileSync(join(CACHE, ".index", "repo_dependencies.tsv"), "repo-beta\tWIP.Alpha\t1.0.0\n");
  writeFileSync(join(CACHE, ".cache_timestamp"), "ts\n");
  writeFileSync(join(CACHE, ".index", ".index_timestamp"), "ts\n");
  writeFileSync(join(CACHE, ".index", ".index_prefix"), "WIP.");
});

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

const { DEVENV_REPO: _dr, ...procEnv } = process.env;

function trace(args: string[], cwd: string): { status: number; out: string } {
  const r = spawnSync("node", [TRACE, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...procEnv, REPO_CACHE_DIR: CACHE, CS_DEP_ORG_PREFIX: "WIP." },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("cs-dependencies-trace", () => {
  it("traces an explicit directory", () => {
    const r = trace(["--no-refresh", "--by-repo", join(CACHE, "repo-alpha")], TMP);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("0:repo-beta");
  });

  it("the default target is the working directory, named by its real directory name", () => {
    const r = trace(["--no-refresh", "--by-repo"], join(CACHE, "repo-alpha"));
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("0:repo-beta");
  });

  it("a relative '.' target names the working directory too", () => {
    const r = trace(["--no-refresh", "--by-repo", "."], join(CACHE, "repo-alpha"));
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe("0:repo-beta");
  });
});
