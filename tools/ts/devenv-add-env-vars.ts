// devenv-add-env-vars — add or update environment variables in
// $DEVENV_ROOT/.runtime/env-vars.sh. Port of devenv-add-env-vars.sh.
// The file is sourced by every shell, so values are written with bash %q
// quoting: spaces, quotes, $(...) and newlines come back exactly as given
// and nothing in a value is ever executed. A plain token stays unquoted.

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";

assertNodeFloor();

const devenvRoot = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
const runtimeDir = join(devenvRoot, ".runtime");
const envVarsFile = join(runtimeDir, "env-vars.sh");

const argv = process.argv.slice(2);
if (argv.length === 0) {
  logError('Usage: devenv-add-env-vars "VAR1=value1" "VAR2=value2" ...');
  process.exit(2);
}

mkdirSync(runtimeDir, { recursive: true });
if (!existsSync(envVarsFile)) {
  logError(`Environment variables file not found: ${envVarsFile}`);
  process.exit(1);
}

function bashQuote(value: string): string {
  // %q equivalent: quote only when the value is not already a safe single token.
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return spawnSync("bash", ["-c", `printf '%q' "$1"`, "sh", value], { encoding: "utf8" }).stdout ?? "";
}

let addedCount = 0;
let updatedCount = 0;

for (const envVar of argv) {
  if (!/^[A-Z_][A-Z0-9_]*=.*/.test(envVar)) {
    logError(`Invalid environment variable format: ${envVar}`);
    logError("Expected format: VAR_NAME=value (variable name must start with letter/underscore, uppercase)");
    process.exit(2);
  }

  const eq = envVar.indexOf("=");
  const varName = envVar.slice(0, eq);
  const varValue = envVar.slice(eq + 1);

  const current = readFileSync(envVarsFile, "utf8");
  const lineRe = new RegExp(`^export ${varName}=.*\\n`, "gm");
  if (lineRe.test(current)) {
    logInfo(`Updating existing variable: ${varName}`);
    writeFileSync(envVarsFile, current.replace(lineRe, ""));
    updatedCount++;
  } else {
    logInfo(`Adding new variable: ${varName}`);
    addedCount++;
  }

  appendFileSync(envVarsFile, `export ${varName}=${bashQuote(varValue)}\n`);
}

if (updatedCount > 0 && addedCount > 0) {
  logSuccess(`Added ${addedCount} and updated ${updatedCount} environment variable(s) in ${envVarsFile}`);
} else if (updatedCount > 0) {
  logSuccess(`Updated ${updatedCount} environment variable(s) in ${envVarsFile}`);
} else {
  logSuccess(`Added ${addedCount} environment variable(s) to ${envVarsFile}`);
}
logInfo(`Environment variables file: ${envVarsFile}`);
logInfo("Restart your container or source the file to apply changes");
