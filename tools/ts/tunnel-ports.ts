// tunnel-ports — open SSH local port-forwards and hold until a keypress.
// Port of tunnel-ports.sh: spawns detached ssh -NTC -L tunnels, reports PIDs,
// waits for one keypress, then closes them all.

import { spawn, spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: tunnel-ports [-p <ssh port>] [-i <path to ssh key>] <user@target> <port1:destination1> [<port2:destination2> ...]

Open SSH local port-forwards and hold until a keypress, then close them all.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}
  -p <ssh port>          SSH port (default: 22)
  -i <ssh key path>      Path to the SSH key`);
  process.exit(1);
}

let sshPort = "22";
let sshCert = "";
let target = "";
let tunnelArgs: string[] = [];
try {
  const cli = toolCli({
    name: "tunnel-ports",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      p: { type: "string" },
      i: { type: "string" },
    },
  });
  if (cli.common.help) {
    // Bash parity: usage exits 1 (it is also the missing-argument refusal).
    usage();
  }
  sshPort = typeof cli.values.p === "string" && cli.values.p !== "" ? cli.values.p : "22";
  sshCert = typeof cli.values.i === "string" ? cli.values.i : "";
  target = cli.positionals[0] ?? "";
  tunnelArgs = cli.positionals.slice(1);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  usage();
}

if (target === "") usage();
const tunnels = tunnelArgs;
if (tunnels.length === 0) usage();

const children: ReturnType<typeof spawn>[] = [];

function cleanup(): void {
  for (const child of children) {
    console.log(`Closing tunnel: SSH Process ID ${child.pid}`);
    try {
      process.kill(child.pid as number);
    } catch { /* already gone */ }
  }
}

process.on("SIGINT", () => {
  console.log("\n\nJeeesh... all you had to do was hit any key, not hit me with a control-C.  ¯\\_(ツ)_/¯   Whatever... cleaning up anyway...\n");
  cleanup();
  process.exit(130);
});

for (const t of tunnels) {
  const sep = t.indexOf(":");
  if (sep < 0) usage();
  const port = t.slice(0, sep);
  const destination = t.slice(sep + 1);
  console.log(`Opening tunnel: Local port ${port} to ${destination} through ${target}`);
  const args = [
    "-NTC",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-L", `${port}:${destination}:${port}`,
    "-p", sshPort,
    target as string,
  ];
  if (sshCert !== "") args.splice(0, 0, "-i", sshCert);
  children.push(spawn("ssh", args, { stdio: "ignore", detached: false }));
}

console.log("Tunnels open...");
for (const c of children) console.log(` - SSH Process ID: ${c.pid}`);

// Wait for any keypress (raw single-char read — bash `read -n 1 -s`).
console.log("Press any key to close the tunnels...\n");
try {
  spawnSync("bash", ["-c", "read -n 1 -s -r"], { stdio: "inherit" });
} catch { /* stdin closed — proceed to cleanup */ }

cleanup();
console.log("Tunnels closed.");
