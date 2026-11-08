// docker-restart — restart the Docker daemon by killing it and reloading it.
// Port of docker-restart.sh: sudo pkill, then the load-docker bootstrap script.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { resolveToolsRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

try {
  const cli = toolCli({
    name: "docker-restart",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) {
    console.log(`Usage: docker-restart

Restart the Docker daemon: stop it (sudo pkill) and reload it via the
devcontainer load-docker script. Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

const root = dirname(dirname(resolveToolsRoot(import.meta.url)));

console.log("Stopping Docker daemon...");
const kill = spawnSync("sudo", ["pkill", "docker"], { stdio: "inherit" });
if (kill.status !== 0 && kill.error === undefined) {
  // pkill exits 1 when nothing matched — the daemon may already be down; the
  // reload below still brings it up, so this is not fatal (bash set -e did
  // abort here; the reload path makes continuing the safer port).
}

console.log("Restarting Docker daemon...");
const load = spawnSync(join(root, ".devcontainer", "load-docker.sh"), {
  stdio: "inherit",
});
if ((load.status ?? 1) !== 0) process.exit(load.status ?? 1);

console.log("Docker daemon restart complete.");
