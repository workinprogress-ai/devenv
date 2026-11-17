// _key-update-do — rotate the Digital Ocean API token and reload the
// environment. Port of _key-update-do.sh. Underscore-prefixed: no depth-1
// stub by contract; the bootstrap-generated `key-update-do` shell function
// invokes this file by absolute path (written by the setup-steps bash-functions module).

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { selfRoot } from "../lib/core/self-root.ts";
import { logError, logWarn } from "../lib/core/logging.ts";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../lib/core/exit-codes.ts";
import { toolCli } from "../lib/core/cli.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";

assertNodeFloor();

const devenvRoot = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
const SCRIPT_VERSION = "1.0.0";

function usage(): never {
  console.log("Usage: key-update-do [TOKEN] | --help");
  console.log("");
  console.log("Rotate the Digital Ocean API token. With TOKEN: non-interactive.");
  console.log("Without: prompts on the terminal.");
  process.exit(EXIT_SUCCESS);
}

// --help/-h must never be interpreted as a token: an unrecognized flag would
// otherwise fall through to the token path and be stored as a secret.
// House flags (-v/-V) are lifted by toolCli; the sole positional (or none)
// is the token.
let newToken = "";
try {
  const cli = toolCli({
    name: "key-update-do",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  if (cli.positionals.length > 0) newToken = cli.positionals[0] as string;
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

console.log(">>> 🔐 Digital Ocean Token Update Utility");
console.log("    -------------------------------------------------------");
console.log("    This will update your Digital Ocean API token.");
console.log("");

if (newToken === "") {
  const prompted = spawnSync("bash", ["-c", 'read -s -r -p "    Paste Digital Ocean API token: " t || t=""; printf %s "$t"'], {
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf8",
  });
  newToken = prompted.stdout ?? "";
  console.log(""); // Newline
  console.log("    Create one at: https://cloud.digitalocean.com/account/api/tokens");
}

if (newToken === "") {
  logError("No token provided. Operation cancelled.");
  process.exit(EXIT_MISUSE);
}

// Validate token format (Digital Ocean tokens are long hex strings, typically
// 64 characters).
if (newToken.length < 32) {
  logWarn("Token appears to be shorter than expected. Digital Ocean tokens are typically long hex strings.");
  logWarn("Proceeding anyway...");
}

// 1. Update env-vars (Persistence) through the sibling devenv-add-env-vars tool.
console.log("    - Updating environment variables...");
const addEnv = siblingInvocation("devenv-add-env-vars", [`DIGITALOCEAN_API_TOKEN=${newToken}`]);
const updater = spawnSync(addEnv.command, addEnv.args, {
  stdio: "inherit",
});
if ((updater.status ?? 1) !== 0) process.exit(updater.status ?? 1);

// 2. Store the token in the .setup backup file (0600).
console.log("    - Storing token in backup file...");
const tokenFile = join(devenvRoot, ".setup", "digitalocean_token.txt");
mkdirSync(dirname(tokenFile), { recursive: true });
writeFileSync(tokenFile, `${newToken}\n`);
chmodSync(tokenFile, 0o600);

// 3. Export for the current execution scope (process-local).
process.env["DIGITALOCEAN_API_TOKEN"] = newToken;

// 4. Re-source the updated env-vars in the caller's shell is the bootstrap
// function's job (the function wraps this file with `source .runtime/env-vars.sh`).

console.log("    ✅ Success! Digital Ocean token updated.");
console.log("    -------------------------------------------------------");
console.log("    The new token is now active in your environment.");
console.log("    You can now continue working. No container restart required.");
console.log("");
