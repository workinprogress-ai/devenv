// get-services-config — clone a config repository and extract it into the
// local config folder. Port of get-services-config.sh.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: get-services-config [repo-url] [branch]

Clone a configuration repository and extract it into the local config
folder (CONFIG_FOLDER, default $DEVENV_ROOT/.debug/config). An existing
config folder is replaced.

  repo-url   Repository to clone (default: $SERVICES_CONFIG_REPO)
  branch     Branch to check out (default: the repository default)`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv[0] === "-h" || argv[0] === "--help") usage();

const repoUrl = argv[0] ?? process.env.SERVICES_CONFIG_REPO ?? "";
const branch = argv[1] ?? "";
const targetFolder = process.env.CONFIG_FOLDER
  ?? join(process.env.DEVENV_ROOT ?? selfRoot(process.cwd()), ".debug", "config");

if (repoUrl === "") {
  logError("No repository URL provided. Set SERVICES_CONFIG_REPO or pass repo-url as argument.");
  console.log("Usage: get-services-config [repo-url] [branch]");
  process.exit(EXIT_MISUSE);
}

if (existsSync(targetFolder)) {
  logInfo(`Removing existing config folder: ${targetFolder}`);
  rmSync(targetFolder, { recursive: true, force: true });
}
mkdirSync(targetFolder, { recursive: true });

logInfo(`Cloning config repository: ${repoUrl}`);
{
  // spawnSync never throws on a failed clone (the old execSync's throw was
  // the failure signal) — the status must be checked explicitly, or a
  // failed clone would "succeed" into an empty config folder.
  const r = spawnSync("git", ["clone", repoUrl, targetFolder], { stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0 || r.error !== undefined) {
    logError(`Failed to clone config repository from: ${repoUrl} (${r.stderr?.trim() || r.error?.message || "git clone failed"})`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

if (branch !== "") {
  logInfo(`Checking out branch: ${branch}`);
  const r = spawnSync("git", ["checkout", branch], { cwd: targetFolder, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0 || r.error !== undefined) {
    logError(`Failed to check out branch '${branch}' (${r.stderr?.trim() || r.error?.message || "git checkout failed"})`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

// Remove git and build artifacts.
logInfo("Cleaning up artifacts");
for (const artifact of [".git", ".gitignore", ".husky", ".repo", ".vscode", "node_modules", "scripts"]) {
  rmSync(join(targetFolder, artifact), { recursive: true, force: true });
}

// Create info file with metadata.
const now = new Date().toISOString().replace("T", " ").slice(0, 19);
const lines = [`# Configuration extracted: ${now}`, `# Repository: ${repoUrl}`];
if (branch !== "") lines.push(`# Branch: ${branch}`);
writeFileSync(join(targetFolder, "info.txt"), `${lines.join("\n")}\n`);

// Create template for environment overrides if not present.
const defaultEnv = join(targetFolder, "default.env");
if (!existsSync(defaultEnv)) {
  writeFileSync(defaultEnv, [
    "# Local environment overrides for services configuration",
    "DICTIONARY_SERVER=localhost:6379",
    "DOCUMENT_SERVER=mongodb://localhost",
    "MESSAGE_BROKER_SERVER=nats://localhost:4222",
    "",
  ].join("\n"));
}

logSuccess(`Services config refreshed from: ${repoUrl}`);
logInfo(`Config location: ${targetFolder}`);
logInfo(`Environment overrides template: ${defaultEnv}`);
