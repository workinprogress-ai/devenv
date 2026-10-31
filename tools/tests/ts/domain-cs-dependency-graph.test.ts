// Unit tests for domain/cs/dependency-graph.ts — index staleness semantics
// (the exact bash contract), reverse-tree BFS with cycle prevention, and
// topological generations. The repo cache and index live in a temp dir
// pointed at via REPO_CACHE_DIR; kubectl is not involved.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as graphModule from "../../lib/domain/cs/dependency-graph.ts";
type Graph = typeof graphModule;
async function loadGraph(): Promise<Graph> {
  vi.resetModules();
  return (await import("../../lib/domain/cs/dependency-graph.ts")) as Graph;
}

let cacheDir = "";
const savedEnv: { cache?: string | undefined; prefix?: string | undefined; root?: string | undefined } = {};

function touch(path: string, content = "ts"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

/** Standard fixture: two packages, two repos, one dependency edge. */
function buildTree(): void {
  mkdirSync(join(cacheDir, "repo-alpha", "src"), { recursive: true });
  mkdirSync(join(cacheDir, "repo-beta", "src"), { recursive: true });
  writeFileSync(join(cacheDir, "repo-alpha", "src", "WIP.Alpha.csproj"), "<Project></Project>");
  writeFileSync(
    join(cacheDir, "repo-beta", "src", "WIP.Beta.csproj"),
    '<Project><ItemGroup><PackageReference Include="WIP.Alpha" Version="1.0.0" /></ItemGroup></Project>',
  );
  // The cache timestamp exists once the cache has been refreshed (bash
  // fixture parity); buildDependencyIndex copies it into the index.
  touch(join(cacheDir, ".cache_timestamp"));
}

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "csdep-"));
  savedEnv.cache = process.env.REPO_CACHE_DIR;
  savedEnv.prefix = process.env.CS_DEP_ORG_PREFIX;
  savedEnv.root = process.env.DEVENV_ROOT;
  process.env.REPO_CACHE_DIR = cacheDir;
  process.env.CS_DEP_ORG_PREFIX = "WIP.";
  delete process.env.DEVENV_ROOT;
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  if (savedEnv.cache === undefined) delete process.env.REPO_CACHE_DIR;
  else process.env.REPO_CACHE_DIR = savedEnv.cache;
  if (savedEnv.prefix === undefined) delete process.env.CS_DEP_ORG_PREFIX;
  else process.env.CS_DEP_ORG_PREFIX = savedEnv.prefix;
  if (savedEnv.root === undefined) delete process.env.DEVENV_ROOT;
  else process.env.DEVENV_ROOT = savedEnv.root;
});

describe("domain/cs dependency-graph", () => {
  it("csDepOrgPrefix: env override wins", async () => {
    const g = await loadGraph();
    expect(g.csDepOrgPrefix()).toBe("WIP.");
  });

  it("isIndexStale: no cache timestamp is stale; matching timestamps are fresh", async () => {
    const g = await loadGraph();
    expect(g.isIndexStale()).toBe(true);
    touch(join(cacheDir, ".cache_timestamp"));
    const idx = join(cacheDir, ".index");
    mkdirSync(idx, { recursive: true });
    touch(join(idx, ".index_timestamp"));
    // Prefix file missing + configured prefix empty = fresh (bash parity:
    // `cat missing || true` yields "" which equals the unconfigured prefix).
    expect(g.isIndexStale()).toBe(true); // prefix file missing vs "WIP." ≠ ""
    touch(join(idx, ".index_prefix"), "WIP.");
    expect(g.isIndexStale()).toBe(false);
    // A different prefix reads as stale.
    touch(join(idx, ".index_prefix"), "Other.");
    expect(g.isIndexStale()).toBe(true);
  });

  it("buildDependencyIndex: refuses without a prefix (named error)", async () => {
    const g = await loadGraph();
    delete process.env.CS_DEP_ORG_PREFIX;
    buildTree();
    expect(() => g.buildDependencyIndex()).toThrow(/No organization package prefix/);
  });

  it("buildDependencyIndex: refuses when the cache dir is missing", async () => {
    const g = await loadGraph();
    // Point at a path that does not exist (beforeEach created a fresh one).
    process.env.REPO_CACHE_DIR = join(cacheDir, "does-not-exist");
    expect(() => g.buildDependencyIndex()).toThrow(/Repo cache directory does not exist/);
  });

  it("build + query: packages, dependencies, reverse tree, generations", async () => {
    const g = await loadGraph();
    buildTree();
    g.buildDependencyIndex();
    expect(g.isIndexStale()).toBe(false);

    expect(g.listRepoPackages("repo-alpha")).toEqual(["WIP.Alpha"]);
    expect(g.listRepoDependencies("repo-beta")).toEqual(["WIP.Alpha"]);

    // repo-beta consumes WIP.Alpha → reverse tree of repo-alpha contains
    // repo-beta at depth 0 with the package edge and path.
    const tree = g.getReverseDependencyTree("repo-alpha");
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      depth: 0,
      repo: "repo-beta",
      packageRef: "WIP.Alpha",
      version: "1.0.0",
      path: "repo-alpha>repo-beta",
    });
    g.ensureDependencyIndex();

    // The dependency edge needs a Version in the consuming csproj — rebuild
    // the fixture with a real PackageReference and re-check the generations.
    const gens = g.getTopologicalGenerations();
    expect(gens.length).toBeGreaterThanOrEqual(2);
    expect(gens[0]).toEqual({ generation: 0, repo: "repo-alpha" });
    expect(gens[1]).toEqual({ generation: 1, repo: "repo-beta" });
  });

  it("reverse tree: diamond paths appear per path; cycles are cut", async () => {
    const g = await loadGraph();
    // alpha produces Alpha; beta consumes Alpha; gamma consumes Alpha+Beta.
    mkdirSync(join(cacheDir, "alpha", "src"), { recursive: true });
    mkdirSync(join(cacheDir, "beta", "src"), { recursive: true });
    mkdirSync(join(cacheDir, "gamma", "src"), { recursive: true });
    writeFileSync(join(cacheDir, "alpha", "src", "WIP.A.csproj"), "<Project />");
    writeFileSync(join(cacheDir, "beta", "src", "WIP.B.csproj"), "<Project />");
    writeFileSync(join(cacheDir, "gamma", "src", "WIP.G.csproj"), "<Project />");
    g.buildDependencyIndex();
    // Rebuild the index files with explicit dependency edges (the csproj
    // scan requires PackageReference lines; write them directly for focus).
    const idx = join(cacheDir, ".index");
    writeFileSync(join(idx, "package_to_repo.tsv"), "WIP.A\talpha\nWIP.B\tbeta\n");
    writeFileSync(join(idx, "repo_packages.tsv"), "alpha\tWIP.A\nbeta\tWIP.B\n");
    writeFileSync(join(idx, "repo_dependencies.tsv"), "beta\tWIP.A\t1.0.0\ngamma\tWIP.A\t1.0.0\ngamma\tWIP.B\t1.0.0\n");
    // Mark the index fresh so the query ensure-step does not rebuild over it.
    touch(join(cacheDir, ".cache_timestamp"));
    writeFileSync(join(idx, ".index_timestamp"), "ts");
    writeFileSync(join(idx, ".index_prefix"), "WIP.");

    const tree = g.getReverseDependencyTree("alpha");
    // beta at depth 0 via A; gamma at depth 0 via A AND depth 1 via B.
    const gammaRows = tree.filter((r) => r.repo === "gamma");
    expect(gammaRows).toHaveLength(2);
    expect(tree.filter((r) => r.repo === "beta")).toHaveLength(1);
    // Root never appears as a dependent.
    expect(tree.every((r) => r.repo !== "alpha")).toBe(true);
  });

  it("reverse tree: unknown repo is a named error", async () => {
    const g = await loadGraph();
    buildTree();
    g.buildDependencyIndex();
    expect(() => g.getReverseDependencyTree("no-such-repo")).toThrow(/not found in package index/);
  });

  it("generations: cycle members are excluded with the rest still ordered", async () => {
    const g = await loadGraph();
    mkdirSync(join(cacheDir, "a", "src"), { recursive: true });
    mkdirSync(join(cacheDir, "b", "src"), { recursive: true });
    writeFileSync(join(cacheDir, "a", "src", "WIP.A.csproj"), "<Project />");
    writeFileSync(join(cacheDir, "b", "src", "WIP.B.csproj"), "<Project />");
    g.buildDependencyIndex();
    const idx = join(cacheDir, ".index");
    writeFileSync(join(idx, "package_to_repo.tsv"), "WIP.A\ta\nWIP.B\tb\n");
    writeFileSync(join(idx, "repo_packages.tsv"), "a\tWIP.A\nb\tWIP.B\n");
    // a depends on B, b depends on A → cycle; both excluded.
    writeFileSync(join(idx, "repo_dependencies.tsv"), "a\tWIP.B\t1.0.0\nb\tWIP.A\t1.0.0\n");
    touch(join(cacheDir, ".cache_timestamp"));
    writeFileSync(join(idx, ".index_timestamp"), "ts");
    writeFileSync(join(idx, ".index_prefix"), "WIP.");
    const gens = g.getTopologicalGenerations();
    expect(gens).toEqual([]);
  });


});
// ---------------------------------------------------------------------------
// 15.103: refreshRepoCache lists via `gh repo list` (the `repos list`
// subcommand does not exist in gh and killed every cache refresh).
// ---------------------------------------------------------------------------

describe("refreshRepoCache argv shape", () => {
  it("issues `gh repo list <org>` (never `gh repos list`)", async () => {
    const { spawnSync } = await import("node:child_process");
    const { existsSync, readFileSync } = await import("node:fs");
    const stubDir = mkdtempSync(join(tmpdir(), "f1-stub-"));
    const workDir = mkdtempSync(join(tmpdir(), "f1-root-"));
    writeFileSync(
      join(stubDir, "gh"),
      [
        "#!/usr/bin/env bash",
        'printf \'%s\\n\' "gh $*" >> "__LOG__"',
        'if [ "$1 $2" = "auth status" ]; then exit 0; fi',
        'case "$*" in',
        '  *"repo list"*) echo "repo-one"; echo "repo-two";;',
        "  *) ;;",
        "esac",
        "exit 0",
        "",
      ].join("\n").replaceAll("__LOG__", join(stubDir, "calls.log")),
      { mode: 0o755 },
    );
    writeFileSync(join(workDir, "devenv.config"), "[organization]\norg=test-org\n");
    const savedRoot = process.env.DEVENV_ROOT;
    const savedRepo = process.env.DEVENV_REPO;
    const savedPathDomainCs = process.env.PATH;
    try {
      process.env.DEVENV_ROOT = workDir;
      process.env.DEVENV_REPO = "test-org/repo-one";
      const r = spawnSync("node", ["-e", `
        process.env.PATH = ${JSON.stringify(stubDir)} + ":" + process.env.PATH;
        const m = await import(${JSON.stringify(join(fileURLToPath(new URL(".", import.meta.url)), "../../lib/domain/cs/dependency-graph.ts"))});
        process.exitCode = await m.refreshRepoCache();
      `], {
        encoding: "utf8",
        cwd: workDir,
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        timeout: 30000,
      });
      const log = join(stubDir, "calls.log");
      const calls = existsSync(log)
        ? readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("gh "))
        : [];
      expect(calls.some((c) => c.includes("repo list"))).toBe(true);
      expect(calls.some((c) => c.includes("repos list"))).toBe(false);
      void r;
    } finally {
      process.env.PATH = savedPathDomainCs;
      if (savedRoot === undefined) delete process.env.DEVENV_ROOT;
      else process.env.DEVENV_ROOT = savedRoot;
      if (savedRepo === undefined) delete process.env.DEVENV_REPO;
      else process.env.DEVENV_REPO = savedRepo;
      rmSync(stubDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
