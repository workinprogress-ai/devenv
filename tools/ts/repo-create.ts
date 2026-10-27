#!/usr/bin/env node
// repo-create.ts - Create a new GitHub repository with standardized
//                  configuration
// Version: 1.2.0
// Description: Creates a repository of a configured type (naming pattern,
//              optional template, optional ruleset), clones it, initializes
//              the type's main branch, runs the post-creation script, and
//              applies the type's repository configuration (rulesets, merge
//              types, features, permissions) — per tools/config/repo-types.yaml.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync, chmodSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { providerOrgGet } from "../lib/providers/provider-core.ts";
import { authStatusOk } from "../lib/providers/github/urls.ts";
import { reposView, reposCreate, reposCommitsCount } from "../lib/providers/github/repos.ts";
import {
  loadRepoTypesConfig,
  repoTypesConfigPath,
  validateRepoType,
  getType,
  getTypeMainBranch,
  getTypeTemplate,
  getTypePostCreationScript,
  getTypeDeletePostCreationScript,
  getTypePostCreationCommitHandling,
  getTypeDescription,
  getTypeNamingExample,
} from "../lib/domain/repos/types.ts";

assertNodeFloor();

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_TYPES_CONFIG = repoTypesConfigPath(undefined, toolsDir);

function printUsage(): void {
  console.error("Usage: repo-create <repo-name> --type <type> [OPTIONS]");
  console.error("       repo-create --interactive");
  console.error("");
  console.error("Options:");
  console.error("  --type <type>           Repository type (see below)");
  console.error("  --interactive, -i       Interactive mode (select type and enter name)");
  console.error("  --public|--private      Visibility (default: private)");
  console.error("  --description <text>    Repository description");
  console.error("  --no-branch-protection  Skip branch protection setup");
  console.error("  --no-template           Skip template initialization");
  console.error("  --no-clone              Skip cloning repo after creation");
  console.error("  --no-post-creation      Skip running post-creation script");
  console.error("");
  console.error("Repository Types:");
  try {
    const config = loadRepoTypesConfig(REPO_TYPES_CONFIG);
    for (const [key, type] of Object.entries(config.types)) {
      console.error(`  ${key}: ${getTypeNamingExample(type)} (template: ${getTypeTemplate(type) ?? "none"})`);
    }
  } catch {
    console.error("  (unable to read repo types)");
  }
  console.error("");
}

function usage(): never {
  printUsage();
  process.exit(1);
}

// Wait for repository to be ready (has content/commits) — handles the race
// where gh repo create returns before template files sync to the remote.
async function waitForRepoReady(fullName: string): Promise<boolean> {
  const maxAttempts = 30; // ~2.5 minutes with 5 second intervals
  const delay = 5;
  logInfo("Waiting for repository to be ready (template files syncing)...");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await reposCommitsCount(fullName)) {
      logInfo("✓ Repository is ready");
      return true;
    }
    if (attempt < maxAttempts) {
      console.error(`  Attempt ${attempt}/${maxAttempts}: Repository not ready yet, waiting ${delay}s...`);
      spawnSync("sleep", [String(delay)], { stdio: "ignore" });
    }
  }
  logError(`Repository did not become ready within ${maxAttempts * delay} seconds`);
  return false;
}

function createInitialBranch(repoName: string, repoType: string, reposDir: string, config: ReturnType<typeof loadRepoTypesConfig>): void {
  const type = getType(repoType, config);
  if (type === undefined) return;
  const mainBranch = getTypeMainBranch(type);
  const repoPath = join(reposDir, repoName);

  const git = (args: string[], ignoreFailure = false): boolean => {
    const r = spawnSync("git", args, { encoding: "utf8", cwd: repoPath });
    return ignoreFailure || r.status === 0;
  };

  git(["fetch", "origin"], true);

  if (git(["rev-parse", "--verify", "--quiet", `origin/${mainBranch}`])) {
    // Remote branch exists with commits - use it
    logInfo("Repository already has commits on origin, syncing...");
    git(["checkout", "-B", mainBranch], true);
    if (!git(["reset", "--hard", `origin/${mainBranch}`])) {
      logError(`Failed to reset to origin/${mainBranch} — continuing with an unverified branch state`);
    } else {
      logInfo(`✓ Local branch synced with origin/${mainBranch}`);
    }
    if (git(["branch", "--set-upstream-to", `origin/${mainBranch}`, mainBranch], true)) {
      logInfo(`✓ Branch tracking configured for ${mainBranch}`);
    }
  } else {
    // Remote branch doesn't exist - create initial commit locally
    logInfo(`Setting up ${mainBranch} branch with initial commit...`);
    git(["checkout", "-B", mainBranch], true);
    git(["commit", "--allow-empty", "-m", "chore: initial commit"], true);
    if (git(["push", "-u", "origin", mainBranch])) {
      logInfo(`✓ ${mainBranch} branch initialized and pushed`);
    } else {
      logError(`Failed to push ${mainBranch} — branch protection will not have a branch to protect`);
    }
  }
}

function runPostCreationScript(repoDir: string, repoName: string, type: NonNullable<ReturnType<typeof getType>>): void {
  const scriptPath = getTypePostCreationScript(type);
  const deleteScript = getTypeDeletePostCreationScript(type);
  const commitHandling = getTypePostCreationCommitHandling(type);

  if (scriptPath === "" || scriptPath === "null") return;

  const fullScriptPath = join(repoDir, scriptPath);
  if (!existsSync(fullScriptPath)) {
    logInfo(`Post-creation script not found: ${scriptPath} (skipping)`);
    return;
  }

  logInfo(`Running post-creation script: ${scriptPath}`);
  chmodSync(fullScriptPath, 0o755);
  if (spawnSync(fullScriptPath, { cwd: repoDir, stdio: "inherit" }).status !== 0) {
    logWarn("Post-creation script failed");
    return;
  }
  logInfo("✓ Post-creation script completed");

  if (deleteScript) {
    rmSync(fullScriptPath, { force: true });
    logInfo("✓ Post-creation script deleted");
  }

  // Handle commits based on configuration
  const clean = spawnSync("git", ["diff-index", "--quiet", "HEAD", "--"], { cwd: repoDir });
  if (clean.status === 0) {
    logInfo("No changes to commit");
    return;
  }

  const gitRun = (args: string[]): boolean => spawnSync("git", args, { cwd: repoDir, stdio: "inherit" }).status === 0;
  const descriptor = repoName.split(".").pop() ?? repoName;

  if (commitHandling === "amend") {
    const hasHead = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: repoDir }).status === 0;
    if (hasHead) {
      logInfo("Amending initial commit with post-creation changes...");
      if (gitRun(["add", "-A"]) && gitRun(["commit", "--amend", "--no-edit", "-n"]) && gitRun(["push", "--force-with-lease"])) {
        logInfo("✓ Initial commit amended and force pushed");
      }
    } else {
      logInfo("No existing commit to amend, creating new commit...");
      if (gitRun(["add", "-A"]) && gitRun(["commit", "-m", `chore: post-creation setup for ${descriptor}`]) && gitRun(["push"])) {
        logInfo("✓ New commit created and pushed");
      }
    }
  } else if (commitHandling === "new") {
    logInfo("Creating new commit for post-creation changes...");
    if (gitRun(["add", "-A"]) && gitRun(["commit", "-m", `chore: post-creation setup for ${descriptor}`]) && gitRun(["push"])) {
      logInfo("✓ New commit created and pushed");
    }
  } else if (commitHandling === "none") {
    logInfo("Post-creation changes detected but commit_handling is 'none'");
    logInfo("You will need to commit these changes manually");
  } else {
    logWarn(`Unknown commit_handling value: ${commitHandling}`);
  }
}

async function createRepo(
  repoName: string,
  visibility: string,
  description: string,
  repoType: string,
  skipProtection: boolean,
  skipTemplate: boolean,
  skipClone: boolean,
  skipPostCreation: boolean,
  config: ReturnType<typeof loadRepoTypesConfig>,
): Promise<void> {
  const org = providerOrgGet();
  const fullName = `${org}/${repoName}`;

  // Check if repo already exists
  try {
    await reposView(fullName);
    logInfo(`Repository '${fullName}' already exists. Nothing to do.`);
    return;
  } catch {
    // doesn't exist — proceed
  }

  // Validate naming convention for repo type
  try {
    validateRepoType(repoName, repoType, config);
  } catch {
    process.exit(1);
  }

  logInfo(`Creating repository '${fullName}' (type: ${repoType})...`);

  const type = getType(repoType, config);
  const template = type !== undefined && !skipTemplate ? (getTypeTemplate(type) ?? "") : "";

  if (template !== "") logInfo(`Using template: ${org}/${template}`);

  const result = await reposCreate(fullName, {
    visibility: visibility === "public" ? "public" : "private",
    ...(description !== "" ? { description } : {}),
    ...(template !== "" ? { template: `${org}/${template}` } : {}),
  });
  if (result.status !== 0) {
    logError(`Failed to create repository${result.stderr.trim() ? `: ${result.stderr.trim().split("\n")[0]}` : ""}`);
    process.exit(1);
  }

  // Host literal sanctioned: user-facing next-step message (display only,
  // not transport); fork rewrites with its provider's host.
  logInfo(`✓ Repository created: git@github.com:${fullName}.git`);

  if (template !== "") {
    if (!(await waitForRepoReady(fullName))) {
      logWarn("Repository may not be fully ready, but proceeding with clone...");
    }
  }

  const reposDir = join(process.env.DEVENV_ROOT ?? "", "repos");

  if (!skipClone) {
    logInfo("Cloning repository locally...");
    const repoGetScript = join(toolsDir, "scripts", "repo-get.ts");
    if (existsSync(repoGetScript)) {
      if (spawnSync("node", [repoGetScript, repoName], { stdio: "inherit" }).status === 0) {
        logInfo(`✓ Repository cloned to ${reposDir}/${repoName}`);

        if (type !== undefined) createInitialBranch(repoName, repoType, reposDir, config);

        if (!skipPostCreation && type !== undefined) {
          runPostCreationScript(join(reposDir, repoName), repoName, type);
        }

        if (!skipProtection) {
          logInfo("Applying repository configuration...");
          const updateConfigScript = join(toolsDir, "repo-update-config");
          if (existsSync(updateConfigScript)) {
            if (spawnSync(updateConfigScript, [join(reposDir, repoName)], { stdio: "inherit" }).status !== 0) {
              logWarn("Repository configuration reported failures");
            }
          } else {
            logWarn("repo-update-config script not found, skipping configuration");
          }
        }
      } else {
        logWarn("Failed to clone repository");
      }
    } else {
      logWarn("repo-get not found, skipping clone");
    }
  } else {
    if (!skipProtection) {
      logWarn("Branch protection cannot be configured without cloning the repo first");
      logInfo("Clone the repo and run the following to set up branch protection:");
      logInfo(`cd ${reposDir}/${repoName} && git push origin master`);
    }
  }

  console.log("");
  logInfo("Repository creation complete!");
  logInfo("");
  logInfo("Next steps:");
  if (skipClone) {
    logInfo(`  1. Clone the repo: git clone git@github.com:${fullName}.git`);
    logInfo("  2. Make your changes and commit");
  } else {
    logInfo(`  1. Navigate to repo: cd ${reposDir}/${repoName}`);
    logInfo("  2. Make your changes and commit");
  }
}

// --- main -------------------------------------------------------------------

const argv0 = process.argv[2] ?? "";
if (argv0 === "--help" || argv0 === "-h") {
  printUsage();
  process.exit(0);
}

let visibility = "private";
let description = "";
let repoType = "";
let skipProtection = false;
let skipTemplate = false;
let skipClone = false;
let skipPostCreation = false;
let interactiveMode = false;
let repoName = "";

const args = process.argv.slice(2);
if (args[0] === "--interactive" || args[0] === "-i") {
  interactiveMode = true;
  args.shift();
} else if (args.length >= 1 && !(args[0] ?? "").startsWith("-")) {
  repoName = args.shift() ?? "";
}

while (args.length > 0) {
  const arg = args.shift() ?? "";
  switch (arg) {
    case "--public": visibility = "public"; break;
    case "--private": visibility = "private"; break;
    case "--description": description = args.shift() ?? ""; break;
    case "--type": repoType = args.shift() ?? ""; break;
    case "--no-branch-protection": skipProtection = true; break;
    case "--no-template": skipTemplate = true; break;
    case "--no-clone": skipClone = true; break;
    case "--no-post-creation": skipPostCreation = true; break;
    case "--interactive": case "-i": interactiveMode = true; break;
    case "--help": case "-h": printUsage(); process.exit(0); break;
    default:
      if (repoName === "" && !arg.startsWith("-")) {
        repoName = arg;
      } else {
        logError(`Unknown option '${arg}'`);
        usage();
      }
  }
}

const config = loadRepoTypesConfig(REPO_TYPES_CONFIG);

if (interactiveMode) {
  if (!process.stdout.isTTY) {
    logError("--interactive requires an interactive terminal (type/name prompts).");
    logError("Pass --type <type> <name> for non-interactive creation.");
    process.exit(EXIT_MISUSE);
  }
  const { select, text } = await import("../lib/ui/index.ts");
  const typeKeys = Object.keys(config.types);
  const selected = await select<string>({
    message: "Select repository type:",
    fallback: "",
    options: typeKeys.map((k) => {
      const t = config.types[k];
      if (t === undefined) return { value: k, label: k };
      return {
        value: k,
        label: k,
        hint: `${getTypeDescription(t)} (e.g. ${getTypeNamingExample(t)})`,
      };
    }),
  });
  repoType = selected;
  if (repoType === "") {
    logError("No type selected");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const type = getType(repoType, config);
  if (type === undefined) {
    logError(`Unknown repository type '${repoType}'`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  logInfo(`Enter repository name (example: ${getTypeNamingExample(type)})`);
  for (;;) {
    const answer = await text({ message: "Repository name:", fallback: "" });
    if (answer === "") continue;
    try {
      validateRepoType(answer, repoType, config);
      repoName = answer;
      break;
    } catch {
      logInfo("Invalid repository name. Please try again.");
    }
  }
  description = await text({ message: "Description:", fallback: "" });
}

if (repoName === "") {
  logError("Repository name is required");
  usage();
}
if (repoType === "") {
  logError("Repository type is required");
  logInfo("Use --type flag or --interactive mode");
  usage();
}

// Org identity gate + provider auth (order matches the bash script's flow).
const org = providerOrgGet();
if (org === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}
if (!authStatusOk()) {
  logError("Provider CLI is not authenticated. Run 'key-update-provider' first.");
  process.exit(EXIT_GENERAL_ERROR);
}await createRepo(repoName, visibility, description, repoType, skipProtection, skipTemplate, skipClone, skipPostCreation, config);

logInfo(`Repository '${repoName}' creation process completed.  🍻`);
