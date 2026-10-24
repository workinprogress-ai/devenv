// server-run-sql — run (or start) a local SQL Server container.
// Port of server-run-sql.sh: start the existing sqlserver container when
// present, otherwise run a new azure-sql-edge container, wait, and create
// the test database. Prints the sqlcmd connect line.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const debug = join(process.env.DEVENV_ROOT ?? selfRoot(process.cwd()), ".debug");
const containerName = "sqlserver";
// Use Azure SQL Edge for ARM compatibility.
const image = "mcr.microsoft.com/azure-sql-edge:1.0.3";
const dataDir = join(debug, "data", "local", "sqlserver");
const password = "1Passw0rd";

// Ensure data directory exists (permissions note preserved from bash: the
// mssql user adjustment was already commented out there).
const mkdir = spawnSync("sudo", ["mkdir", "-p", dataDir], { stdio: "inherit" });
if (mkdir.status !== 0) process.exit(mkdir.status ?? 1);

// Stop-and-remove was commented out in the bash original: an existing
// container is started, not recreated.
const ps = spawnSync("docker", ["ps", "-a", "--format", "{{.Names}}"], { encoding: "utf8" });
const exists = (ps.stdout ?? "").split("\n").some((n) => n.trim() === containerName);

if (exists) {
  console.log("Starting existing container...");
  spawnSync("docker", ["start", containerName], { stdio: ["ignore", "ignore", "inherit"] });
} else {
  console.log("Running new SQL Server container...");
  const r = spawnSync(
    "docker",
    [
      "run", "--user", "root", "--name", containerName,
      "-e", "ACCEPT_EULA=Y",
      "-e", `MSSQL_SA_PASSWORD=${password}`,
      "-p", "1433:1433",
      "-v", `${dataDir}:/var/opt/mssql`,
      "-d", image,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);

  console.log("Waiting for SQL Server to be ready...");
  spawnSync("sleep", ["10"]);

  console.log("Creating database 'test'...");
  const create = spawnSync(
    "docker",
    ["exec", "-i", containerName, "/opt/mssql-tools/bin/sqlcmd", "-S", "localhost", "-U", "SA", "-P", password, "-Q", "CREATE DATABASE test;"],
    { stdio: "inherit" },
  );
  if (create.status !== 0) process.exit(create.status ?? 1);
}

console.log(`Connect using: sqlcmd -S localhost -U SA -P '${password}'`);
