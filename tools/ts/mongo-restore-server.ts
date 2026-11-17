// mongo-restore-server — restore a MongoDB backup with a consent gate.
// Port of mongo-restore-server.sh: takes <connection_string>
// <backup_directory>, picks the latest backup folder by greatest
// directory-name timestamp, redacts credentials for display, and requires the
// operator to retype the target (at a terminal, or via --yes plus
// --confirm-target naming it) before the destructive `mongorestore --drop`.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { isInteractive } from "../lib/ui/prompts.ts";
import { requireCommandOrExit } from "../lib/core/commands.ts";
import { writeMongoUriConfig } from "../lib/core/mongo-uri-config.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const USAGE = "Usage: mongo-restore-server <connection_string> <backup_directory> [--yes --confirm-target <target>]";

// The restore target as the operator must retype it: hosts and database, with
// credentials and options removed.
function restoreTarget(uri: string): string {
  const rest = uri.replace(/^[a-zA-Z0-9+.-]+:\/\//, "");
  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "" : rest.slice(slash).split("?")[0] ?? "";
  const hosts = authority.slice(authority.lastIndexOf("@") + 1);
  return `${hosts}${path === "/" ? "" : path}`;
}

let assumeYes = false;
let confirmTarget = "";
let connectionString = "";
let backupDir = "";

try {
  const cli = toolCli({
    name: "mongo-restore-server",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      yes: { type: "boolean", short: "y", default: false },
      "confirm-target": { type: "string" },
    },
  });
  if (cli.common.help) {
    console.log(`Usage: mongo-restore-server <connection_string> <backup_directory> [--yes --confirm-target <target>]

Restore a MongoDB backup. The destructive mongorestore --drop runs only after
the operator retypes the target (hosts and database, shown before the prompt)
at a terminal. Without a terminal, --yes together with --confirm-target <target>
naming that exact target is the only way to proceed.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    -y, --yes                 Consent without a terminal; requires --confirm-target
        --confirm-target T    The exact target being restored into`);
    process.exit(0);
  }
  assumeYes = cli.values["yes"] === true;
  confirmTarget = typeof cli.values["confirm-target"] === "string" ? cli.values["confirm-target"] : "";
  const positionals = cli.positionals;
  if (positionals.length > 2) {
    console.error(`Too many arguments. ${USAGE}`);
    process.exit(EXIT_MISUSE);
  }
  connectionString = positionals[0] ?? "";
  backupDir = positionals[1] ?? "";
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

requireCommandOrExit("mongorestore", undefined, EXIT_GENERAL_ERROR);

if (connectionString === "" || backupDir === "") {
  console.error(USAGE);
  process.exit(EXIT_MISUSE);
}

if (!existsSync(backupDir)) {
  console.error(`Error: Backup directory '${backupDir}' does not exist.`);
  process.exit(EXIT_API_FAILURE);
}

// Pick the latest backup folder. "Latest" means the greatest directory-name
// timestamp (backup-YYYYMMDD...), NOT mtime — mtimes of freshly-created
// backup dirs can tie or invert under load, silently selecting the wrong
// backup.
const subdirs = readdirSync(backupDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `${backupDir}/${e.name}`)
  .sort()
  .reverse();
const latestBackup = subdirs[0] ?? "";

if (latestBackup === "") {
  console.error(`No backup subdirectories found in ${backupDir}.`);
  process.exit(EXIT_API_FAILURE);
}

// Redact credentials from the connection string for display.
// Supports mongodb://user:pass@host:port/db and mongodb+srv://... forms.
const displayUri = connectionString.replace(/(^[a-zA-Z0-9+]+:\/\/)[^/@:]+:[^/@]+@/, "$1***@");

console.log(`Target   : ${displayUri}`);
console.log(`Backup   : ${latestBackup}`);
console.log("Mode     : restore with --drop (existing collections will be REPLACED)");
console.log("");

// Consent gate: the operator retypes the target at a terminal; without a
// terminal, --yes must come with --confirm-target naming that exact target.
// Anything else is refused (never hang, never guess).
const target = restoreTarget(connectionString);
console.log(`Confirm  : ${target}`);
if (assumeYes) {
  if (confirmTarget !== target) {
    console.error(`Refusing destructive restore: --yes requires --confirm-target ${target}`);
    process.exit(EXIT_MISUSE);
  }
} else if (isInteractive()) {
  process.stdout.write(`Retype the target (${target}) to proceed: `);
  const r = spawnSync("bash", ["-c", "read -r answer < /dev/tty; printf '%s' \"$answer\""], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  if ((r.stdout ?? "").trim() !== target) {
    console.error("Aborted: the typed target did not match. Nothing was restored.");
    process.exit(EXIT_GENERAL_ERROR);
  }
} else {
  console.error(`Refusing destructive restore without a terminal: pass --yes --confirm-target ${target}`);
  process.exit(EXIT_MISUSE);
}

console.log(`Restoring backup from: ${latestBackup}`);

// The URI (with credentials) goes through a private config file, not argv.
const uriConfig = writeMongoUriConfig(connectionString);
const r = spawnSync("mongorestore", [`--config=${uriConfig.path}`, "--drop", latestBackup], { stdio: "inherit" });
uriConfig.cleanup();
if (r.status !== 0) {
  console.error("Restore failed. Check the mongorestore output for details.");
  process.exit(EXIT_GENERAL_ERROR);
}

console.log("Restore completed successfully!");
