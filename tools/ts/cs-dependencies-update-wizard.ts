// cs-dependencies-update-wizard — interactive multi-repo NuGet dependency
// update wizard. Port of cs-dependencies-update-wizard.sh: walk the reverse
// dependency tree of a target repo (or every cached C# repo with --global)
// generation by generation, update each dependent repo's NuGet references
// via the single-repo wizard (cs-references-update-wizard), create PRs and
// merge them, wait for GitHub Actions between generations (through the
// facade's pipelines verbs), and refresh the repo cache.

import { spawnSync } from "node:child_process";
import { requireCommandOrExit } from "../lib/core/commands.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { resolveToolsRoot, selfRoot } from "../lib/core/self-root.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";
import {
  getReverseDependencyTree,
  getTopologicalGenerations,
  listRepoPackages,
  refreshRepoCache,
} from "../lib/domain/cs/dependency-graph.ts";
import { providerOrgGet } from "../lib/providers/provider-core.ts";

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
  generation, wait for GitHub Actions to complete.

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
    --auto                  Process generations without confirmation prompts
    --global [N]            Global mode; optional starting generation N

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

function promptRetrySkipAbort(repo: string): 0 | 1 | 2 {
  console.log("");
  for (;;) {
    process.stdout.write(`>>> ${repo} failed. [r]etry / [s]kip (continue without it) / [a]bort wizard: `);
    const r = spawnSync("bash", ["-c", 'read -r answer < /dev/tty; printf "%s" "$answer"'], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    });
    const a = (r.stdout ?? "").trim();
    if (/^[Rr]/.test(a)) { console.log(""); return 0; }
    if (/^[Ss]/.test(a)) { console.log(""); return 1; }
    if (/^[Aa]/.test(a)) { console.log(""); return 2; }
    console.log("    Please answer r, s, or a.");
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
 * absent). The package name reaches grep via its argv, never a shell string. */
function getUsedVersion(repoDir: string, pkgName: string): string {
  const re = new RegExp(`PackageReference Include="${pkgName}" Version="([^"]+)"`);
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
        if (!p.includes("/src/")) continue;
        const hit = walk(p);
        if (hit !== "") return hit;
      } else if (e.name.endsWith(".csproj")) {
        const m = re.exec(readFileSync(p, "utf8"));
        if (m !== null && m[1] !== undefined) return m[1];
      }
    }
    return "";
  };
  return walk(repoDir);
}

/** Wait for GitHub Actions runs on a repo/branch to complete (the
 * wait_for_workflow_runs contract: unknown states are retried, a failed or
 * cancelled latest run fails the wait). Goes through the facade's
 * pipelines verbs — no direct gh anywhere. */
function waitForWorkflowRuns(repo: string, branch: string, interval: number, timeout: number): boolean {
  // Made async-capable by the caller; the loop stays sync (sleep) for parity.
  let elapsed = 0;
  let queryFailures = 0;
  const maxQueryFailures = 3;
  for (;;) {
    if (elapsed >= timeout) {
      logError(`wait_for_workflow_runs: timed out after ${timeout}s on ${repo} (${branch})`);
      return false;
    }
    let activeCount: number;
    try {
      const out = runPipelinesListSync(repo, branch, 10, "status");
      const parsed = JSON.parse(out) as Array<{ status?: string }>;
      if (!Array.isArray(parsed)) throw new Error("run list returned a non-array payload");
      activeCount = parsed.filter((r) =>
        r.status === "queued" || r.status === "in_progress" || r.status === "waiting" || r.status === "pending" || r.status === "requested",
      ).length;
    } catch {
      queryFailures += 1;
      if (queryFailures >= maxQueryFailures) {
        logError(`wait_for_workflow_runs: could not query workflow runs on ${repo} (${branch}) after ${queryFailures} attempts`);
        return false;
      }
      logWarn(`could not query workflow runs on ${repo} (${branch}); retrying (${queryFailures}/${maxQueryFailures})`);
      spawnSync("sleep", [String(interval)]);
      elapsed += interval;
      continue;
    }
    if (activeCount === 0) {
      try {
        const out = runPipelinesListSync(repo, branch, 1, "conclusion");
        const parsed = JSON.parse(out) as Array<{ conclusion?: string }>;
        const latest = parsed[0]?.conclusion ?? "";
        if (latest === "failure" || latest === "cancelled") {
          logWarn(`Latest workflow run on ${repo} (${branch}) concluded: ${latest}`);
          return false;
        }
        return true;
      } catch {
        queryFailures += 1;
        if (queryFailures >= maxQueryFailures) {
          logError(`wait_for_workflow_runs: could not read the latest run's conclusion on ${repo} (${branch}) after ${queryFailures} attempts`);
          return false;
        }
        logWarn(`could not read the latest run's conclusion on ${repo} (${branch}); retrying (${queryFailures}/${maxQueryFailures})`);
        spawnSync("sleep", [String(interval)]);
        elapsed += interval;
        continue;
      }
    }
    queryFailures = 0;
    logInfo(`Waiting for ${activeCount} workflow run(s) on ${repo} (${branch})... [${elapsed}s/${timeout}s]`);
    spawnSync("sleep", [String(interval)]);
    elapsed += interval;
  }
}

/** Sync wrapper over the facade's run list (the wizard is a top-level
 * script; the facade verb is async — bridge with spawnSync on the stub). */
function runPipelinesListSync(repo: string, branch: string, limit: number, json: string): string {
  const toolsRoot = resolveToolsRoot(import.meta.url);
  // Through the provider facade verb via its own module import in-process is
  // async; the wizard's sync flow bridges through the facade-backed lib with
  // a subprocess import — the provider seam stays the only gh caller.
  // Plain --json only: the jq programs this used to pass are outside
  // applyJq's supported subset, so every poll threw and the CI-wait was
  // structurally dead. The wizard filters in-process (status) or reads
  // fields directly (conclusion).
  const script = `import { pipelinesRunList } from "${join(toolsRoot, "lib/providers/facade/pipelines.ts")}";
  const out = await pipelinesRunList(${JSON.stringify(repo)}, { branch: ${JSON.stringify(branch)}, limit: ${limit}, json: ${JSON.stringify(json === "status" ? "status,conclusion" : "conclusion")} });
  process.stdout.write(out);`;
  const r = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr ?? "pipelines run list failed");
  return r.stdout ?? "";
}

/** Full owner/repo name of a cached repo (get_full_repo_name parity through
 * the facade's reposView). Empty when unresolvable. */
function getFullRepoName(repoDir: string): string {
  const name = basename(repoDir);
  const org = providerOrgGet();
  return org !== "" ? `${org}/${name}` : "";
}

/** Default branch of a repo through the facade's repos view. "master" when
 * unresolvable (bash fallback). */
function defaultBranch(repoFull: string): string {
  try {
    // Sync bridge over the async facade verb (same mechanism as the run list).
    const toolsRoot = resolveToolsRoot(import.meta.url);
    const script = `import { reposView } from "${join(toolsRoot, "lib/providers/facade/repos.ts")}";
    const out = await reposView(${JSON.stringify(repoFull)}, { json: "defaultBranch" });
    const j = JSON.parse(out) as { defaultBranch?: string };
    process.stdout.write(j.defaultBranch ?? "");`;
    const r = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });
    if (r.status === 0) {
      const b = (r.stdout ?? "").trim();
      if (b !== "") return b;
    }
  } catch {
    // fall through to the bash fallback
  }
  return "master";
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
}

function parseArgs_main(): WizardArgs {
  const a: WizardArgs = {
    targetDir: "", skipRefresh: false, dryRun: false, globalMode: false,
    globalStartGen: 0, auto: false, framework: "", langVersion: "", langDefault: false,
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
        auto: { type: "boolean", default: false },
        "auto-generations": { type: "boolean", default: false },
        global: { type: "boolean", default: false },
      },
    });
    if (cli.common.help) showUsage();
    a.skipRefresh = cli.values["no-refresh"] === true;
    a.framework = (cli.values["framework"] as string | undefined) ?? "";
    a.langVersion = (cli.values["lang-version"] as string | undefined) ?? "";
    a.langDefault = cli.values["lang-default"] === true;
    a.dryRun = cli.common.dryRun;
    a.auto = cli.values["auto"] === true || cli.values["auto-generations"] === true;
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
    console.log("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  if (a.globalMode && a.targetDir !== "") {
    logError("--global and TARGET_DIR are mutually exclusive. Use --help for usage information.");
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
  wizardArgs.push(repoDir);
  const inv = siblingInvocation(SINGLE_REPO_WIZARD, wizardArgs);
  const r = spawnSync(inv.command, inv.args, { stdio: "inherit" });
  return r.status ?? 1;
}

async function main(): Promise<void> {
  requireCommandOrExit("git", undefined, EXIT_GENERAL_ERROR);
  requireCommandOrExit("jq", undefined, EXIT_GENERAL_ERROR);
  requireCommandOrExit("dotnet", undefined, EXIT_GENERAL_ERROR);
  requireCommandOrExit("dotnet-outdated", undefined, EXIT_GENERAL_ERROR);

  const args = parseArgs_main();
  let rootRepo = "";

  // Single-target mode: validate TARGET_DIR.
  if (!args.globalMode) {
    let targetDir = args.targetDir === "" ? "." : args.targetDir;
    if (!existsSync(targetDir)) {
      logError(`Directory not found: ${targetDir}`);
      process.exit(EXIT_API_FAILURE);
    }
    targetDir = spawnSync("bash", ["-c", `cd "$1" && pwd`, "cd", targetDir], { encoding: "utf8" }).stdout.trim();
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
    const byGen = new Map<number, string[]>();
    for (const g of gens) {
      const list = byGen.get(g.generation) ?? [];
      list.push(g.repo);
      byGen.set(g.generation, list);
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
  const repoCacheDir =
  process.env.REPO_CACHE_DIR ?? join(selfRoot(import.meta.url), "tools", "cache", "repo_cache");

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
    const mergedRepos: string[] = [];

    for (const repo of reposAtDepth) {
      const repoDir = join(repoCacheDir, repo);
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
      if (wizardRc === 10) {
        skipped += 1;
        continue;
      }
      if (wizardRc !== 0) {
        logError(`Single-repo wizard failed for ${repo} (exit ${wizardRc})`);
        let skipRepo = false;
        for (;;) {
          const choice = promptRetrySkipAbort(repo);
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
          if (wizardRc === 0 || wizardRc === 10) { wizardRc = 0; break; }
          logError(`Retry failed for ${repo} (exit ${wizardRc})`);
        }
        if (skipRepo || wizardRc !== 0) {
          skipped += 1;
          continue;
        }
      }

      const fullName = getFullRepoName(join(repoCacheDir, repo));
      if (fullName !== "") mergedRepos.push(fullName);
      processed += 1;
    }

    console.log("");
    console.log(`  Generation ${depth} complete: ${processed} updated, ${skipped} skipped`);

    // Between-generation: wait for GH Actions, refresh cache.
    if (idx < depths.length - 1) {
      const nextDepth = depths[idx + 1];
      if (processed > 0) {
        logInfo(`Waiting for GitHub Actions to complete before processing generation ${nextDepth}...`);
        let workflowFailed = false;
        for (const repoFull of mergedRepos) {
          const branch = defaultBranch(repoFull);
          if (!waitForWorkflowRuns(repoFull, branch, 15, 600)) workflowFailed = true;
        }
        if (workflowFailed) {
          logWarn("Some workflow runs failed or timed out.");
          promptUser("Please verify GitHub Actions manually, then press Enter to continue.");
        }
      }
      logInfo("Refreshing repository cache for next generation...");
      await refreshRepoCache();
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
