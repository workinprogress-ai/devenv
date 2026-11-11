// mongo-restore-server — restore a MongoDB backup with a consent gate.
// Port of mongo-restore-server.sh: takes <connection_string>
// <backup_directory> [--yes], optionally picks the latest backup folder by
// greatest directory-name timestamp, redacts credentials for display, and
// requires explicit consent (--yes / YES=1 / interactive y) before the
// destructive `mongorestore --drop`.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { isInteractive } from "../lib/ui/prompts.ts";
import { requireCommandOrExit } from "../lib/core/commands.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";
const USAGE = "Usage: mongo-restore-server <connection_string> <backup_directory> [--yes]";

let assumeYes = false;
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
    },
  });
  if (cli.common.help) {
    console.log(`Usage: mongo-restore-server <connection_string> <backup_directory> [--yes]

Restore a MongoDB backup with a consent gate (--yes / YES=1 / interactive y)
before the destructive mongorestore --drop.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
    -y, --yes                 Skip the consent prompt`);
    process.exit(0);
  }
  assumeYes = cli.values["yes"] === true;
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

// Consent gate: explicit --yes / YES=1, or an interactive confirmation.
// Non-interactive runs without consent are refused (never hang, never guess).
if (!assumeYes && process.env.YES !== "1") {
  if (isInteractive()) {
    process.stdout.write("Proceed with destructive restore? [y/N] ");
    const r = spawnSync("bash", ["-c", "read -r answer < /dev/tty; printf '%s' \"$answer\""], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    });
    const answer = (r.stdout ?? "").trim();
    if (!/^[Yy]$/.test(answer)) {
      console.log("Aborted.");
      process.exit(0);
    }
  } else {
    console.error("Refusing destructive restore without --yes (non-interactive session).");
    process.exit(EXIT_MISUSE);
  }
}

console.log(`Restoring backup from: ${latestBackup}`);

const r = spawnSync("mongorestore", [`--uri=${connectionString}`, "--drop", latestBackup], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("Restore failed. Check the mongorestore output for details.");
  process.exit(EXIT_GENERAL_ERROR);
}

console.log("Restore completed successfully!");
