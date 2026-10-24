// domain/cs/dependency-graph.ts — org-package dependency index and graph
// queries (port of cs-dependency-graph.bash). Builds a TSV index over the
// repo cache (package→repo, repo→packages, repo→org-dependencies), answers
// reverse-dependency trees via BFS, and computes global topological
// generations via Kahn's algorithm. configGet* supplies the [nuget]
// package_prefix (the org-package marker); no direct config file reads.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { configGetRaw } from "../../core/config.ts";
import { selfRoot } from "../../core/self-root.ts";
import { logError, logInfo, logWarn } from "../../core/logging.ts";
import { providerOrgGet, ensureProviderAuth, ghApiSync } from "../../providers/provider-core.ts";
import { gitTransportUrl } from "../../providers/github/urls.ts";

/** The repo cache root (repo-cache.bash's location contract). Read at
 * call time: REPO_CACHE_DIR redirects tests and CI at a scratch cache. */
export function repoCacheDir(): string {
  return process.env.REPO_CACHE_DIR ?? join(selfRoot(process.cwd()), "tools", "cache", "repo_cache");
}

/** The dependency-index directory inside the cache (call-time, same reason). */
function indexDir(): string {
  return join(repoCacheDir(), ".index");
}

/** Org-package prefix from devenv.config `[nuget] package_prefix` (or the
 * CS_DEP_ORG_PREFIX override). Empty means "not configured" — the index
 * refuses to build without it (bash parity). */
export function csDepOrgPrefix(): string {
  if (process.env.CS_DEP_ORG_PREFIX !== undefined && process.env.CS_DEP_ORG_PREFIX !== "") {
    return process.env.CS_DEP_ORG_PREFIX;
  }
  const root = process.env.DEVENV_ROOT ?? selfRoot(process.cwd());
  return configGetRaw(join(root, "devenv.config"), "nuget", "package_prefix") ?? "";
}

/** The index is stale when: no cache timestamp, no index timestamp, a
 * different prefix than the current config, or differing timestamps. */
export function isIndexStale(): boolean {
  const cacheTs = join(repoCacheDir(), ".cache_timestamp");
  const indexTs = join(indexDir(), ".index_timestamp");
  if (!existsSync(cacheTs)) return true;
  if (!existsSync(indexTs)) return true;
  // Prefix staleness: bash `cat … || true` reads a missing file as "" and
  // compares against the (possibly also empty) configured prefix — a missing
  // file with an unconfigured prefix is FRESH, not stale.
  const prefixFile = join(indexDir(), ".index_prefix");
  const indexPrefix = existsSync(prefixFile) ? readFileSync(prefixFile, "utf8") : "";
  if (indexPrefix !== csDepOrgPrefix()) return true;
  return readFileSync(cacheTs, "utf8") !== readFileSync(indexTs, "utf8");
}

function csprojFilesUnder(dir: string, srcOnly: boolean): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "bin" || e.name === "obj") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        // src-only scans exclude test/tests subtrees (bash find parity).
        if (srcOnly && (e.name === "test" || e.name === "tests")) continue;
        walk(p);
      } else if (e.name.endsWith(".csproj") && (!srcOnly || p.includes("/src/"))) {
        found.push(p);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** Build the dependency index over the repo cache. Throws (with the bash
 * error wording) when the prefix is unconfigured or the cache is missing. */
export function buildDependencyIndex(): void {
  const prefix = csDepOrgPrefix();
  if (prefix === "") {
    throw new Error(
      'No organization package prefix: set [nuget] package_prefix in devenv.config (for example "Acme."), or CS_DEP_ORG_PREFIX',
    );
  }
  if (!existsSync(repoCacheDir()) || !statSync(repoCacheDir()).isDirectory()) {
    throw new Error(`Repo cache directory does not exist: ${repoCacheDir()}`);
  }
  const idx = indexDir();
  mkdirSync(idx, { recursive: true });

  const pkgToRepo = join(idx, "package_to_repo.tsv");
  const repoPkgs = join(idx, "repo_packages.tsv");
  const repoDeps = join(idx, "repo_dependencies.tsv");

  const pkgToRepoLines: string[] = [];
  const repoPkgsLines: string[] = [];
  const repoDepsLines: string[] = [];
  const knownPackages = new Set<string>();

  // Phase 1: packages produced by each repo (src/ csproj files, org-prefixed).
  for (const e of readdirSync(repoCacheDir(), { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const repoName = e.name;
    for (const csproj of csprojFilesUnder(join(repoCacheDir(), repoName), true)) {
      const pkgName = basename(csproj, ".csproj");
      if (pkgName.startsWith(prefix)) {
        pkgToRepoLines.push(`${pkgName}\t${repoName}`);
        repoPkgsLines.push(`${repoName}\t${pkgName}`);
        knownPackages.add(pkgName);
      }
    }
  }
  if (knownPackages.size === 0) logWarn("No org packages found in cache");

  // Phase 2: org-internal dependencies consumed by each repo.
  const pkgOwner = new Map<string, string>();
  for (const line of pkgToRepoLines) {
    const [pkg, repo] = line.split("\t");
    if (pkg !== undefined && repo !== undefined && !pkgOwner.has(pkg)) pkgOwner.set(pkg, repo);
  }
  for (const e of readdirSync(repoCacheDir(), { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const repoName = e.name;
    for (const csproj of csprojFilesUnder(join(repoCacheDir(), repoName), true)) {
      const content = readFileSync(csproj, "utf8");
      const re = /PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const ref = m[1] as string;
        const ver = m[2] as string;
        if (!ref.startsWith(prefix)) continue;
        // Exclude self-references: exact match on the package column (a
        // substring match would attribute Org.Lib.Core to the repo that
        // makes Org.Lib.Core.Common).
        const owner = pkgOwner.get(ref);
        if (owner !== undefined && owner !== repoName) {
          repoDepsLines.push(`${repoName}\t${ref}\t${ver}`);
        }
      }
    }
  }

  writeFileSync(pkgToRepo, pkgToRepoLines.join("\n") + (pkgToRepoLines.length > 0 ? "\n" : ""));
  writeFileSync(repoPkgs, repoPkgsLines.join("\n") + (repoPkgsLines.length > 0 ? "\n" : ""));
  writeFileSync(repoDeps, repoDepsLines.join("\n") + (repoDepsLines.length > 0 ? "\n" : ""));

  // Index timestamp mirrors the cache timestamp; prefix recorded so a
  // changed prefix reads as stale.
  const cacheTs = join(repoCacheDir(), ".cache_timestamp");
  if (existsSync(cacheTs)) copyFileSync(cacheTs, join(idx, ".index_timestamp"));
  writeFileSync(join(idx, ".index_prefix"), prefix);
}

/** Rebuild the index when stale. */
export function ensureDependencyIndex(): void {
  if (isIndexStale()) buildDependencyIndex();
}

function readTsv(path: string): string[][] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("\t"));
}

export interface ReverseTreeRow {
  depth: number;
  repo: string;
  packageRef: string;
  version: string;
  /** Full chain from the root through intermediaries (">" delimited). */
  path: string;
}

/** Reverse dependency tree for a repo (BFS): every repository that
 * transitively depends on the root, with the package edge and path. The
 * root is excluded; diamond paths appear multiple times; cycles are
 * prevented by not re-entering a repo already on the current path. */
export function getReverseDependencyTree(rootInput: string): ReverseTreeRow[] {
  if (rootInput === "") throw new Error("Repository name or path is required");
  const rootRepo = existsSync(rootInput) && statSync(rootInput).isDirectory() ? basename(rootInput) : rootInput;

  ensureDependencyIndex();
  const pkgToRepo = join(indexDir(), "package_to_repo.tsv");
  const repoPkgs = join(indexDir(), "repo_packages.tsv");
  const repoDeps = join(indexDir(), "repo_dependencies.tsv");
  for (const f of [pkgToRepo, repoPkgs, repoDeps]) {
    if (!existsSync(f)) throw new Error(`Index file not found: ${f}`);
  }

  // repo → space-joined packages it produces; package → consumer@ver pairs.
  const repoToPkgs = new Map<string, string[]>();
  for (const [repo, pkg] of readTsv(repoPkgs)) {
    if (repo === undefined || pkg === undefined) continue;
    const list = repoToPkgs.get(repo) ?? [];
    list.push(pkg);
    repoToPkgs.set(repo, list);
  }
  const pkgToConsumers = new Map<string, string[]>();
  for (const [consumer, pkg, ver] of readTsv(repoDeps)) {
    if (consumer === undefined || pkg === undefined) continue;
    const list = pkgToConsumers.get(pkg) ?? [];
    list.push(`${consumer}@${ver ?? "*"}`);
    pkgToConsumers.set(pkg, list);
  }

  // Verify the root repo is known (literal match — repo names hold regex
  // metacharacters, so a grep would treat the dot as a wildcard).
  if (!repoToPkgs.has(rootRepo)) {
    throw new Error(`Repository '${rootRepo}' not found in package index`);
  }

  const rows: ReverseTreeRow[] = [];
  const seenEntries = new Set<string>();
  const queue: Array<{ depth: number; repo: string; path: string }> = [
    { depth: 0, repo: rootRepo, path: rootRepo },
  ];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head] as { depth: number; repo: string; path: string };
    head += 1;
    const pkgs = repoToPkgs.get(node.repo) ?? [];
    for (const pkg of pkgs) {
      const consumers = pkgToConsumers.get(pkg) ?? [];
      for (const entry of consumers) {
        const at = entry.lastIndexOf("@");
        const consumer = entry.slice(0, at);
        const ver = entry.slice(at + 1);
        if (consumer === "" || seenEntries.has(`${pkg}\t${entry}`)) continue;
        seenEntries.add(`${pkg}\t${entry}`);
        if (consumer === rootRepo) continue;
        // Cycle detection: skip if the consumer is already on this path.
        if (node.path.split(">").includes(consumer)) continue;
        const newPath = `${node.path}>${consumer}`;
        rows.push({ depth: node.depth, repo: consumer, packageRef: pkg, version: ver, path: newPath });
        queue.push({ depth: node.depth + 1, repo: consumer, path: newPath });
      }
    }
  }
  return rows;
}

/** Global topological generations over all cached C# repos (Kahn's
 * algorithm). Generation 0 = repos with no org-internal dependencies;
 * generation N = repos whose org deps are all in generations < N. Repos in
 * a cycle are excluded with a warning (bash parity). */
export function getTopologicalGenerations(): Array<{ generation: number; repo: string }> {
  ensureDependencyIndex();
  const pkgToRepo = join(indexDir(), "package_to_repo.tsv");
  const repoPkgs = join(indexDir(), "repo_packages.tsv");
  const repoDeps = join(indexDir(), "repo_dependencies.tsv");
  for (const f of [pkgToRepo, repoPkgs, repoDeps]) {
    if (!existsSync(f)) throw new Error(`Index file not found: ${f}`);
  }

  // All C# repos present in the cache (≥1 .csproj anywhere).
  const allRepos = new Set<string>();
  for (const e of readdirSync(repoCacheDir(), { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const has = csprojFilesUnder(join(repoCacheDir(), e.name), false).length > 0;
    if (has) allRepos.add(e.name);
  }
  if (allRepos.size === 0) return [];

  const pkgOwner = new Map<string, string>();
  for (const [pkg, repo] of readTsv(pkgToRepo)) {
    if (pkg !== undefined && repo !== undefined && !pkgOwner.has(pkg)) pkgOwner.set(pkg, repo);
  }
  const forwardDeps = new Map<string, Set<string>>();
  const reverseDeps = new Map<string, Set<string>>();
  for (const [consumer, pkg] of readTsv(repoDeps)) {
    if (consumer === undefined || pkg === undefined) continue;
    const upstream = pkgOwner.get(pkg);
    if (upstream === undefined || upstream === consumer) continue;
    if (!allRepos.has(upstream) || !allRepos.has(consumer)) continue;
    const fwd = forwardDeps.get(consumer) ?? new Set<string>();
    fwd.add(upstream);
    forwardDeps.set(consumer, fwd);
    const rev = reverseDeps.get(upstream) ?? new Set<string>();
    rev.add(consumer);
    reverseDeps.set(upstream, rev);
  }

  const inDegree = new Map<string, number>();
  for (const repo of allRepos) inDegree.set(repo, forwardDeps.get(repo)?.size ?? 0);

  let generation = 0;
  let currentGen = [...allRepos].filter((r) => (inDegree.get(r) ?? 0) === 0).sort();
  const out: Array<{ generation: number; repo: string }> = [];
  while (currentGen.length > 0) {
    for (const repo of currentGen) out.push({ generation, repo });
    const nextGen: string[] = [];
    for (const repo of currentGen) {
      for (const downstream of reverseDeps.get(repo) ?? []) {
        const d = (inDegree.get(downstream) ?? 0) - 1;
        inDegree.set(downstream, d);
        if (d === 0) nextGen.push(downstream);
      }
    }
    currentGen = nextGen.sort();
    generation += 1;
  }

  const cycled = [...allRepos].filter((r) => (inDegree.get(r) ?? 0) > 0);
  if (cycled.length > 0) {
    logWarn(`Cycle detected in dependency graph — these repositories were excluded: ${cycled.join(" ")}`);
  }
  return out;
}

/** List packages produced by a repository (repo_packages.tsv lookup). */
export function listRepoPackages(repoName: string): string[] {
  if (repoName === "") throw new Error("Repository name is required");
  ensureDependencyIndex();
  return readTsv(join(indexDir(), "repo_packages.tsv"))
    .filter(([repo]) => repo === repoName)
    .map(([, pkg]) => pkg)
    .filter((p): p is string => p !== undefined);
}

/** List org-internal dependencies consumed by a repository. */
export function listRepoDependencies(repoName: string): string[] {
  if (repoName === "") throw new Error("Repository name is required");
  ensureDependencyIndex();
  return readTsv(join(indexDir(), "repo_dependencies.tsv"))
    .filter(([repo]) => repo === repoName)
    .map(([, pkg]) => pkg)
    .filter((p): p is string => p !== undefined);
}

/** Parallelism for cache clones/updates (repo-cache.bash's env override). */
const REPO_CACHE_PARALLEL = Number(process.env.REPO_CACHE_PARALLEL ?? 5);

/**
 * The cache's repo-refresh (refresh_repo_cache port): clone-or-update every
 * org repo as a shallow single-branch clone, then write the staleness
 * timestamp. Returns 0 ok, 2 partial (some repos failed), 1 total failure.
 */
export function refreshRepoCache(): number {
  const org = providerOrgGet();
  if (org === "") return 1;
  ensureProviderAuth();
  let listed = "";
  try {
    listed = ghApiSync(["repos", "list", org, "--limit", "1000", "--json", "name", "--jq", ".[].name"]).stdout;
  } catch {
    logError("Failed to list organization repositories");
    return 1;
  }
  const repos = listed.split("\n").filter((r) => r !== "");
  if (repos.length === 0) {
    logError(`No repositories found in organization '${org}'`);
    return 1;
  }
  const cache = repoCacheDir();
  mkdirSync(cache, { recursive: true });

  logInfo(`Caching ${repos.length} repositories (${REPO_CACHE_PARALLEL} parallel)...`);
  const failed: string[] = [];
  let index = 0;
  let active = 0;
  const runOne = (repo: string, done: (ok: boolean) => void): void => {
    const repoDir = join(cache, repo);
    let url: string;
    try {
      url = gitTransportUrl(org, repo);
    } catch {
      logError(`Cannot build a clone URL for ${repo}`);
      done(false);
      return;
    }
    const exists = existsSync(join(repoDir, ".git"));
    const args = exists
      ? ["-C", repoDir, "fetch", "--depth", "1", "origin"]
      : ["clone", "--depth", "1", "--single-branch", "--no-tags", url, repoDir];
    const r = spawnSync("git", args, { stdio: "ignore" });
    if (r.status !== 0) { done(false); return; }
    if (exists) {
      const reset = spawnSync("git", ["-C", repoDir, "reset", "--hard", "origin/HEAD"], { stdio: "ignore" });
      if (reset.status !== 0) { done(false); return; }
      spawnSync("git", ["-C", repoDir, "clean", "-fd"], { stdio: "ignore" });
      spawnSync("git", ["-C", repoDir, "gc", "--prune=all", "--quiet"], { stdio: "ignore" });
    }
    done(true);
  };
  const launchNext = (): void => {
    while (index < repos.length && active < REPO_CACHE_PARALLEL) {
      const repo = repos[index] as string;
      index++;
      active++;
      logInfo(`${existsSync(join(cache, repo, ".git")) ? "Updating cached" : "Cloning"} ${repo}...`);
      runOne(repo, (ok) => {
        active--;
        if (!ok) {
          logError(`Failed to cache ${repo}`);
          failed.push(repo);
        }
        launchNext();
      });
    }
  };
  launchNext();
  // Wait for the pool to drain (the async callbacks settle before return on
  // the sync spawn path — spawnSync completes inside runOne before done()).
  if (failed.length === repos.length) {
    logError(`All ${repos.length} repositories failed to cache`);
    return 1;
  }
  writeCacheTimestamp(cache, repos);
  if (failed.length > 0) {
    logWarn(`Failed to cache ${failed.length} of ${repos.length} repositories: ${failed.join(" ")}`);
    return 2;
  }
  return 0;
}

/** The staleness timestamp: ISO date + md5 of the sorted repo list. */
function writeCacheTimestamp(cache: string, repos: string[]): void {
  const repoHash = createHash("md5").update([...repos].sort().join("\n")).digest("hex");
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(join(cache, ".cache_timestamp"), `${now}\n${repoHash}\n`);
}
