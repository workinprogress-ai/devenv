// _key-update-tailscale — rotate the Tailscale auth key and re-authenticate
// the daemon. Port of _key-update-tailscale.sh. Underscore-prefixed: no
// depth-1 stub by contract; the bootstrap-generated `key-update-tailscale`
// shell function invokes this file by absolute path (written by the setup-steps bash-functions module).

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { resolveToolsRoot } from "../lib/core/self-root.ts";
import { logError } from "../lib/core/logging.ts";
import { EXIT_API_FAILURE, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const tools = resolveToolsRoot(import.meta.url);

function usage(): never {
  console.log("Usage: key-update-tailscale [AUTH_KEY] | --help");
  console.log("");
  console.log("Rotate the Tailscale Reusable Auth Key and reconnect the node.");
  console.log("With AUTH_KEY: non-interactive. Without: prompts on the terminal.");
  process.exit(0);
}

function capture(cmd: string): string {
  const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

// Detect current hostname from the running Tailscale config, or fall back.
let currentHostname = capture('tailscale status --json 2>/dev/null | grep -o \'"HostName": "[^"]*"\' | cut -d\'"\' -f4');
if (currentHostname === "") currentHostname = `devbox-${capture("hostname")}`;

console.log(">>> 🔄 Tailscale Key Update Utility");
console.log(`    Current hostname: ${currentHostname}`);
console.log("    -------------------------------------------------------");
console.log("    This will update your Auth Key and immediately reconnect.");
console.log("");

// --help/-h must never be interpreted as a key: an unrecognized flag would
// otherwise fall through to the key path and fail at auth.
const arg = process.argv[2];
if (arg === "--help" || arg === "-h") usage();

// Capture the key: the argument when given (the documented non-interactive
// form), otherwise prompt on the terminal.
let newKey: string;
if (arg) {
  newKey = arg;
} else {
  const prompted = spawnSync(
    "bash",
    ["-c", 'read -s -r -p "    Paste new Reusable Auth Key: " k || k=""; printf %s "$k"'],
    { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
  );
  newKey = prompted.stdout ?? "";
  console.log(""); // Newline
}

if (newKey === "") {
  logError("No key provided. Operation cancelled.");
  process.exit(EXIT_MISUSE);
}

// Validate key format (should start with tskey-).
if (!newKey.startsWith("tskey-")) {
  logError("Invalid key format. Tailscale auth keys start with 'tskey-'");
  process.exit(EXIT_MISUSE);
}

// 1. Update env-vars (Persistence).
console.log("    - Updating environment variables...");
const updater = spawnSync("bash", [join(tools, "devenv-add-env-vars"), `TS_AUTHKEY=${newKey}`], {
  stdio: "inherit",
});
if ((updater.status ?? 1) !== 0) process.exit(updater.status ?? 1);

// 2. Export for the current execution scope (process-local).
process.env["TS_AUTHKEY"] = newKey;

// 3. Re-authenticate the daemon (immediate effect). The daemon does NOT need
// a restart.
console.log("    - Re-authenticating Tailscale daemon...");
const up = spawnSync(
  "sudo",
  ["tailscale", "up", `--authkey=${newKey}`, `--hostname=${currentHostname}`, "--accept-routes", "--reset"],
  { stdio: "inherit" },
);
if ((up.status ?? 1) !== 0) {
  logError("Failed to authenticate. Please check if the key is valid and not expired.");
  process.exit(EXIT_API_FAILURE);
}

console.log("    ✅ Success! Tailscale is re-connected.");
console.log("    -------------------------------------------------------");
console.log(`    Hostname: ${currentHostname}`);
console.log("    Status:");
spawnSync("bash", ["-c", "tailscale status | head -n 5"], { stdio: "inherit" });
console.log("");
console.log("    You can now continue working. No container restart required.");
