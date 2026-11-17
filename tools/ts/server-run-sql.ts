// server-run-sql — run (or start) a local SQL Server container.
// Port of server-run-sql.sh: start the existing sqlserver container when
// present, otherwise run a new azure-sql-edge container, wait, and create
// the test database. Prints the sqlcmd connect line.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { resolveSecret } from "../lib/core/secret.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "server-run-sql",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: server-run-sql

Run (or start) a local SQL Server container: start the existing sqlserver
container when present, otherwise run a new azure-sql-edge container,
wait until it accepts connections, and create the test database. The port is
published on 127.0.0.1 only. Prints the sqlcmd connect line.
Takes no arguments.

The SA password comes from the SQL_SA_PASSWORD environment variable, or is
prompted for (hidden) at a terminal when it is not set. It must satisfy SQL
Server's complexity rules (8+ characters, three of four character classes).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  process.exit(EXIT_MISUSE);
}

const debug = join(process.env.DEVENV_ROOT ?? selfRoot(import.meta.url), ".debug");
const containerName = "sqlserver";
// Use Azure SQL Edge for ARM compatibility.
const image = "mcr.microsoft.com/azure-sql-edge:1.0.3";
const READY_ATTEMPTS = 30;
const READY_PAUSE_SECONDS = "2";
const dataDir = join(debug, "data", "local", "sqlserver");

// SQL Server rejects an SA password that is shorter than 8 characters or has
// fewer than three of the four character classes; the container would start
// and then fail to come up, so the rule is checked before docker is touched.
function passwordRuleViolation(value: string): string | null {
  if (value.length < 8) return "must be at least 8 characters";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length;
  return classes < 3 ? "must use at least three of: lowercase, uppercase, digits, symbols" : null;
}

// The password is needed on every run: a new container is created with it and
// the readiness poll and database creation authenticate with it.
function requirePassword(): string {
  const value = resolveSecret("SQL_SA_PASSWORD", "SQL Server SA password");
  if (value === null) {
    console.error("SQL_SA_PASSWORD is not set and there is no terminal to ask on.");
    process.exit(EXIT_MISUSE);
  }
  const violation = passwordRuleViolation(value);
  if (violation !== null) {
    console.error(`SQL_SA_PASSWORD ${violation} (SQL Server complexity rules).`);
    process.exit(EXIT_MISUSE);
  }
  return value;
}

const password = requirePassword();
// The password reaches docker through its environment (`-e NAME` with no
// value), so it never appears on a command line.
const secretEnv = { ...process.env, MSSQL_SA_PASSWORD: password, SQLCMDPASSWORD: password };

// Ensure data directory exists (permissions note preserved from bash: the
// mssql user adjustment was already commented out there).
const mkdir = spawnSync("sudo", ["mkdir", "-p", dataDir], { stdio: "inherit" });
if (mkdir.status !== 0) process.exit(mkdir.status ?? 1);

// Stop-and-remove was commented out in the bash original: an existing
// container is started, not recreated.
const ps = spawnSync("docker", ["ps", "-a", "--format", "{{.Names}}"], { encoding: "utf8" });
// A failed lookup says nothing about the container, so it is never read as
// "no container": nothing is created or removed on a guess.
if (ps.error || ps.status !== 0) {
  console.error(`Could not list docker containers (docker ps failed${ps.status === null ? "" : ` with status ${ps.status}`}); leaving any existing container untouched.`);
  process.exit(EXIT_GENERAL_ERROR);
}
const exists = (ps.stdout ?? "").split("\n").some((n) => n.trim() === containerName);

// Set once this run's `docker run` has succeeded: only then is the container
// ours to remove.
let createdByThisRun = false;

// Exit non-zero; a container created by this run is removed first so a later
// run does not find a half-initialised container and report success. A
// container this run did not create is never removed.
function fail(code: number, removeContainer: boolean): never {
  if (removeContainer && createdByThisRun) spawnSync("docker", ["rm", "-f", containerName], { stdio: ["ignore", "ignore", "inherit"] });
  process.exit(code);
}

if (exists) {
  console.log("Starting existing container...");
  const started = spawnSync("docker", ["start", containerName], { stdio: ["ignore", "ignore", "inherit"] });
  if (started.status !== 0) fail(started.status ?? 1, false);
} else {
  console.log("Running new SQL Server container...");
  const r = spawnSync(
    "docker",
    [
      "run", "--user", "root", "--name", containerName,
      "-e", "ACCEPT_EULA=Y",
      "-e", "MSSQL_SA_PASSWORD",
      "-p", "127.0.0.1:1433:1433",
      "-v", `${dataDir}:/var/opt/mssql`,
      "-d", image,
    ],
    { stdio: "inherit", env: secretEnv },
  );
  if (r.status !== 0) fail(r.status ?? 1, false);
  createdByThisRun = true;
}

// Poll until the server answers instead of sleeping a fixed time; creating
// the database before it is ready fails and would never be retried. -b makes
// sqlcmd exit non-zero when the statement itself fails.
const sqlcmd = (query: string): number =>
  spawnSync(
    "docker",
    ["exec", "-i", "-e", "SQLCMDPASSWORD", containerName, "/opt/mssql-tools/bin/sqlcmd", "-b", "-S", "localhost", "-U", "SA", "-Q", query],
    { stdio: "inherit", env: secretEnv },
  ).status ?? 1;
console.log("Waiting for SQL Server to be ready...");
let ready = false;
for (let attempt = 0; attempt < READY_ATTEMPTS && !ready; attempt++) {
  ready = sqlcmd("SELECT 1") === 0;
  if (!ready) spawnSync("sleep", [READY_PAUSE_SECONDS]);
}
if (!ready) {
  console.error(
    "SQL Server did not become ready in time. Besides a slow start, the usual cause is an SA password that " +
      `differs from the one stored in the existing data in ${dataDir} (SQL Server keeps it in master, so login fails until the data directory is cleared or the original password is used).`,
  );
  fail(EXIT_GENERAL_ERROR, !exists);
}

// Idempotent, so a re-run against an existing container is safe.
console.log("Creating database 'test' if missing...");
const create = sqlcmd("IF DB_ID('test') IS NULL CREATE DATABASE test;");
if (create !== 0) fail(create, !exists);

console.log("Connect using: sqlcmd -S 127.0.0.1 -U SA   (set SQLCMDPASSWORD to the SA password)");
