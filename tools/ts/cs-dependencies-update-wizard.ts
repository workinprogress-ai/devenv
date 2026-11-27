// cs-dependencies-update-wizard — interactive multi-repo NuGet dependency
// update wizard: walks the reverse
// dependency tree of a target repo (or every cached C# repo with --global)
// generation by generation, update each dependent repo's NuGet references
// via the single-repo wizard (cs-references-update-wizard), create PRs and
// merge them, wait for pipeline runs between generations (through the
// facade's pipelines verbs), and refresh the repo cache.

import { spawnSync } from "node:child_process";
import { requireCommandOrExit } from "../lib/core/commands.ts";
import { existsSync, readdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";
import {
  getReverseDependencyTree,
  getTopologicalGenerations,
  listRepoPackages,
  refreshRepoCache,
  repoCacheDir,
} from "../lib/domain/cs/dependency-graph.ts";
import { providerOrgGet } from "../lib/providers/provider-core.ts";
import { pipelinesRunList } from "../lib/providers/facade/pipelines.ts";
import { repoSpecFor } from "../lib/providers/facade/urls.ts";
import { mergedRunState, type MergedRunState, type RunRow } from "../lib/domain/cs/merged-run.ts";
import { repoFilter } from "../lib/domain/cs/repo-filter.ts";
import { attemptsMerged, levelWaitPurpose, mergeHandedToUser, mergedTip } from "../lib/domain/cs/merged-commit.ts";
import { csprojPackageReferences } from "../lib/domain/cs/csproj.ts";
import { repoDefaultBranch } from "../lib/domain/cs/default-branch.ts";
import { resolvePostUpdateScript } from "../lib/domain/cs/post-update.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.1.0";
const UPDATE_BRANCH = "auto-update-references";
const SINGLE_REPO_WIZARD = "cs-references-update-wizard";

function showUsage(): never {
  console.log(`Usage: cs-dependencies-update-wizard [OPTIONS] TARGET_DIR
       cs-dependencies-update-wizard [OPTIONS] --global [N]

Interactive wizard that updates C# NuGet dependencies across repositories.

SINGLE-TARGET MODE (default):
  Walks the reverse dependency tree of TARGET_DIR level by level, updating each
  dependent repo's NuGet references, creating PRs, and merging them.

  Arguments:
    TARGET_DIR              Path to the repository whose dependents are updated

GLOBAL MODE (--global):
  Updates ALL cached C# repositories in topological generation order.
  Every repo gets cs-references-update run against it, changes are committed
  to the ${UPDATE_BRANCH} branch, merged, and published. After each
  generation, wait for pipeline runs to complete.

Failure handling:
  If cs-references-update-wizard exits with a non-zero, non-10 code the wizard
  prompts to retry. Answering 'n' aborts the entire wizard because downstream
  repos may depend on the failing repo.

Options:
${usageCommonFlags()}
    --no-refresh            Skip refreshing the repository cache
    --framework TFM         Forwarded to the single-repo wizard
    --lang-version VER      Forwarded to the single-repo wizard
    --lang-default          Forwarded to the single-repo wizard
    --pre-restore SCRIPT    Forwarded to the single-repo wizard: executable run
                            after the TFM rewrite, before the restore gate, in
                            every repo; failure aborts that repo
    --post-update SCRIPT    Forwarded to the single-repo wizard: executable run
                            last in every repo, its edits join that repo's
                            update commit; failure aborts that repo
    --auto                  Process generations without confirmation prompts
    --global [N]            Global mode; optional starting generation N
    --include GLOB          Global mode: process only repos matching GLOB
                            (repeatable; any match includes)
    --exclude GLOB          Global mode: never process repos matching GLOB
                            (repeatable; wins over --include). Filtered repos
                            keep their place in the generation order.

Exit Codes:
    0   Success
    1   General error
    2   Invalid arguments
    3   Directory not found`);
  process.exit(0);
}

// ── Prompt helpers (/dev/tty contract preserved: prompts read the terminal,
// never stdin piped from a caller) ────────────────────────────────────────

function promptUser(message: string): void {
  console.log("");
  console.log(`>>> ${message}`);
  spawnSync("bash", ["-c", 'read -r -p "    Press Enter to continue (or Ctrl+C to abort)... " < /dev/tty'], {
    stdio: "inherit",
  });
  console.log("");
}

function promptRetrySkipAbort(repo: string, offerMerged: boolean): 0 | 1 | 2 | 3 {
  console.log("");
  const merged = offerMerged ? " / [m]erged by hand — await its pipeline run" : "";
  for (;;) {
    process.stdout.write(`>>> ${repo} failed. [r]etry / [s]kip (continue without it)${merged} / [a]bort wizard: `);
    const r = spawnSync("bash", ["-c", 'read -r answer < /dev/tty; printf "%s" "$answer"'], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    });
    const a = (r.stdout ?? "").trim();
    if (/^[Rr]/.test(a)) { console.log(""); return 0; }
    if (/^[Ss]/.test(a)) { console.log(""); return 1; }
    if (/^[Aa]/.test(a)) { console.log(""); return 2; }
    if (offerMerged && /^[Mm]/.test(a)) { console.log(""); return 3; }
    console.log(offerMerged ? "    Please answer r, s, m, or a." : "    Please answer r, s, or a.");
  }
}

function promptGeneration(): "yes" | "skip" | "abort" {
  console.log("");
  for (;;) {
    process.stdout.write(`>>> Process this generation? [y]es / [s]kip / [a]bort: `);
    const r = spawnSync("bash", ["-c", 'read -r answer < /dev/tty; printf "%s" "$answer"'], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    });
    const a = (r.stdout ?? "").trim();
    if (/^[Yy]/.test(a)) { console.log(""); return "yes"; }
    if (/^[Ss]/.test(a)) { console.log(""); return "skip"; }
    if (/^[Aa]/.test(a)) { console.log(""); return "abort"; }
    console.log("    Please answer y, s, or a.");
  }
}

// ── Version helpers ──────────────────────────────────────────────────────

/** Latest published version of a package (artifacts-list --versions, sorted
 * by created_at descending). Empty when the query yields nothing. */
function getLatestVersion(pkgName: string): string {
  const r = spawnSync(
    "bash",
    ["-c", `artifacts-list --type nuget --versions --name "$1" --format json 2>/dev/null | jq -r 'sort_by(.created_at) | reverse | .[0].name // empty'`, "artifacts-list", pkgName],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").trim();
}

/** Version of a package used in a repo's non-test src/ csprojs (empty when
 * absent). */
function getUsedVersion(repoDir: string, pkgName: string): string {
  const walk = (dir: string): string => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return "";
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "test" || e.name === "tests" || e.name === "bin" || e.name === "obj") continue;
        if (!`${p}/`.includes("/src/")) continue;
        const hit = walk(p);
        if (hit !== "") return hit;
      } else if (e.name.endsWith(".csproj")) {
        const ref = csprojPackageReferences(p, repoDir).find((r) => r.name === pkgName && r.version !== "");
        if (ref !== undefined) return ref.version;
      }
    }
    return "";
  };
  return walk(repoDir);
}

/** Wait until a pipeline run has built the merged commit (or a later commit
 * containing it): success passes; a failed or cancelled run fails; no such run
 * before the timeout fails, so a repository whose CI never fires cannot pass
 * on an older run. Query errors are retried. Goes through the facade's
 * pipelines verbs — no direct provider CLI anywhere. */
async function waitForMergedRun(merged: MergedRepo & { sha: string }, branch: string, interval: number, timeout: number): Promise<boolean> {
  const { spec: repo, sha, dir } = merged;
  if (sha === "") {
    logError(`Could not fetch the merged commit of ${repo} (${branch}); its pipeline run cannot be awaited`);
    return false;
  }
  const short = sha.slice(0, 10);
  const isDescendant = descendantCheck(dir, branch, sha);
  let elapsed = 0;
  let queryFailures = 0;
  const maxQueryFailures = 3;
  for (;;) {
    if (elapsed >= timeout) {
      logError(
        `No completed pipeline run for merged commit ${short} on ${repo} (${branch}) after ${timeout}s — ` +
          "if no run started at all, the repository's CI trigger may be missing",
      );
      return false;
    }
    let state: MergedRunState;
    try {
      const out = await pipelinesRunList(repo, { branch, limit: 10, json: "status,conclusion,headSha,workflowName" });
      const parsed = JSON.parse(out) as RunRow[];
      if (!Array.isArray(parsed)) throw new Error("run list returned a non-array payload");
      state = mergedRunState(parsed, sha, isDescendant);
    } catch {
      queryFailures += 1;
      if (queryFailures >= maxQueryFailures) {
        logError(`Could not query pipeline runs on ${repo} (${branch}) after ${queryFailures} attempts`);
        return false;
      }
      logWarn(`could not query pipeline runs on ${repo} (${branch}); retrying (${queryFailures}/${maxQueryFailures})`);
      await sleep(interval * 1000);
      elapsed += interval;
      continue;
    }
    queryFailures = 0;
    if (state.state === "success") return true;
    if (state.state === "failure") {
      logWarn(`Pipeline run for ${state.headSha.slice(0, 10)} on ${repo} (${branch}) concluded: ${state.conclusion}`);
      return false;
    }
    const what = state.state === "pending" ? "in progress" : "not started yet";
    logInfo(`Pipeline run for merged commit ${short} on ${repo} (${branch}) ${what}... [${elapsed}s/${timeout}s]`);
    await sleep(interval * 1000);
    elapsed += interval;
  }
}

/** A repository the wizard merged in this generation: its provider spec and
 * the local clone the merge was made from. */
interface MergedRepo {
  spec: string;
  dir: string;
}

/** Whether a commit contains `mergedSha`, answered from the local clone. A
 * commit the clone has not seen (pushed after the merge) triggers one fetch
 * of the branch; still unknown afterwards means no. */
function descendantCheck(dir: string, branch: string, mergedSha: string): (sha: string) => boolean {
  let fetched = false;
  return (sha: string): boolean => {
    for (;;) {
      const r = spawnSync("git", ["-C", dir, "merge-base", "--is-ancestor", mergedSha, sha], { encoding: "utf8" });
      if (r.status === 0) return true;
      if (r.status === 1 || fetched) return false;
      fetched = true;
      spawnSync("git", ["-C", dir, "fetch", "origin", branch, "--quiet"], { encoding: "utf8" });
    }
  };
}

/** Repo spec of a cached repo in the provider's canonical form (owner/repo on
 * GitHub, project/repo on Azure). Empty when unresolvable. */
async function getFullRepoName(repoDir: string): Promise<string> {
  const name = basename(repoDir);
  const org = providerOrgGet();
  if (org === "") return "";
  try {
    return await repoSpecFor(org, name);
  } catch (err) {
    logError(`Could not resolve the repo spec of ${name}: ${errorMessage(err)}`);
    return "";
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

interface WizardArgs {
  targetDir: string;
  skipRefresh: boolean;
  dryRun: boolean;
  globalMode: boolean;
  globalStartGen: number;
  auto: boolean;
  framework: string;
  langVersion: string;
  langDefault: boolean;
  postUpdate: string;
  preRestore: string;
  includes: string[];
  excludes: string[];
}

function parseArgs_main(): WizardArgs {
  const a: WizardArgs = {
    targetDir: "", skipRefresh: false, dryRun: false, globalMode: false,
    globalStartGen: 0, auto: false, framework: "", langVersion: "", langDefault: false, postUpdate: "", preRestore: "",
    includes: [], excludes: [],
  };
  try {
    const cli = toolCli({
      name: "cs-dependencies-update-wizard",
      version: SCRIPT_VERSION,
      argv: process.argv.slice(2),
      options: {
        "no-refresh": { type: "boolean", default: false },
        framework: { type: "string" },
        "lang-version": { type: "string" },
        "lang-default": { type: "boolean", default: false },
        "post-update": { type: "string" },
        "pre-restore": { type: "string" },
        auto: { type: "boolean", default: false },
        "auto-generations": { type: "boolean", default: false },
        include: { type: "string", multiple: true },
        exclude: { type: "string", multiple: true },
        global: { type: "boolean", default: false },
      },
    });
    if (cli.common.help) showUsage();
    a.skipRefresh = cli.values["no-refresh"] === true;
    a.framework = (cli.values["framework"] as string | undefined) ?? "";
    a.langVersion = (cli.values["lang-version"] as string | undefined) ?? "";
    a.langDefault = cli.values["lang-default"] === true;
    a.postUpdate = (cli.values["post-update"] as string | undefined) ?? "";
    a.preRestore = (cli.values["pre-restore"] as string | undefined) ?? "";
    a.dryRun = cli.common.dryRun;
    a.auto = cli.values["auto"] === true || cli.values["auto-generations"] === true;
    a.includes = (cli.values["include"] as string[] | undefined) ?? [];
    a.excludes = (cli.values["exclude"] as string[] | undefined) ?? [];
    a.globalMode = cli.values["global"] === true;
    // --global [N]: the optional generation number arrives as a bare
    // positional (parseArgs has no optional-value flags); numeric
    // positionals belong to --global, any other is TARGET_DIR.
    const positionals = cli.positionals;
    if (a.globalMode && positionals.length > 0 && /^[0-9]+$/.test(positionals[0] ?? "")) {
      a.globalStartGen = Number(positionals[0]);
      positionals.shift();
    }
    if (positionals.length > 1) {
      logError("Too many arguments. Use --help for usage information.");
      process.exit(EXIT_MISUSE);
    }
    a.targetDir = positionals[0] ?? "";
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  if (a.postUpdate !== "") {
    // Resolved once, here: the wizard visits many repos from other directories.
    const resolved = resolvePostUpdateScript(a.postUpdate);
    if (!resolved.ok) {
      logError(resolved.message);
      process.exit(resolved.reason === "missing" ? EXIT_CONFLICT : EXIT_MISUSE);
    }
    a.postUpdate = resolved.path;
  }
  if (a.preRestore !== "") {
    const resolved = resolvePostUpdateScript(a.preRestore, "--pre-restore");
    if (!resolved.ok) {
      logError(resolved.message);
      process.exit(resolved.reason === "missing" ? EXIT_CONFLICT : EXIT_MISUSE);
    }
    a.preRestore = resolved.path;
  }
  if (a.globalMode && a.targetDir !== "") {
    logError("--global and TARGET_DIR are mutually exclusive. Use --help for usage information.");
    process.exit(EXIT_MISUSE);
  }
  if (!a.globalMode && (a.includes.length > 0 || a.excludes.length > 0)) {
    logError("--include and --exclude apply to --global mode only. Use --help for usage information.");
    process.exit(EXIT_MISUSE);
  }
  return a;
}

function hasSln(dir: string): boolean {
  try {
    for (const e of readdirSync(dir)) if (e.endsWith(".sln") || e.endsWith(".slnx")) return true;
    return false;
  } catch {
    return false;
  }
}

function countNonTestCsproj(dir: string): number {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "test" || e.name === "tests" || e.name === "bin" || e.name === "obj") continue;
      count += countNonTestCsproj(p);
    } else if (e.name.endsWith(".csproj")) count += 1;
  }
  return count;
}

function runSingleRepoWizard(args: WizardArgs, repoDir: string): number {
  const wizardArgs = ["--branch", UPDATE_BRANCH];
  if (args.framework !== "") wizardArgs.push("--framework", args.framework);
  if (args.langVersion !== "") wizardArgs.push("--lang-version", args.langVersion);
  if (args.langDefault) wizardArgs.push("--lang-default");
  if (args.preRestore !== "") wizardArgs.push("--pre-restore", args.preRestore);
  if (args.postUpdate !== "") wizardArgs.push("--post-update", args.postUpdate);
  wizardArgs.push(repoDir);
  const inv = siblingInvocation(SINGLE_REPO_WIZARD, wizardArgs);
  const r = spawnSync(inv.command, inv.args, { stdio: "inherit" });
  return r.status ?? 1;
}

async function main(): Promise<void> {
  // Arguments first: --help, --version and a misused flag must not need the
  // external tools the run itself uses.
  const args = parseArgs_main();
  requireCommandOrExit("git", undefined, EXIT_GENERAL_ERROR);
  requireCommandOrExit("jq", undefined, EXIT_GENERAL_ERROR);
  requireCommandOrExit("dotnet", undefined, EXIT_GENERAL_ERROR);
  requireCommandOrExit("dotnet-outdated", undefined, EXIT_GENERAL_ERROR);
  let rootRepo = "";

  // Single-target mode: validate TARGET_DIR.
  if (!args.globalMode) {
    let targetDir = args.targetDir === "" ? "." : args.targetDir;
    if (!existsSync(targetDir)) {
      logError(`Directory not found: ${targetDir}`);
      process.exit(EXIT_API_FAILURE);
    }
    targetDir = resolve(targetDir);
    if (countNonTestCsproj(targetDir) === 0 && !hasSln(targetDir)) {
      logError(`No .sln or .csproj files found in: ${targetDir}`);
      process.exit(EXIT_MISUSE);
    }
    rootRepo = basename(targetDir);
  }

  // ── Step 1: cache refresh ──
  if (!args.skipRefresh) {
    logInfo("Refreshing repository cache...");
    const rc = await refreshRepoCache();
    if (rc === 2) logWarn("Some repositories failed to cache (continuing with partial cache)");
    else if (rc !== 0) {
      logError("Failed to refresh repository cache");
      process.exit(EXIT_GENERAL_ERROR);
    }
  }

  // ── Step 2: reverse tree (single-target) or global generations ──
  let depths: number[] = [];
  const treeRows = new Map<string, string[]>();

  if (args.globalMode) {
    const gens = getTopologicalGenerations();
    const keep = repoFilter(args.includes, args.excludes);
    const byGen = new Map<number, string[]>();
    let filteredOut = 0;
    for (const g of gens) {
      // Filtering happens after the graph is ordered, so a wave keeps the full
      // dependency order and generation numbers mean the same in every wave.
      if (!keep(g.repo)) {
        filteredOut += 1;
        continue;
      }
      const list = byGen.get(g.generation) ?? [];
      list.push(g.repo);
      byGen.set(g.generation, list);
    }
    if (filteredOut > 0) logInfo(`Repository filter: ${gens.length - filteredOut} of ${gens.length} repositories selected`);
    if (gens.length > 0 && byGen.size === 0) {
      logInfo("No repositories match the --include/--exclude filter. Nothing to update.");
      return;
    }
    depths = [...byGen.keys()].sort((a, b) => a - b);
    for (const [gen, repos] of byGen) treeRows.set(String(gen), repos);
    if (gens.length === 0) {
      logInfo("No C# repositories found in cache. Nothing to update.");
      return;
    }
  } else {
    let rows;
    try {
      rows = getReverseDependencyTree(rootRepo);
    } catch (err) {
      logError(errorMessage(err));
      process.exit(EXIT_GENERAL_ERROR);
    }
    for (const r of rows) {
      const list = treeRows.get(String(r.depth)) ?? [];
      list.push(r.repo);
      treeRows.set(String(r.depth), list);
    }
    depths = [...treeRows.keys()].map(Number).sort((a, b) => a - b);
    if (depths.length === 0) {
      logInfo(`No dependents found for ${rootRepo}. Nothing to update.`);
      return;
    }
  }

  if (args.globalMode && args.globalStartGen > 0) {
    const maxGen = Math.max(...depths);
    if (args.globalStartGen > maxGen) {
      logError(`Starting generation ${args.globalStartGen} exceeds maximum generation ${maxGen}`);
      process.exit(EXIT_MISUSE);
    }
  }

  // ── Step 3: target packages (single-target mode only) ──
  const targetPackages: string[] = [];
  const latestVersions = new Map<string, string>();
  if (!args.globalMode) {
    try {
      targetPackages.push(...listRepoPackages(rootRepo));
    } catch (err) {
      logError(errorMessage(err));
      process.exit(EXIT_GENERAL_ERROR);
    }
    if (targetPackages.length === 0) {
      logError(`No packages found for repository ${rootRepo}`);
      process.exit(EXIT_GENERAL_ERROR);
    }
    for (const pkg of targetPackages) {
      const ver = getLatestVersion(pkg);
      if (ver === "") {
        logWarn(`Could not determine latest version for ${pkg} — will skip version check`);
      } else {
        latestVersions.set(pkg, ver);
        logInfo(`Latest version of ${pkg}: ${ver}`);
      }
    }
  }

  // ── Header ──
  console.log("");
  console.log("============================================================");
  if (args.globalMode) {
    console.log(args.dryRun ? "  Global Dependency Update Wizard (DRY RUN)" : "  Global Dependency Update Wizard");
    if (args.globalStartGen > 0) console.log(`  Resuming from generation: ${args.globalStartGen}`);
  } else {
    console.log(args.dryRun ? `  Dependency Update Wizard (DRY RUN) for: ${rootRepo}` : `  Dependency Update Wizard for: ${rootRepo}`);
  }
  console.log(`  Generations to process: ${depths.join(" ")}`);
  console.log("============================================================");

  // ── Step 4: process each generation ──
  const cacheRoot = resolve(repoCacheDir());

  for (let idx = 0; idx < depths.length; idx++) {
    const depth = depths[idx] as number;
    if (args.globalMode && depth < args.globalStartGen) {
      logInfo(`Skipping generation ${depth} (resuming from ${args.globalStartGen})`);
      continue;
    }

    console.log("");
    console.log("────────────────────────────────────────────────────────────");
    console.log(args.globalMode ? `  Processing generation ${depth}` : `  Processing depth ${depth} dependents`);
    console.log("────────────────────────────────────────────────────────────");

    const reposAtDepth = treeRows.get(String(depth)) ?? [];

    if (!args.auto && !args.dryRun) {
      console.log("");
      console.log("  Repositories in this generation:");
      for (const repo of reposAtDepth) console.log(`    - ${repo}`);
      console.log("");
      const answer = promptGeneration();
      if (answer === "skip") {
        console.log("");
        logInfo(`Skipping generation ${depth}.`);
        continue;
      }
      if (answer === "abort") {
        console.log("");
        logInfo("Aborting.");
        return;
      }
    }

    let processed = 0;
    let skipped = 0;
    const mergedRepos: MergedRepo[] = [];

    for (const repo of reposAtDepth) {
      const repoDir = join(cacheRoot, repo);
      if (!existsSync(repoDir)) {
        logWarn(`Cached repo not found: ${repo} — skipping`);
        continue;
      }
      console.log("");
      logInfo(`── ${repo} ──`);

      // Single-target mode: pre-flight version check.
      if (!args.globalMode) {
        let needsUpdate = false;
        for (const pkg of targetPackages) {
          const latest = latestVersions.get(pkg) ?? "";
          if (latest === "") { needsUpdate = true; break; }
          const used = getUsedVersion(repoDir, pkg);
          if (used !== "" && used !== latest) {
            logInfo(`${pkg}: using ${used}, latest is ${latest}`);
            needsUpdate = true;
            break;
          }
        }
        if (!needsUpdate) {
          logInfo("Already up to date — skipping");
          skipped += 1;
          continue;
        }
      }

      if (args.dryRun) {
        console.log(`  [DRY RUN] Would update ${repo}`);
        if (!args.globalMode) {
          for (const pkg of targetPackages) {
            const latest = latestVersions.get(pkg) ?? "";
            const used = getUsedVersion(repoDir, pkg);
            if (used !== "" && latest !== "" && used !== latest) {
              console.log(`    ${pkg}: ${used} → ${latest}`);
            }
          }
        }
        processed += 1;
        continue;
      }

      // Delegate per-repo workflow to cs-references-update-wizard.
      let wizardRc = runSingleRepoWizard(args, repoDir);
      const exitCodes = [wizardRc];
      if (wizardRc === 10) {
        skipped += 1;
        continue;
      }
      if (wizardRc !== 0) {
        logError(`Single-repo wizard failed for ${repo} (exit ${wizardRc})`);
        let skipRepo = false;
        let mergedByHand = false;
        for (;;) {
          const choice = promptRetrySkipAbort(repo, mergeHandedToUser(exitCodes));
          if (choice === 3) {
            mergedByHand = true;
            break;
          }
          if (choice === 2) {
            logError(`Aborting: ${repo} could not be updated and downstream repos may depend on it.`);
            process.exit(1);
          }
          if (choice === 1) {
            logWarn(`Skipping ${repo} — downstream repos may be affected.`);
            skipRepo = true;
            break;
          }
          wizardRc = runSingleRepoWizard(args, repoDir);
          exitCodes.push(wizardRc);
          if (wizardRc === 0 || wizardRc === 10) break;
          logError(`Retry failed for ${repo} (exit ${wizardRc})`);
        }
        // A retry with nothing left to change merged nothing — unless an earlier
        // attempt handed the merge to the user, who has since merged it by hand.
        if (skipRepo || (!mergedByHand && !attemptsMerged(exitCodes))) {
          skipped += 1;
          continue;
        }
        if (mergedByHand || wizardRc === 10) logInfo(`${repo} was merged by hand; its pipeline run will be awaited`);
      }

      const fullName = await getFullRepoName(repoDir);
      if (fullName === "") {
        logWarn(`Could not resolve the repo spec of ${repo}; its pipeline run will not be awaited`);
      } else {
        mergedRepos.push({ spec: fullName, dir: repoDir });
      }
      processed += 1;
    }

    console.log("");
    console.log(`  Generation ${depth} complete: ${processed} updated, ${skipped} skipped`);

    // After every level, the last one included: wait for the merged commits'
    // pipeline runs. Between levels, also refresh the cache.
    if (mergedRepos.length > 0) {
      logInfo(`Waiting for pipeline runs to complete ${levelWaitPurpose(idx, depths)}...`);
      let workflowFailed = false;
      for (const merged of mergedRepos) {
        try {
          const branch = await repoDefaultBranch(merged.spec);
          // Resolved now, on the branch the provider reports: "" when it cannot
          // be fetched, which fails the wait rather than passing without proof.
          const sha = mergedTip(merged.dir, branch);
          if (!(await waitForMergedRun({ ...merged, sha }, branch, 15, 600))) workflowFailed = true;
        } catch (err) {
          logError(`Could not determine the default branch of ${merged.spec}: ${errorMessage(err)}`);
          workflowFailed = true;
        }
      }
      if (workflowFailed) {
        logWarn("Some workflow runs failed or timed out.");
        promptUser("Please verify the pipeline runs manually, then press Enter to continue.");
      }
    }
    if (idx < depths.length - 1) {
      // --no-refresh and --dry-run both mean the cache is not touched.
      if (!args.skipRefresh && !args.dryRun) {
        logInfo("Refreshing repository cache for next generation...");
        const refreshed = await refreshRepoCache();
        if (refreshed === 1) {
          logError("Failed to refresh repository cache; the next generation would run on stale data");
          process.exit(EXIT_GENERAL_ERROR);
        }
        if (refreshed === 2) logWarn("Some repositories failed to cache (continuing with partial cache)");
      }
      // Rebuild the tree state against the refreshed index? The bash wizard
      // reuses the in-memory tree; parity: keep the in-memory state.
    }
  }

  console.log("");
  console.log("============================================================");
  console.log("  Global dependency update complete");
  console.log("============================================================");
}

main().catch((err: unknown) => {
  logError(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
});
