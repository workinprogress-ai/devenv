// mongo-restore-server — restore a MongoDB backup with a consent gate.
// Port of mongo-restore-server.sh: takes <connection_string>
// <backup_directory> [--yes], optionally picks the latest backup folder by
// greatest directory-name timestamp, redacts credentials for display, and
// requires explicit consent (--yes / YES=1 / interactive y) before the
// destructive `mongorestore --drop`.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { isInteractive } from "../lib/ui/prompts.ts";

assertNodeFloor();

function requireCommand(cmd: string): void {
  const r = spawnSync("bash", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
  if (r.status !== 0) {
    console.error(`Error: required command not found: ${cmd}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

requireCommand("mongorestore");

let assumeYes = false;
let connectionString = "";
let backupDir = "";

for (const a of process.argv.slice(2)) {
  if (a === "--yes" || a === "-y") {
    assumeYes = true;
  } else if (a.startsWith("-")) {
    console.error(`Unknown option: ${a}. Usage: mongo-restore-server <connection_string> <backup_directory> [--yes]`);
    process.exit(EXIT_MISUSE);
  } else if (connectionString === "") {
    connectionString = a;
  } else if (backupDir === "") {
    backupDir = a;
  } else {
    console.error("Too many arguments. Usage: mongo-restore-server <connection_string> <backup_directory> [--yes]");
    process.exit(EXIT_MISUSE);
  }
}

if (connectionString === "" || backupDir === "") {
  console.error("Usage: mongo-restore-server <connection_string> <backup_directory> [--yes]");
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
