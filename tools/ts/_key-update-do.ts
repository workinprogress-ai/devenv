// _key-update-do — rotate the Digital Ocean API token and reload the
// environment. Port of _key-update-do.sh. Underscore-prefixed: no depth-1
// stub by contract; the bootstrap-generated `key-update-do` shell function
// invokes this file by absolute path (written by the setup-steps bash-functions module).

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { selfRoot, resolveToolsRoot } from "../lib/core/self-root.ts";
import { logError, logWarn } from "../lib/core/logging.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const devenvRoot = process.env["DEVENV_ROOT"] ?? selfRoot(import.meta.url);
const tools = resolveToolsRoot(import.meta.url);

function usage(): never {
  console.log("Usage: key-update-do [TOKEN] | --help");
  console.log("");
  console.log("Rotate the Digital Ocean API token. With TOKEN: non-interactive.");
  console.log("Without: prompts on the terminal.");
  process.exit(0);
}

console.log(">>> 🔐 Digital Ocean Token Update Utility");
console.log("    -------------------------------------------------------");
console.log("    This will update your Digital Ocean API token.");
console.log("");

// --help/-h must never be interpreted as a token: an unrecognized flag would
// otherwise fall through to the token path and be stored as a secret.
const arg = process.argv[2];
if (arg === "--help" || arg === "-h") usage();

let newToken: string;
if (arg) {
  newToken = arg;
} else {
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

// 1. Update env-vars (Persistence): invoke the depth-1 entry by exact path —
// the tools-root stub that honors the override chain.
console.log("    - Updating environment variables...");
const updater = spawnSync("bash", [join(tools, "devenv-add-env-vars"), `DO_TOKEN=${newToken}`], {
  stdio: "inherit",
});
if ((updater.status ?? 1) !== 0) process.exit(updater.status ?? 1);

// 2. Store the token in the .setup backup file (0600).
console.log("    - Storing token in backup file...");
const tokenFile = join(devenvRoot, ".setup", "do_token.txt");
mkdirSync(dirname(tokenFile), { recursive: true });
writeFileSync(tokenFile, `${newToken}\n`);
chmodSync(tokenFile, 0o600);

// 3. Export for the current execution scope (process-local).
process.env["DO_TOKEN"] = newToken;

// 4. Re-source the updated env-vars in the caller's shell is the bootstrap
// function's job (the function wraps this file with `source .runtime/env-vars.sh`).

console.log("    ✅ Success! Digital Ocean token updated.");
console.log("    -------------------------------------------------------");
console.log("    The new token is now active in your environment.");
console.log("    You can now continue working. No container restart required.");
console.log("");
