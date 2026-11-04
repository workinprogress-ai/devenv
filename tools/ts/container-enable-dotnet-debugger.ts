// container-enable-dotnet-debugger — enable debugging support in a Docker
// container for .NET applications: installs vsdbg into /remote_debugger.
// Port of container-enable-dotnet-debugger.sh; docker is exec'd so a PATH
// stub records the calls (the test contract).

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

// A bare invocation reaches this message instead of crashing on the missing
// argument (the bash original guarded ${1:-} for the same reason).
const containerName = process.argv[2];
if (!containerName) {
  console.log("Provide the container name to enable debugging");
  process.exit(1);
}

function dockerExec(args: string[]): void {
  const r = spawnSync("docker", ["exec", containerName!, ...args], { stdio: "inherit" });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}

dockerExec(["mkdir", "-p", "/remote_debugger"]);
dockerExec(["wget", "https://aka.ms/getvsdbgsh", "-O", "/remote_debugger/getvsdbg.sh"]);
dockerExec(["chmod", "a+x", "/remote_debugger/getvsdbg.sh"]);
dockerExec(["/bin/bash", "/remote_debugger/getvsdbg.sh", "-v", "latest", "-l", "/remote_debugger"]);
