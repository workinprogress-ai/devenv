// get-services-config — clone a config repository and extract it into the
// local config folder.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: get-services-config [repo-url] [branch]

Clone a configuration repository and extract it into the local config
folder (CONFIG_FOLDER, default $DEVENV_ROOT/.debug/config). An existing
config folder is replaced; CONFIG_FOLDER must be an absolute path that is
not / or the home directory (or an ancestor), and an existing folder must
be a git working tree, an empty directory or a previously extracted config.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

  repo-url   Repository to clone (default: $SERVICES_CONFIG_REPO)
  branch     Branch to check out (default: the repository default)`);
  process.exit(0);
}

let repoUrl = "";
let branch = "";
try {
  const cli = toolCli({
    name: "get-services-config",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length > 2) {
    logError("Too many arguments: at most repo-url and branch");
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }
  repoUrl = cli.positionals[0] ?? process.env.SERVICES_CONFIG_REPO ?? "";
  branch = cli.positionals[1] ?? "";
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const configuredFolder = process.env.CONFIG_FOLDER
  ?? join(process.env.DEVENV_ROOT ?? selfRoot(import.meta.url), ".debug", "config");

if (repoUrl === "") {
  logError("No repository URL provided. Set SERVICES_CONFIG_REPO or pass repo-url as argument.");
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

function refuseFolder(reason: string): never {
  logError(`Refusing to use config folder '${configuredFolder}': ${reason}`);
  console.error("Set CONFIG_FOLDER to a dedicated, absolute folder path");
  process.exit(EXIT_MISUSE);
}

// The folder is replaced wholesale, so it must be unmistakably a config
// folder: absolute, not the home directory or any ancestor of it, and — when
// it exists — a git working tree, an empty directory, or the output of an
// earlier run of this tool (recognised by the metadata file it writes).
function validateTargetFolder(): string {
  if (!isAbsolute(configuredFolder)) refuseFolder("it is not an absolute path");
  const folder = resolve(configuredFolder);
  const home = resolve(homedir());
  if (folder === "/" || home === folder || home.startsWith(`${folder}/`)) {
    refuseFolder("it is the home directory or one of its ancestors");
  }
  let stat;
  try {
    stat = lstatSync(folder);
  } catch {
    return folder; // does not exist yet: it will be created
  }
  if (!stat.isDirectory()) refuseFolder("it exists and is not a directory");
  if (existsSync(join(folder, ".git")) || readdirSync(folder).length === 0) return folder;
  try {
    if (readFileSync(join(folder, "info.txt"), "utf8").startsWith("# Configuration extracted:")) return folder;
  } catch {
    // no metadata file: not this tool's output
  }
  refuseFolder("it exists and is neither a git working tree, an empty directory nor a previously extracted config");
}

const targetFolder = validateTargetFolder();

// Everything is built in a staging folder beside the target; the existing
// config is only replaced once a complete new one is in hand, so a failed
// clone or checkout leaves local config untouched.
const staging = `${targetFolder}.new-${process.pid}`;

function failAndCleanUp(message: string): never {
  rmSync(staging, { recursive: true, force: true });
  logError(message);
  process.exit(EXIT_GENERAL_ERROR);
}

mkdirSync(dirname(targetFolder), { recursive: true });
rmSync(staging, { recursive: true, force: true });

logInfo(`Cloning config repository: ${repoUrl}`);
{
  // spawnSync never throws on a failed clone (the old execSync's throw was
  // the failure signal) — the status must be checked explicitly, or a
  // failed clone would "succeed" into an empty config folder.
  const r = spawnSync("git", ["clone", "--", repoUrl, staging], { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0 || r.error !== undefined) {
    failAndCleanUp(`Failed to clone config repository from: ${repoUrl} (${r.stderr?.trim() || r.error?.message || "git clone failed"})`);
  }
}

if (branch !== "") {
  logInfo(`Checking out branch: ${branch}`);
  const r = spawnSync("git", ["checkout", branch], { cwd: staging, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0 || r.error !== undefined) {
    failAndCleanUp(`Failed to check out branch '${branch}' (${r.stderr?.trim() || r.error?.message || "git checkout failed"})`);
  }
}

// Remove git and build artifacts.
logInfo("Cleaning up artifacts");
for (const artifact of [".git", ".gitignore", ".husky", ".repo", ".vscode", "node_modules", "scripts"]) {
  rmSync(join(staging, artifact), { recursive: true, force: true });
}

// Create info file with metadata.
const now = new Date().toISOString().replace("T", " ").slice(0, 19);
const lines = [`# Configuration extracted: ${now}`, `# Repository: ${repoUrl}`];
if (branch !== "") lines.push(`# Branch: ${branch}`);
writeFileSync(join(staging, "info.txt"), `${lines.join("\n")}\n`);

// Create template for environment overrides if not present.
if (!existsSync(join(staging, "default.env"))) {
  writeFileSync(join(staging, "default.env"), [
    "# Local environment overrides for services configuration",
    "DICTIONARY_SERVER=localhost:6379",
    "DOCUMENT_SERVER=mongodb://localhost",
    "MESSAGE_BROKER_SERVER=nats://localhost:4222",
    "",
  ].join("\n"));
}

// Swap: the old folder is set aside, the new one moved in; a failed move
// puts the old one back before anything is deleted.
const previous = `${targetFolder}.old-${process.pid}`;
const hadPrevious = existsSync(targetFolder);
try {
  if (hadPrevious) {
    logInfo(`Replacing existing config folder: ${targetFolder}`);
    renameSync(targetFolder, previous);
  }
  renameSync(staging, targetFolder);
} catch (err) {
  if (hadPrevious && existsSync(previous) && !existsSync(targetFolder)) renameSync(previous, targetFolder);
  failAndCleanUp(`Failed to install the new config folder (${errorMessage(err)}); the existing config was kept`);
}
if (hadPrevious) rmSync(previous, { recursive: true, force: true });

const defaultEnv = join(targetFolder, "default.env");
logSuccess(`Services config refreshed from: ${repoUrl}`);
logInfo(`Config location: ${targetFolder}`);
logInfo(`Environment overrides template: ${defaultEnv}`);
