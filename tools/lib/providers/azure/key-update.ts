// providers/azure/key-update.ts — the Azure DevOps credential rotation
// entry point (TS port of key-update.sh). The generated shell function
// (_key_update_run) invokes this file; the env-vars.sh reload hook stays
// shell-side in the generated function.
//
// Credential lifecycle: the 0600 PAT file in the devenv config area is the
// single durable copy (import = write + mode-verify), plus the git
// credential-helper wiring the bash impl performs. After rotation the
// package-feed wiring hooks re-run (a rotated PAT invalidates ~/.npmrc and
// the nuget source credentials); failures report but do not undo the
// rotation. The TS port drives the SAME bash seam functions for the wiring
// hooks — they are bootstrap-chain members (allowlist), not verb twins.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNodeFloor } from "../../core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../../core/exit-codes.ts";
import { logWarn } from "../../core/logging.ts";
import { toolCli } from "../../core/cli.ts";
import { selfRoot } from "../../core/self-root.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

const die = (msg: string, code = EXIT_GENERAL_ERROR): never => {
  console.error(msg.startsWith("ERROR:") ? msg : `ERROR: ${msg}`);
  process.exit(code);
};

function usage(): never {
  console.log("Usage: key-update-azure | --help");
  console.log("");
  console.log("Rotate the Azure DevOps personal access token used by the azure");
  console.log("Prompts for the token on the terminal (hidden input); a piped stdin");
  console.log("token also works: key-update-azure < token-file.");
  console.log("The token needs Work Items (Read/Write), Code (Read/Write), and");
  console.log("Build (Read/Execute) scopes for the org's pipelines and repos.");
  process.exit(0);
}

try {
  const cli = toolCli({
    name: "key-update-azure",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
  });
  if (cli.common.help) usage();
  // The token is never an argument (process list / shell history).
  if (cli.positionals.length > 0) {
    die(
      "the token is not accepted as an argument (it would appear in the process list); paste it at the prompt or pipe it on stdin: key-update-azure < token-file",
      EXIT_MISUSE,
    );
  }
} catch (err) {
  die(err instanceof Error ? err.message : String(err), EXIT_MISUSE);
}

console.log(">>> 🔐 Azure DevOps PAT Update Utility");
console.log("    -------------------------------------------------------");
console.log("    This will update your Azure DevOps personal access token");
console.log("    (stored 0600 in the devenv config area).");
console.log("");

let newToken = "";
if (process.stdin.isTTY !== true) {
  newToken = readFileSync(0, "utf8");
} else {
  const r = spawnSync(
    "bash",
    ["-c", 'read -s -r -p "    Paste Azure DevOps personal access token: " t || t=""; printf %s "$t"'],
    { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
  );
  newToken = r.stdout ?? "";
  console.log(""); // Newline
  console.log("    Create one at: https://dev.azure.com/{your-org}/_usersSettings/tokens");
}
newToken = newToken.replace(/\r?\n$/, "");

if (newToken === "") {
  die("No token provided. Operation cancelled.", EXIT_MISUSE);
}

// Azure PATs carry no prefix — length sanity only (Azure PATs are 52 chars).
if (newToken.length < 40) {
  logWarn(`Token is shorter than an Azure PAT typically is (${newToken.length} chars). Proceeding anyway...`);
}

// 1. Rotate: write the 0600 PAT file (the single durable copy), then wire
//    the git credential helper — same operations as the auth seam impl.
console.log("    - Rotating credentials (provider auth seam)...");
const patFile = process.env.AZURE_PAT_FILE || join(process.env.HOME ?? "", ".keys", "azure-devops-pat");
mkdirSync(dirname(patFile), { recursive: true });
try {
  chmodSync(patFile, 0o600);
} catch { /* not present yet */ }
try {
  writeFileSync(patFile, `${newToken}\n`, { mode: 0o600 });
  chmodSync(patFile, 0o600);
} catch (err) {
  die(`failed writing PAT file: ${patFile} (${err instanceof Error ? err.message : String(err)})`);
}
const modeProbe = spawnSync("stat", ["-c", "%a", patFile], { encoding: "utf8" });
if ((modeProbe.stdout ?? "").trim() !== "600") {
  die(`PAT file mode is ${(modeProbe.stdout ?? "").trim()}, expected 600 — refusing to keep it`);
}
console.log(`    Azure DevOps PAT stored (${patFile})`);

// Git credential helper wiring (the auth impl's second half).
const toolsRoot = join(selfRoot(import.meta.url), "tools");
const helper = spawnSync(
  "bash",
  ["-c", `source '${toolsRoot}/lib/providers/provider-core.bash' && export PROVIDER_NAME=azure && provider_load auth && provider_auth_setup_git`],
  { stdio: ["ignore", "inherit", "inherit"], encoding: "utf8" },
);
if (helper.status !== 0) {
  console.error("    ⚠ git credential helper wiring failed — git https to Azure DevOps may fail until re-run.");
}

// 3. Re-wire the package feeds: a rotated PAT invalidates ~/.npmrc and the
//    nuget source credentials. Wiring failures report but do not undo the
//    rotation (the credential store is already updated).
let wiringFailed = false;
console.log("    - Refreshing package feed credentials...");
const npmrc = join(process.env.HOME ?? "", ".npmrc");
if (process.env.HOME !== undefined && process.env.HOME !== "") {
  const npm = spawnSync(
    "bash",
    ["-c", `source '${toolsRoot}/lib/providers/provider-core.bash' && export PROVIDER_NAME=azure && provider_load bootstrap && provider_bootstrap_call configure_npmrc '$1' npmrc`, "x", npmrc],
    { stdio: ["ignore", "inherit", "inherit"], encoding: "utf8" },
  );
  if (npm.status !== 0) {
    console.error("    ⚠ npm feed re-wiring failed — run bootstrap or configure_user_npmrc to retry.");
    wiringFailed = true;
  }
}
const nuget = spawnSync(
  "bash",
  ["-c", `source '${toolsRoot}/lib/providers/provider-core.bash' && export PROVIDER_NAME=azure && provider_load bootstrap && provider_bootstrap_call configure_nuget`],
  { stdio: ["ignore", "inherit", "inherit"], encoding: "utf8" },
);
if (nuget.status !== 0) {
  console.error("    ⚠ NuGet feed re-wiring failed — run bootstrap or configure_nuget_sources to retry.");
  wiringFailed = true;
}

console.log("    ✅ Success! Credentials updated (0600 PAT file).");
console.log("    -------------------------------------------------------");
console.log("    The new token is now active for all Azure DevOps REST calls.");
console.log("    No token is stored in env files; the 0600 PAT file is the only");
console.log("    durable credential copy.");
if (wiringFailed) {
  console.log("    One or more package feed re-wiring steps failed; see above.");
  process.exit(1);
}
console.log("");
