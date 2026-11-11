#!/usr/bin/env node
// repo-get.ts - Clone or update a repository from the organization
// Version: 1.2.0
// Description: repo-get <name> clones/updates a specific repo; --select picks
//              interactively; --all clones every org repo not present locally;
//              no argument updates the current repo via its git context. A
//              foreign URL (https://, git@, ssh://, *.git) clones flat into
//              repos/ by its sanitized basename. The repository's own
//              .repo/init.sh and .repo/update.sh run only for org-owned
//              origins, or anywhere under an explicit --run-scripts.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCapture, gitCheck } from "../lib/core/git.ts";
import { logError, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { providerOrgGet, providerRepoSplit } from "../lib/providers/provider-core.ts";
import { gitTransportUrl, authStatusOk, remoteToSpec } from "../lib/providers/facade/urls.ts";
import { reposList } from "../lib/providers/facade/repos.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.2.0";

const devenvRoot = process.env.DEVENV_ROOT ?? "";
const reposDir = join(devenvRoot, "repos");

// The workspace gate runs after argument parsing: --help, --version and
// misuse need neither a workspace nor the provider.
function requireWorkspace(): void {
  if (devenvRoot === "") {
    console.error("ERROR: DEVENV_ROOT is not established");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!existsSync(reposDir)) mkdirSync(reposDir, { recursive: true });
}

const USAGE_TEXT = `Usage: repo-get [--select|--all] [<repository-name>|<repository-url>]

Clone or update a repository from the organization.

  --select            Show a selection list of repositories in the organization
                      (excludes already cloned repos)
  --all               Clone all repositories in the organization not already
                      present locally
  repository-name     Name of the GitHub repository (alphanumeric, hyphens, dots)
  repository-url      Full URL to a foreign repository (https:// or git@);
                      cloned flat into repos/ by its basename
  --run-scripts       Run the repository's .repo/init.sh and .repo/update.sh
                      even when its origin is not owned by the organization
                      (they always run for org-owned origins; a foreign
                      repository's scripts are arbitrary code, so they are
                      skipped unless you ask)

Updating a branch other than the default one only fast-forwards it; a branch
that cannot be fast-forwarded is skipped with a message (never rebased).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`;

function printUsage(out: (line: string) => void = console.error): void {
  out(USAGE_TEXT);
}

// A usage error is misuse: hint on stderr, exit 2. Requested help is
// stdout / exit 0 and never reaches this function.
function usage(): never {
  printUsage();
  process.exit(EXIT_MISUSE);
}

function git(args: string[], cwd?: string): { status: number; out: string } {
  return gitCapture(cwd ?? null, args);
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

// --- mode resolution -------------------------------------------------------

let selectMode = false;
let allMode = false;
let repoName = "";
let foreignUrl = "";
let runScriptsFlag = false;

try {
  // A single-dash first token that is not a known flag (e.g. '-repo') is a
  // malformed repository name, not an option: it goes straight to name
  // validation, which reports 'Invalid repository name' (misuse). Every other
  // unknown option is rejected by the strict parse below.
  const rawFirst = process.argv[2] ?? "";
  const KNOWN_FLAGS = new Set(["--select", "--all", "--help", "-h", "-v", "--version", "-V", "--verbose", "--devenv", "--"]);
  if (rawFirst.startsWith("-") && !rawFirst.startsWith("--") && !KNOWN_FLAGS.has(rawFirst)) {
    const input = rawFirst.replace(/\/$/, "");
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
  } else {
  const cli = toolCli({
    name: "repo-get",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      select: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      "run-scripts": { type: "boolean", default: false },
    },
  });
  if (cli.common.help) {
    printUsage(console.log);
    process.exit(0);
  }
  selectMode = cli.values.select === true;
  runScriptsFlag = cli.values["run-scripts"] === true;
  if (cli.values.all === true) {
    allMode = true;
  }
  const nameArg = cli.positionals[0] ?? "";
  if (cli.positionals.length > 1) {
    logError("Too many arguments: expected one repository name or URL");
    usage();
  }
  if (selectMode || allMode) {
    if (nameArg !== "") {
      logError("A repository name/URL cannot combine with --select/--all");
      usage();
    }
  } else if (nameArg === "") {
    requireWorkspace();
    const root = git(["rev-parse", "--show-toplevel"]);
    repoName = root.status === 0 ? (root.out.trim().split("/").pop() ?? "") : "";
    if (repoName === "" || repoName === "devenv" || !existsSync(join(reposDir, repoName))) {
      usage();
    }
  } else {
    const input = nameArg.replace(/\/$/, "");
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
  }
} catch (err) {
  logError(errorMessage(err));
  usage();
}

// Workspace, org identity and provider auth gates (same order as the bash
// script's flow), after argument parsing so help and misuse stay offline.
requireWorkspace();
const org = providerOrgGet();
if (org === "") process.exit(EXIT_GENERAL_ERROR);
if (!(await authStatusOk())) {
  console.error("ERROR: provider CLI is not authenticated. Run 'key-update-provider' first.");
  process.exit(EXIT_GENERAL_ERROR);
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
  const { multiSelect } = await import("../lib/ui/prompts.ts");
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
      // Fast-forward only: a rebase could stop mid-way and leave the clone half rewritten.
      if (git(["pull", "--ff-only"], targetDir).status !== 0) {
        console.error(`Skipping the pull of '${repoName}': branch '${currentBranch}' cannot be fast-forwarded (diverged, or no upstream); update it by hand.`);
      }
    } else {
      if (git(["pull", "--ff-only"], targetDir).status !== 0) process.exit(EXIT_GENERAL_ERROR);
    }
  } else {
    console.error(`Cloning foreign repository '${repoName}' from ${gitUrl}...`);
    if (git(["clone", "--", gitUrl, targetDir]).status !== 0) process.exit(EXIT_GENERAL_ERROR);
  }
  const scriptsAllowed = runScriptsFlag || (await isOrgMember(gitUrl));
  const updateSh = join(targetDir, ".repo", "update.sh");
  if (existsSync(updateSh) && !scriptsAllowed) {
    console.error(`Skipping .repo/update.sh of '${repoName}': origin is not org-owned (pass --run-scripts to run it).`);
  } else if (existsSync(updateSh)) {
    console.error(`=> Running update script for ${repoName}...`);
    if (spawnSync(updateSh, { cwd: targetDir, stdio: "inherit" }).status !== 0) process.exit(EXIT_GENERAL_ERROR);
  }
  const initSh = join(targetDir, ".repo", "init.sh");
  const inited = join(targetDir, ".repo", ".inited");
  if (existsSync(initSh) && !existsSync(inited) && !scriptsAllowed) {
    console.error(`Skipping .repo/init.sh of '${repoName}': origin is not org-owned (pass --run-scripts to run it).`);
  } else if (existsSync(initSh) && !existsSync(inited)) {
    console.error(`=> Running init script for ${repoName}...`);
    if (spawnSync(initSh, { cwd: targetDir, stdio: "inherit" }).status !== 0) process.exit(EXIT_GENERAL_ERROR);
  }
  console.error("Foreign repository operation completed successfully.");
  process.exit(0);
}

// --- org mode --------------------------------------------------------------

let gitUrl = "";
if (!allMode) gitUrl = await gitTransportUrl(org, repoName);

function detectDefaultBranch(dir: string): string {
  const ref = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], dir).out.trim();
  const branch = ref.replace(/^origin\//, "");
  if (branch !== "") return branch;
  if (git(["show-ref", "--verify", "--quiet", "refs/heads/main"], dir).status === 0) return "main";
  return "master";
}

// Global safe.directory entry: idempotent.
function addGitSafeDirectory(dir: string): void {
  const existing = gitCheck(null, ["config", "--global", "--get-all", "safe.directory"]);
  const lines = existing.out.split("\n");
  if (!lines.includes(dir)) {
    gitCheck(null, ["config", "--global", "--add", "safe.directory", dir]);
  }
}

// Local settings + remote URL maintenance. Never rewrites a foreign repo's
// remote: an existing origin whose owner does not match the configured org is
// left alone (ambiguity treated as foreign, safety-first).
async function configureGitRepo(dir: string, remoteUrl: string): Promise<void> {
  addGitSafeDirectory(dir);
  gitCheck(dir, ["config", "core.autocrlf", "false"]);
  gitCheck(dir, ["config", "core.eol", "lf"]);
  gitCheck(dir, ["config", "pull.ff", "only"]);
  if (remoteUrl !== "") {
    const current = gitCheck(dir, ["remote", "get-url", "origin"]);
    const currentUrl = current.out.trim();
    if (currentUrl !== "" && !(await isOrgMember(currentUrl))) {
      logWarn(`configure_git_repo: foreign repo (origin '${currentUrl}') — skipping remote URL rewrite`);
    } else {
      gitCheck(dir, ["remote", "set-url", "origin", remoteUrl]);
    }
  }
}

async function isOrgMember(spec: string): Promise<boolean> {
  // Origin URLs arrive in every git form (HTTPS, SSH, with .git, with
  // embedded credentials); providerRepoSplit expects bare owner/repo.
  // Normalize through the provider's remote parser first — an unparseable
  // form stays foreign (safety-first).
  let normalized = "";
  try {
    normalized = (await remoteToSpec(spec)) ?? "";
  } catch {
    return false;
  }
  // An unparseable remote is foreign BY DEFINITION — never fall back to a
  // cwd-derived spec here: providerRepoSplit("") resolves from the working
  // tree's own basename, which would judge the repo against itself and read
  // any local-path origin as an org member.
  if (normalized === "") return false;
  let owner = "";
  try {
    owner = providerRepoSplit(normalized).owner;
  } catch {
    // Unresolvable spec (no DEVENV_REPO, no git context) reads as foreign —
    // safety-first, the same verdict the bash is_org_member gave.
    return false;
  }
  return owner !== "" && owner === org;
}

// Whether the repo's own .repo scripts may run: its origin must be org-owned
// (judged from the origin URL as it stands now), or the caller must have asked.
async function repoScriptsAllowed(dir: string, name: string, script: string): Promise<boolean> {
  if (runScriptsFlag) return true;
  // The configured URL as written (get-url would apply insteadOf rewrites).
  const origin = git(["config", "--get", "remote.origin.url"], dir).out.trim();
  if (origin !== "" && (await isOrgMember(origin))) return true;
  console.error(`Skipping .repo/${script} of '${name}': origin is not org-owned (pass --run-scripts to run it).`);
  return false;
}

async function updateExistingRepo(dir: string, url: string, name: string): Promise<number> {
  console.error(`Repository '${name}' already exists. Fetching latest changes...`);
  await configureGitRepo(dir, url);
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
      // Fast-forward only: a rebase could stop mid-way on a conflict and leave
      // the repository half rewritten, once per repo under repo-update-all.
      if (git(["merge", "--ff-only", "@{upstream}"], dir).status !== 0) {
        console.error(`Skipping '${name}': branch '${currentBranch}' cannot be fast-forwarded to its upstream (local and remote have diverged); update it by hand.`);
        return 0;
      }
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
  if (existsSync(updateScript) && (await repoScriptsAllowed(dir, name, "update.sh"))) {
    console.error(`=> Running update script for ${name}...`);
    if (spawnSync(updateScript, { cwd: dir, stdio: "inherit" }).status !== 0) return 1;
  }
  return 0;
}

async function cloneRepo(url: string, dir: string, name: string): Promise<number> {
  console.error(`Repository '${name}' does not exist. Attempting to clone...`);
  // Explicit returns: --all calls this inside a failure branch — a failed
  // clone must never fall through and run configure/fetch in the caller's
  // directory, reporting success.
  if (git(["clone", "--", url, dir]).status !== 0) return 1;
  await configureGitRepo(dir, url);
  if (git(["fetch", "--all", "--tags", "-f"], dir).status !== 0) return 1;
  const initScript = join(dir, ".repo", "init.sh");
  if (existsSync(initScript) && (await repoScriptsAllowed(dir, name, "init.sh"))) {
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
    const url = await gitTransportUrl(org, repo);
    if ((await cloneRepo(url, join(reposDir, repo), repo)) !== 0) {
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
  process.exit(await updateExistingRepo(targetDir, gitUrl, repoName));
} else {
  process.exit(await cloneRepo(gitUrl, targetDir, repoName));
}
