// dependencies-up — start development dependency containers.
// Port of dependencies-up.sh: a single docker compose pass-through.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { resolveToolsRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "dependencies-up",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: dependencies-up

Start the development dependency containers (docker compose up on the
dependencies compose file). Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

const composeFile = join(resolveToolsRoot(import.meta.url), "other", "docker-compose-dependencies.yml");
const r = spawnSync("docker", ["compose", "-f", composeFile, "up"], { stdio: "inherit" });
process.exit(r.status ?? 1);
