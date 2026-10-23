#!/usr/bin/env node
// repo-get.ts - Clone or update a repository from the organization
// Version: 1.2.0
// Description: repo-get <name> clones/updates a specific repo; --select picks
//              interactively; --all clones every org repo not present locally;
//              no argument updates the current repo via its git context. A
//              foreign URL (https://, git@, ssh://, *.git) clones flat into
//              repos/ by its sanitized basename.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logWarn } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";
import { providerOrgGet, providerRepoSplit } from "../lib/providers/provider-core.ts";
import { gitTransportUrl, authStatusOk } from "../lib/providers/github/urls.ts";
import { reposList } from "../lib/providers/github/repos.ts";

assertNodeFloor();

const devenvRoot = process.env.DEVENV_ROOT ?? "";
if (devenvRoot === "") {
  console.error("ERROR: DEVENV_ROOT is not established");
  process.exit(EXIT_GENERAL_ERROR);
}
const reposDir = join(devenvRoot, "repos");
if (!existsSync(reposDir)) mkdirSync(reposDir, { recursive: true });

function printUsage(): void {
  console.error("Usage: repo-get [--select|--all] [<repository-name>|<repository-url>]");
  console.error("  --select: Show a selection list of repositories in the organization (excludes already cloned repos)");
  console.error("  --all: Clone all repositories in the organization not already present locally");
  console.error("  repository-name: Name of the GitHub repository (alphanumeric, hyphens, and dots)");
  console.error("  repository-url: Full URL to a foreign repository (https:// or git@); cloned flat into repos/ by its basename");
}

function usage(): never {
  printUsage();
  process.exit(EXIT_GENERAL_ERROR);
}

function git(args: string[], cwd?: string): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", ...(cwd !== undefined ? { cwd } : {}) });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// True when the argument is a repository URL (foreign repo) rather than an
// org repo name.
function isForeignUrl(arg: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/git@)/.test(arg) || arg.endsWith(".git");
}

// Foreign URL -> local folder name: URL basename minus .git, sanitized with
// the same character rules as org repo names (defends against URL tricks —
// path traversal, embedded whitespace, control characters).
function foreignRepoName(url: string): string | null {
  const trimmed = url.replace(/\/$/, "");
  const name = (trimmed.split("/").pop() ?? "").replace(/\.git$/, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(name)) {
    console.error(`ERROR: Cannot derive a valid folder name from URL: ${url}`);
    return null;
  }
  if (name === "repos" || name === "devenv" || name === "." || name === "..") {
    console.error(`ERROR: Derived folder name is reserved: ${name}`);
    return null;
  }
  return name;
}

function listLocalRepositories(): string[] {
  if (!existsSync(reposDir)) return [];
  return readdirSync(reposDir)
    .filter((name) => { try { return statSync(join(reposDir, name)).isDirectory(); } catch { return false; } })
    .sort();
}

async function listOrganizationRepositories(org: string, limit: number): Promise<string[]> {
  const raw = await reposList(org, { limit, json: "name", jq: ".[].name" });
  return raw
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l !== "");
}

function filterAvailableRepositories(orgRepos: string[], localRepos: string[]): string[] {
  const local = new Set(localRepos);
  return orgRepos.filter((r) => !local.has(r));
}

function validateRepositoryName(name: string): boolean {
  if (name === "") {
    console.error("ERROR: Repository name is required");
    return false;
  }
  if (name === "repos" || name === "." || name === "..") {
    console.error(`ERROR: Invalid repository name (reserved): ${name}`);
    return false;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(name)) {
    console.error(`ERROR: Invalid repository name format: ${name}`);
    console.error("Repository names must start with alphanumeric and contain only alphanumeric, hyphens, and dots");
    return false;
  }
  return true;
}

// Org identity + auth gates (same order as the bash script's flow).
const org = providerOrgGet();
if (org === "") process.exit(EXIT_GENERAL_ERROR);
if (!authStatusOk()) {
  console.error("ERROR: provider CLI is not authenticated. Run 'key-update-provider' first.");
  process.exit(EXIT_GENERAL_ERROR);
}

// --- mode resolution -------------------------------------------------------

let selectMode = false;
let allMode = false;
let repoName = "";
let foreignUrl = "";

const first = process.argv[2];
if (first === "--select") {
  selectMode = true;
} else if (first === "--all") {
  allMode = true;
} else if (first === "--help" || first === "-h") {
  printUsage();
  process.exit(0);
} else if (first === undefined || first === "") {
  const root = git(["rev-parse", "--show-toplevel"]);
  repoName = root.status === 0 ? (root.out.trim().split("/").pop() ?? "") : "";
  if (repoName === "" || repoName === "devenv" || !existsSync(join(reposDir, repoName))) {
    usage();
  }
} else {
  const input = first.replace(/\/$/, "");
  if (isForeignUrl(input)) {
    foreignUrl = input;
    const derived = foreignRepoName(input);
    if (derived === null) process.exit(EXIT_GENERAL_ERROR);
    repoName = derived;
  } else if (!validateRepositoryName(input)) {
    usage();
  } else {
    repoName = input;
  }
}

if (selectMode) {
  const orgRepos = await listOrganizationRepositories(org, 1000);
  const available = filterAvailableRepositories(orgRepos, listLocalRepositories());
  if (available.length === 0) {
    console.error(`ERROR: No repositories available to clone (all repos already exist in ${reposDir})`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!process.stdout.isTTY) {
    console.error("ERROR: --select requires an interactive terminal (no fzf picker without a TTY).");
    console.error("List candidates instead with: repo-get --all (dry) or `gh repo list <org>`.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const { multiSelect } = await import("../lib/ui/index.ts");
  void multiSelect; // interactive selection lands with the interactive polish pass
  console.error("ERROR: interactive selection is not available in this build; pass a repository name.");
  process.exit(EXIT_GENERAL_ERROR);
}

// --- foreign mode ----------------------------------------------------------

const targetDir = join(reposDir, repoName);

if (foreignUrl !== "") {
  const gitUrl = foreignUrl;
  if (existsSync(join(targetDir, ".git"))) {
    const remote = git(["remote", "get-url", "origin"], targetDir).out.trim();
    if (remote !== "" && remote !== gitUrl) {
      // Redact embedded credentials before displaying — remotes may carry
      // user:token@ auth, and error output must never echo secrets.
      const displayRemote = remote.replace(/:[^@]*@/, ":***@").replace(/https:\/\/[^/]*@/, "https://");
      console.error(`ERROR: ${targetDir} already exists as a clone of a different repository:`);
      console.error(`  existing remote: ${displayRemote}`);
      console.error(`  requested URL  : ${gitUrl}`);
      console.error("Refusing to mix remotes. Remove the folder if it is truly the same repo.");
      process.exit(EXIT_GENERAL_ERROR);
    }
    console.error(`Foreign repository '${repoName}' already exists. Fetching latest changes...`);
    if (git(["fetch", "--all", "--tags", "-f"], targetDir).status !== 0) process.exit(EXIT_GENERAL_ERROR);
    const ref = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], targetDir).out.trim();
    let defaultBranch = ref.replace(/^origin\//, "");
    if (defaultBranch === "") defaultBranch = "main";
    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], targetDir).out.trim();
    if (currentBranch !== defaultBranch) {
      if (git(["pull", "--rebase"], targetDir).status !== 0) process.exit(EXIT_GENERAL_ERROR);
    } else {
      if (git(["pull", "--ff-only"], targetDir).status !== 0) process.exit(EXIT_GENERAL_ERROR);
    }
  } else {
    console.error(`Cloning foreign repository '${repoName}' from ${gitUrl}...`);
    if (git(["clone", gitUrl, targetDir]).status !== 0) process.exit(EXIT_GENERAL_ERROR);
  }
  const updateSh = join(targetDir, ".repo", "update.sh");
  if (existsSync(updateSh)) {
    console.error(`=> Running update script for ${repoName}...`);
    if (spawnSync(updateSh, { cwd: targetDir, stdio: "inherit" }).status !== 0) process.exit(EXIT_GENERAL_ERROR);
  }
  const initSh = join(targetDir, ".repo", "init.sh");
  const inited = join(targetDir, ".repo", ".inited");
  if (existsSync(initSh) && !existsSync(inited)) {
    console.error(`=> Running init script for ${repoName}...`);
    if (spawnSync(initSh, { cwd: targetDir, stdio: "inherit" }).status !== 0) process.exit(EXIT_GENERAL_ERROR);
  }
  console.error("Foreign repository operation completed successfully.");
  process.exit(0);
}

// --- org mode --------------------------------------------------------------

let gitUrl = "";
if (!allMode) gitUrl = gitTransportUrl(org, repoName);

function detectDefaultBranch(dir: string): string {
  const ref = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], dir).out.trim();
  const branch = ref.replace(/^origin\//, "");
  if (branch !== "") return branch;
  if (git(["show-ref", "--verify", "--quiet", "refs/heads/main"], dir).status === 0) return "main";
  return "master";
}

// Global safe.directory entry: idempotent.
function addGitSafeDirectory(dir: string): void {
  const existing = spawnSync("git", ["config", "--global", "--get-all", "safe.directory"], { encoding: "utf8" });
  const lines = (existing.stdout ?? "").split("\n");
  if (!lines.includes(dir)) {
    spawnSync("git", ["config", "--global", "--add", "safe.directory", dir], { stdio: "ignore" });
  }
}

// Local settings + remote URL maintenance. Never rewrites a foreign repo's
// remote: an existing origin whose owner does not match the configured org is
// left alone (ambiguity treated as foreign, safety-first).
function configureGitRepo(dir: string, remoteUrl: string): void {
  addGitSafeDirectory(dir);
  spawnSync("git", ["config", "core.autocrlf", "false"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "core.eol", "lf"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "pull.ff", "only"], { cwd: dir, stdio: "ignore" });
  if (remoteUrl !== "") {
    const current = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", cwd: dir });
    const currentUrl = (current.stdout ?? "").trim();
    if (currentUrl !== "" && !isOrgMember(currentUrl)) {
      logWarn(`configure_git_repo: foreign repo (origin '${currentUrl}') — skipping remote URL rewrite`);
    } else {
      spawnSync("git", ["remote", "set-url", "origin", remoteUrl], { cwd: dir, stdio: "ignore" });
    }
  }
}

function isOrgMember(spec: string): boolean {
  let owner = "";
  try {
    owner = providerRepoSplit(spec).owner;
  } catch {
    // Unparseable origin (local path, non owner/repo form) reads as foreign —
    // the bash repo_url_owner returned non-zero and is_org_member treated
    // that as foreign (safety-first).
    return false;
  }
  return owner !== "" && owner === org;
}

function updateExistingRepo(dir: string, url: string, name: string): number {
  console.error(`Repository '${name}' already exists. Fetching latest changes...`);
  configureGitRepo(dir, url);
  if (git(["fetch", "--all", "--tags", "-f"], dir).status !== 0) return 1;

  const defaultBranch = detectDefaultBranch(dir);
  const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir).out.trim();

  if (git(["status", "--porcelain", "--untracked-files=no"], dir).out.trim() !== "") {
    console.error(`Skipping '${name}': uncommitted changes in the working tree.`);
    return 0;
  }

  if (currentBranch !== defaultBranch) {
    // Fast-forward the local default branch only; one carrying unpushed
    // commits is left alone.
    if (git(["merge-base", "--is-ancestor", defaultBranch, `origin/${defaultBranch}`], dir).status === 0) {
      git(["branch", "-f", defaultBranch, `origin/${defaultBranch}`], dir);
    } else {
      console.error(`Leaving local '${defaultBranch}' of '${name}' as is: it has unpushed commits.`);
    }
    if (git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], dir).status === 0) {
      if (git(["pull", "--rebase"], dir).status !== 0) return 1;
    } else {
      console.error(`Branch '${currentBranch}' of '${name}' has no upstream; not pulling it.`);
    }
  } else if (Number(git(["rev-list", "--count", `origin/${defaultBranch}..HEAD`], dir).out.trim() || "0") > 0) {
    console.error(`Skipping '${name}': unpushed commits on '${defaultBranch}'.`);
    return 0;
  } else {
    if (git(["merge", "--ff-only", `origin/${defaultBranch}`], dir).status !== 0) return 1;
  }

  const updateScript = join(dir, ".repo", "update.sh");
  if (existsSync(updateScript)) {
    console.error(`=> Running update script for ${name}...`);
    if (spawnSync(updateScript, { cwd: dir, stdio: "inherit" }).status !== 0) return 1;
  }
  return 0;
}

function cloneRepo(url: string, dir: string, name: string): number {
  console.error(`Repository '${name}' does not exist. Attempting to clone...`);
  // Explicit returns: --all calls this inside a failure branch — a failed
  // clone must never fall through and run configure/fetch in the caller's
  // directory, reporting success.
  if (git(["clone", url, dir]).status !== 0) return 1;
  configureGitRepo(dir, url);
  if (git(["fetch", "--all", "--tags", "-f"], dir).status !== 0) return 1;
  const initScript = join(dir, ".repo", "init.sh");
  if (existsSync(initScript)) {
    console.error(`=> Running init script for ${name}...`);
    if (spawnSync(initScript, { cwd: dir, stdio: "inherit" }).status !== 0) return 1;
  }
  return 0;
}

if (allMode) {
  const orgRepos = await listOrganizationRepositories(org, 1000);
  const available = filterAvailableRepositories(orgRepos, listLocalRepositories());
  if (available.length === 0) {
    console.error(`All organization repositories are already cloned in ${reposDir}`);
    process.exit(0);
  }
  const failed: string[] = [];
  for (const repo of available) {
    console.error(`==> Cloning ${repo}...`);
    const url = gitTransportUrl(org, repo);
    if (cloneRepo(url, join(reposDir, repo), repo) !== 0) {
      console.error(`WARNING: Failed to clone ${repo}`);
      failed.push(repo);
    }
  }
  if (failed.length > 0) {
    console.error("WARNING: The following repositories could not be cloned:");
    for (const r of failed) console.error(`  ${r}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  console.error("All available repositories cloned successfully.");
  process.exit(0);
}

if (existsSync(targetDir)) {
  process.exit(updateExistingRepo(targetDir, gitUrl, repoName));
} else {
  process.exit(cloneRepo(gitUrl, targetDir, repoName));
}
