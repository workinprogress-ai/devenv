// get-public-ip — retrieve the public IP with resilient fallbacks.
// Port of get-public-ip.sh: three providers tried in order, first success wins.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const providers = [
  "https://ipinfo.io/ip",
  "https://api.ipify.org",
  "https://ifconfig.me",
];

for (const url of providers) {
  const r = spawnSync("curl", ["-fsSL", url], { encoding: "utf8" });
  if (r.status === 0 && r.stdout) {
    console.log(r.stdout.trimEnd());
    process.exit(0);
  }
}

process.stderr.write("Unable to determine public IP\n");
process.exit(1);
