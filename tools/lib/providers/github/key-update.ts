// providers/github/key-update.ts — the GitHub credential rotation entry
// point (TS port of key-update.sh). The generated shell function
// (_key_update_run in .runtime/bash-functions.sh) invokes this file; the
// shell-side env-vars.sh reload hook stays in the generated function — a
// child process cannot re-source the caller's shell, so the reload remains
// shell-side by design.
//
// The credential lifecycle (import + git helper wiring) is the provider
// auth seam's job: this port drives gh directly with the seam's exact
// operations (auth login --with-token, then setup-git), preserving the
// token-never-in-argv rule (stdin only, prompt or pipe).

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../../core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../../core/exit-codes.ts";
import { logWarn } from "../../core/logging.ts";
import { toolCli } from "../../core/cli.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

const die = (msg: string, code = EXIT_GENERAL_ERROR): never => {
  console.error(msg.startsWith("ERROR:") ? msg : `ERROR: ${msg}`);
  process.exit(code);
};

function usage(): never {
  console.log("Usage: key-update-provider | --help");
  console.log("");
  console.log("Rotate the provider credential-store token used for git https auth.");
  console.log("Prompts for the token on the terminal (hidden input); a piped stdin");
  console.log("token also works: key-update-provider < token-file.");
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "key-update-provider",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  // The token is never an argument: it would sit on the process listing
  // and in shell history.
  if (cli.positionals.length > 0) {
    die(
      "the token is not accepted as an argument (it would appear in the process list); paste it at the prompt or pipe it on stdin: key-update-provider < token-file",
      EXIT_MISUSE,
    );
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err), EXIT_MISUSE);
}

console.log(">>> 🔐 GitHub Token Update Utility");
console.log("    -------------------------------------------------------");
console.log("    This will update your GitHub personal access token.");
console.log("");

// Token from stdin (pipe) or the terminal prompt. A child read via bash
// keeps the hidden-input contract on a TTY; piped stdin passes through.
let newToken = "";
if (process.stdin.isTTY !== true) {
  newToken = require("node:fs").readFileSync(0, "utf8");
} else {
  const r = spawnSync(
    "bash",
    ["-c", 'read -s -r -p "    Paste GitHub personal access token (classic) with repo scope: " t || t=""; printf %s "$t"'],
    { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
  );
  newToken = r.stdout ?? "";
  console.log(""); // Newline
  console.log("    Create one at: https://github.com/settings/tokens");
}
newToken = newToken.replace(/\r?\n$/, "");

if (newToken === "") {
  die("No token provided. Operation cancelled.", EXIT_MISUSE);
}

// Validate token format (GitHub tokens typically start with ghp_ or gh_).
if (!/^(gh|ghp_)/.test(newToken)) {
  logWarn("Token doesn't start with expected prefix (ghp_ or gh_). Proceeding anyway...");
}

// 1. Rotate via the provider credential store — the single source of truth.
//    The token is never written to env-vars.sh or any backup file; git
//    authentication flows through gh's credential helper.
console.log("    - Rotating credentials (provider auth seam)...");
const login = spawnSync(
  "gh",
  ["auth", "login", "--with-token", "--hostname", "github.com", "--skip-ssh-key"],
  { input: newToken, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
);
if (login.status !== 0) {
  die("credential import failed — token not accepted. No changes made.");
}

// 2. Wire the git credential helper (the provider verb's second half).
const setupGit = spawnSync("gh", ["auth", "setup-git", "--hostname", "github.com"], {
  encoding: "utf8",
});
if (setupGit.status !== 0) {
  logWarn("gh auth setup-git failed — git pushes/pulls over https may fail until it is re-run");
}

console.log("    ✅ Success! Credentials updated (provider credential store).");
console.log("    -------------------------------------------------------");
console.log("    The new token is now active. git https auth goes through");
console.log("    the provider credential helper; no token is stored in env files.");
console.log("");
