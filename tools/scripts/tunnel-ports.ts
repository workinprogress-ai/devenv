// tunnel-ports — open SSH local port-forwards and hold until a keypress.
// Port of tunnel-ports.sh: spawns detached ssh -NTC -L tunnels, reports PIDs,
// waits for one keypress, then closes them all.

import { spawn, spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

function usage(): never {
  console.log("Usage: tunnel-ports [-p <ssh port>] [-i <path to ssh key>] <user@target> <port1:destination1> [<port2:destination2> ...]");
  process.exit(1);
}

const argv = process.argv.slice(2);

let sshPort = "22";
let sshCert = "";

if (argv[0] === "-p") {
  sshPort = argv[1] ?? "";
  if (sshPort === "") usage();
  argv.splice(0, 2);
}
if (argv[0] === "-i") {
  sshCert = argv[1] ?? "";
  if (sshCert === "") usage();
  argv.splice(0, 2);
}

const target = argv[0];
if (target === undefined || target === "") usage();
const tunnels = argv.slice(1);
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
