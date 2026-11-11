// dependencies-down — stop and remove development dependency containers.
// Port of dependencies-down.sh: a single docker compose pass-through.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { resolveToolsRoot } from "../lib/core/self-root.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "dependencies-down",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: dependencies-down

Stop and remove the development dependency containers (docker compose down
on the dependencies compose file). Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(errorMessage(err));
  process.exit(EXIT_MISUSE);
}

const composeFile = join(resolveToolsRoot(import.meta.url), "other", "docker-compose-dependencies.yml");
const r = spawnSync("docker", ["compose", "-f", composeFile, "down"], { stdio: "inherit" });
process.exit(r.status ?? 1);
