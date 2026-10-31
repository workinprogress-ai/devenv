// mongo-backup-server — back up every non-built-in MongoDB database.
// Port of mongo-backup-server.sh: list databases via mongosh, validate
// names (built-ins skipped; a malformed name aborts loudly), then mongodump
// each database into a timestamped subfolder. A failed dump is non-zero.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

function requireCommand(cmd: string): void {
  try {
    execFileSync("bash", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
  } catch {
    console.error(`Error: required command not found: ${cmd}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

requireCommand("mongodump");
requireCommand("mongosh");

if (process.argv.length !== 4) {
  console.error("Usage: mongo-backup-server <connection_string> <backup_directory>");
  process.exit(EXIT_MISUSE);
}
const connectionString = process.argv[2] as string;
const backupDir = process.argv[3] as string;

mkdirSync(backupDir, { recursive: true });

// Unique timestamped subfolder in local time (the bash original's
// `date +%Y%m%d_%H%M%S` was local; UTC here produced folder names that
// drift from the operator's wall clock).
const now = new Date();
const pad = (n: number): string => String(n).padStart(2, "0");
const timestamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const outputDir = join(backupDir, timestamp);
mkdirSync(outputDir, { recursive: true });

console.log("Listing non-built-in databases from the MongoDB cluster...");

// Run mongosh to a temp file and capture its exit code directly: a mongosh
// failure must abort, not feed warnings/failures into the backup loop as
// database names.
const listDir = mkdtempSync(join(tmpdir(), "mongobackup-"));
const listFile = join(listDir, "dbs.txt");
let listRc: number;
{
  const r = spawnSync(
    "bash",
    [
      "-c",
      'mongosh "$1" --quiet --eval "var dbs = db.adminCommand(\'listDatabases\'); dbs.databases.forEach(function(d) { print(d.name); });" > "$2"',
      "mongosh",
      connectionString,
      listFile,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  listRc = r.status ?? 1;
}

if (listRc !== 0) {
  rmSync(listDir, { recursive: true, force: true });
  console.error("Error: failed to list databases from the cluster (mongosh exited non-zero).");
  process.exit(EXIT_API_FAILURE);
}

// Filter and validate: built-ins are skipped; anything that is not a legal
// database name aborts the whole backup (a partial backup that looks
// complete is worse than a loud failure).
const databases: string[] = [];
for (const line of readFileSync(listFile, "utf8").split("\n")) {
  const name = line.trim();
  if (name === "") continue;
  if (name === "admin" || name === "local" || name === "config") {
    console.log(`Skipping built-in database: ${name}`);
    continue;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    rmSync(listDir, { recursive: true, force: true });
    console.error(`Error: mongosh returned an invalid database name: '${name}' — aborting backup.`);
    process.exit(EXIT_API_FAILURE);
  }
  databases.push(name);
}
rmSync(listDir, { recursive: true, force: true });

if (databases.length === 0) {
  console.error("Error: no non-built-in databases found to back up.");
  process.exit(EXIT_API_FAILURE);
}

console.log(`Found databases: ${databases.join(" ")}`);

// Back up each database individually; a failed dump aborts the backup (the
// completed dumps stay on disk, the failure is reported non-zero).
for (const db of databases) {
  console.log(`Backing up database: ${db}`);
  const r = spawnSync("mongodump", [`--uri=${connectionString}`, "--db", db, "--out", outputDir], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`Error: Backup failed for database: ${db}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

console.log(`Backup completed! Your backup is stored in: ${outputDir}`);
