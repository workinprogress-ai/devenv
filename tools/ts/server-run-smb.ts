// server-run-smb — run (or start) a local Samba (SMB) container.
// Port of server-run-smb.sh: start the existing samba_server container when
// present, otherwise run a new dockurr/samba container with the Data share,
// then print the smbclient connect line.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "server-run-smb",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: server-run-smb

Run (or start) a local Samba (SMB) container: start the existing
samba_server container when present, otherwise run a new dockurr/samba
container with the Data share, then print the smbclient connect line.
Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  process.exit(2);
}

const debug = join(process.env.DEVENV_ROOT ?? selfRoot(import.meta.url), ".debug");
const containerName = "samba_server";
const image = "dockurr/samba";
const share = "Data";
const dataDir = join(debug, "smb-server", "local");
const username = "devenv";
const password = "devenv123";

// Ensure files directory exists.
const mkdir = spawnSync("sudo", ["mkdir", "-p", dataDir], { stdio: "inherit" });
if (mkdir.status !== 0) process.exit(mkdir.status ?? 1);

const ps = spawnSync("docker", ["ps", "-a", "--format", "{{.Names}}"], { encoding: "utf8" });
const exists = (ps.stdout ?? "").split("\n").some((n) => n.trim() === containerName);

if (exists) {
  console.log("Starting existing container...");
  spawnSync("docker", ["start", containerName], { stdio: ["ignore", "ignore", "inherit"] });
} else {
  console.log("Running new SMB Server container...");
  const r = spawnSync(
    "docker",
    [
      "run", "--user", "root", "--name", containerName,
      "-e", `NAME=${share}`,
      "-e", `USER=${username}`,
      "-e", `PASS=${password}`,
      "-p", "445:445",
      "-v", `${dataDir}:/storage`,
      "-d", image,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);

  console.log("Waiting for SMB Server to be ready...");
  spawnSync("sleep", ["10"]);
}

console.log(`Connect using: smbclient //127.0.0.1/${share} -U '${username}%${password}'`);
