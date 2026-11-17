// get-public-ip — retrieve the public IP with resilient fallbacks.
// Port of get-public-ip.sh: three providers tried in order, first success wins.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "get-public-ip",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: get-public-ip

Retrieve the machine's public IP: three providers tried in order, first
success wins. Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  process.exit(EXIT_MISUSE);
}

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
