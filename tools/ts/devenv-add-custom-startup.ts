// devenv-add-custom-startup — add custom startup commands to
// .devcontainer/user-custom-startup.sh. Port of devenv-add-custom-startup.sh.
// Commands run after the container starts; each is syntax-checked (bash -n)
// before it is appended.

import { existsSync, mkdirSync, appendFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";

assertNodeFloor();

const devenvRoot = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
const startupScript = join(devenvRoot, ".devcontainer", "user-custom-startup.sh");

const argv = process.argv.slice(2);
if (argv.length === 0) {
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
for (const cmd of argv) {
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
