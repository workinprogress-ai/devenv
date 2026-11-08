// devenv-add-custom-bootstrap — add custom bootstrap commands to
// .devcontainer/user-custom-bootstrap.sh. Port of devenv-add-custom-bootstrap.sh.
// Commands run each time the container is recreated or bootstrap executes.
// Each command is syntax-checked (bash -n) before it is appended.

import { existsSync, mkdirSync, appendFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

const devenvRoot = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
const bootstrapDir = join(devenvRoot, ".devcontainer");
const bootstrapScript = join(bootstrapDir, "user-custom-bootstrap.sh");

let commands: string[] = [];
try {
  const cli = toolCli({
    name: "devenv-add-custom-bootstrap",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) {
    console.log(`Usage: devenv-add-custom-bootstrap "command1" "command2" ...

Add custom bootstrap commands to .devcontainer/user-custom-bootstrap.sh.
Commands run each time the container is recreated or bootstrap executes.
Each command is syntax-checked (bash -n) before it is appended.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
  commands = cli.positionals;
} catch (err) {
  logError(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

if (commands.length === 0) {
  logError('Usage: devenv-add-custom-bootstrap "command1" "command2" ...');
  process.exit(2);
}

mkdirSync(bootstrapDir, { recursive: true });
if (!existsSync(bootstrapScript)) {
  logInfo(`Creating ${bootstrapScript}`);
  writeFileSync(
    bootstrapScript,
    [
      "#!/bin/bash",
      "",
      "# Custom bootstrap commands",
      "# Add commands here that should run during bootstrap",
      "# This file is auto-generated and can be safely edited",
      "",
      "set -euo pipefail",
      "",
      "",
    ].join("\n"),
  );
  chmodSync(bootstrapScript, 0o755);
  logInfo(`Created ${bootstrapScript} with executable permissions`);
}

let addedCount = 0;
for (const cmd of commands) {
  const check = spawnSync("bash", ["-n", "-c", cmd], { stdio: "ignore" });
  if ((check.status ?? 1) === 0) {
    logInfo(`Adding command: ${cmd}`);
    appendFileSync(bootstrapScript, `\n# Added by devenv-add-custom-bootstrap.sh\n${cmd}\n`);
    addedCount++;
  } else {
    logError(`Syntax error in command: ${cmd}`);
    logError(`Command was NOT added to ${bootstrapScript}`);
    process.exit(1);
  }
}

logSuccess(`Added ${addedCount} custom bootstrap command(s) to ${bootstrapScript}`);
logInfo(`Custom bootstrap script location: ${bootstrapScript}`);
