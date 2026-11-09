// devenv-add-custom-startup — add custom startup commands to
// .devcontainer/user-custom-startup.sh. Port of devenv-add-custom-startup.sh.
// Commands run after the container starts; each is syntax-checked (bash -n)
// before it is appended.

import { existsSync, mkdirSync, appendFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";

assertNodeFloor();

const devenvRoot = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
const startupScript = join(devenvRoot, ".devcontainer", "user-custom-startup.sh");

let commands: string[] = [];
try {
  const cli = toolCli({
    name: "devenv-add-custom-startup",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) {
    console.log(`Usage: devenv-add-custom-startup "command1" "command2" ...

Add custom startup commands to .devcontainer/user-custom-startup.sh.
Commands run after the container starts; each is syntax-checked (bash -n)
before it is appended.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
  commands = cli.positionals;
} catch (err) {
  logError(errorMessage(err));
  process.exit(2);
}

if (commands.length === 0) {
  logError('Usage: devenv-add-custom-startup "command1" "command2" ...');
  process.exit(2);
}

if (!existsSync(startupScript)) {
  logInfo(`Creating ${startupScript}`);
  mkdirSync(join(devenvRoot, ".devcontainer"), { recursive: true });
  writeFileSync(
    startupScript,
    [
      "#!/bin/bash",
      "",
      "# Custom startup commands",
      "# Add commands here that should run after the container starts",
      "# This file is auto-generated and can be safely edited",
      "",
      "set -euo pipefail",
      "",
      "",
    ].join("\n"),
  );
  chmodSync(startupScript, 0o755);
  logInfo(`Created ${startupScript} with executable permissions`);
}

let addedCount = 0;
for (const cmd of commands) {
  const check = spawnSync("bash", ["-n", "-c", cmd], { stdio: "ignore" });
  if ((check.status ?? 1) === 0) {
    logInfo(`Adding command: ${cmd}`);
    appendFileSync(startupScript, `\n# Added by devenv-add-custom-startup.sh\n${cmd}\n`);
    addedCount++;
  } else {
    logError(`Syntax error in command: ${cmd}`);
    logError(`Command was NOT added to ${startupScript}`);
    process.exit(1);
  }
}

logSuccess(`Added ${addedCount} custom startup command(s) to ${startupScript}`);
logInfo(`Custom startup script location: ${startupScript}`);
