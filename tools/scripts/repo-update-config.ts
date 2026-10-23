#!/usr/bin/env node
// repo-update-config.ts - Apply or update configuration (rulesets) to an
//                         existing cloned repository
// Version: 1.1.0
// Description: Takes a path to an existing cloned repository and applies
//              configuration settings (particularly GitHub rulesets) based
//              on the repository type. If the type is not specified, it is
//              detected from the repository's GitHub settings.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo } from "../lib/core/logging.ts";
import { providerOrgGet } from "../lib/providers/provider-core.ts";
import {
  loadRepoTypesConfig,
  validateRepoType,
  detectRepoType,
  configureRulesetsForType,
  configureTemplateSettingForType,
  configureMergeTypesForType,
  configurePrBranchDeletionForType,
  configureRepositoryFeaturesForType,
  configureRepositoryPermissionsForType,
  repoTypesConfigPath,
} from "../lib/domain/repos/types.ts";

assertNodeFloor();

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function usage(): never {
  console.error("Usage: repo-update-config <repo-path> [--type <type>]");
  console.error("");
  console.error("Arguments:");
  console.error("  repo-path                Path to the cloned repository");
  console.error("");
  console.error("Options:");
  console.error("  --type <type>            Repository type (optional; auto-detected if not provided)");
  console.error("");
  console.error("Examples:");
  console.error("  repo-update-config ~/repos/my-service");
  console.error("  repo-update-config ~/repos/my-docs --type documentation");
  process.exit(1);
}

// Org identity gate: fail fast when unresolvable (env override → config → seed).
if (providerOrgGet() === "") {
  logError("Organization identity unresolved. Configure [organization] org in devenv.config or run setup.");
  process.exit(EXIT_MISUSE);
}

let repoPath = "";
let repoType = "";

const argv = process.argv.slice(2);
while (argv.length > 0) {
  const arg = argv.shift() ?? "";
  if (arg === "--type") {
    const v = argv.shift();
    if (v === undefined) {
      logError("--type requires an argument");
      usage();
    }
    repoType = v;
  } else if (arg === "-h" || arg === "--help") {
    usage();
  } else if (arg.startsWith("-")) {
    logError(`Unknown option: ${arg}`);
    usage();
  } else if (repoPath === "") {
    repoPath = arg;
  } else {
    logError("Too many positional arguments");
    usage();
  }
}

if (repoPath === "") {
  logError("Repository path is required");
  usage();
}

if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
  logError(`Repository path does not exist or is not a directory: ${repoPath}`);
  process.exit(1);
}

const REPO_TYPES_CONFIG = repoTypesConfigPath(undefined, toolsDir);
if (!existsSync(REPO_TYPES_CONFIG)) {
  logError(`Repo types config not found: ${REPO_TYPES_CONFIG}`);
  process.exit(1);
}
const config = loadRepoTypesConfig(REPO_TYPES_CONFIG);

// Get the full repository name from git remote (gh first, git-remote fallback).
logInfo("Reading repository information...");
const fullName = getFullRepoName(repoPath);
if (fullName === null) process.exit(1);
logInfo(`Repository: ${fullName}`);

// Detect repo type if not specified. No-match is a named failure listing the
// valid types (bash prompted on /dev/tty; that interactive flow is deferred —
// the non-interactive path must not validate the empty string).
if (repoType === "") {
  logInfo("Detecting repository type...");
  repoType = detectRepoType(fullName, config) ?? "";
  if (repoType === "") {
    logError(`Could not auto-detect the repository type for '${fullName}'.`);
    logError(`Valid types: ${Object.keys(config.types).join(", ")}`);
    logError("Re-run with --type <type>.");
    process.exit(EXIT_GENERAL_ERROR);
  }
}
logInfo(`Repository type: ${repoType}`);

// Validate the repo type
try {
  validateRepoType(fullName, repoType, config);
} catch {
  process.exit(1);
}

// Apply configuration
logInfo(`Applying configuration for type '${repoType}'...`);
if (existsSync(REPO_TYPES_CONFIG)) {
  configureRulesetsForType(fullName, repoType, config, toolsDir);
  logInfo("✓ Protection applied successfully");
} else {
  logError("Failed to apply protection");
}

configureTemplateSettingForType(fullName, repoType, config);

if (!configureMergeTypesForType(fullName, repoType, config)) {
  logError("Failed to configure merge types");
}

configurePrBranchDeletionForType(fullName, repoType, config);
configureRepositoryFeaturesForType(fullName, repoType, config);
configureRepositoryPermissionsForType(fullName, repoType, config);

logInfo("✓ Configuration applied");

/** owner/repo from gh (provider view), falling back to the git remote URL
 * (SSH and HTTPS forms) — get_full_repo_name's chain. */
function getFullRepoName(repoDir: string): string | null {
  const gh = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    encoding: "utf8",
    cwd: repoDir,
  });
  if (gh.status === 0 && (gh.stdout ?? "").trim() !== "") return gh.stdout.trim();

  const git = spawnSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8", cwd: repoDir });
  const gitUrl = git.status === 0 ? (git.stdout ?? "").trim() : "";
  if (gitUrl === "") {
    logError("No git remote 'origin' found in repository");
    return null;
  }
  const ssh = /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/.exec(gitUrl);
  if (ssh !== null && ssh[1] !== undefined && ssh[2] !== undefined) return `${ssh[1]}/${ssh[2]}`;
  const https = /[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(gitUrl);
  if (https !== null && https[1] !== undefined && https[2] !== undefined) return `${https[1]}/${https[2]}`;
  logError(`Could not extract owner/repo from remote URL: ${gitUrl}`);
  return null;
}
