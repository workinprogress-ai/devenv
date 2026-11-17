// devenv-add-env-vars — add or update environment variables in
// $DEVENV_ROOT/.runtime/env-vars.user.sh. Port of devenv-add-env-vars.sh.
// The generated env-vars.sh is rewritten on every update and sources this
// file last, so user variables survive and win over generated ones. Values
// are quoted so spaces, quotes, $(...) and newlines come back exactly as
// given and nothing in a value is ever executed. A plain token stays unquoted.

import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { bashQuote } from "../lib/core/shell-quote.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { logError, logInfo, logSuccess } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const devenvRoot = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
const runtimeDir = join(devenvRoot, ".runtime");
const envVarsFile = join(runtimeDir, "env-vars.user.sh");

let assignments: string[] = [];
try {
  const cli = toolCli({
    name: "devenv-add-env-vars",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) {
    console.log(`Usage: devenv-add-env-vars "VAR1=value1" "VAR2=value2" ...

Add or update environment variables in $DEVENV_ROOT/.runtime/env-vars.user.sh
(sourced by env-vars.sh, which is regenerated on update; values are quoted
so nothing in a value is ever executed).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
  assignments = cli.positionals;
} catch (err) {
  logError(errorMessage(err));
  process.exit(EXIT_MISUSE);
}

if (assignments.length === 0) {
  logError('Usage: devenv-add-env-vars "VAR1=value1" "VAR2=value2" ...');
  process.exit(EXIT_MISUSE);
}

mkdirSync(runtimeDir, { recursive: true });
if (!existsSync(envVarsFile)) writeFileSync(envVarsFile, "#!/bin/bash\n# User-added variables; sourced by env-vars.sh and kept across updates.\n", { mode: 0o600 });
// The file accumulates secrets: owner-only, not executable.
chmodSync(envVarsFile, 0o600);

let addedCount = 0;
let updatedCount = 0;

for (const envVar of assignments) {
  if (!/^[A-Z_][A-Z0-9_]*=.*/.test(envVar)) {
    logError(`Invalid environment variable format: ${envVar}`);
    logError("Expected format: VAR_NAME=value (variable name must start with letter/underscore, uppercase)");
    process.exit(EXIT_MISUSE);
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
