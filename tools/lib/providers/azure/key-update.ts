// providers/azure/key-update.ts — the Azure DevOps credential rotation
// entry point. The generated shell function
// (_key_update_run) invokes this file; the env-vars.sh reload hook stays
// shell-side in the generated function.
//
// Credential lifecycle: the 0600 PAT file in the devenv config area is the
// single durable copy (import = write + mode-verify), plus the git
// credential-helper wiring. After rotation the
// package-feed wiring hooks re-run (a rotated PAT invalidates ~/.npmrc and
// the nuget source credentials); failures report but do not undo the
// rotation.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertNodeFloor } from "../../core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../../core/exit-codes.ts";
import { logWarn } from "../../core/logging.ts";
import { toolCli } from "../../core/cli.ts";
import { selfRoot } from "../../core/self-root.ts";
import { azureSetupGit } from "./auth.ts";
import { azureValidateToken } from "./http.ts";
import { azureOrgGet } from "./urls.ts";

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

// 1. Validate, then rotate: a rejected token never replaces a working one;
//    the 0600 PAT file (the single durable copy) is replaced atomically, then
//    the git credential helper is wired — same operations as the auth seam impl.
console.log("    - Rotating credentials (provider auth seam)...");
const org = azureOrgGet();
if (org === "") {
  logWarn("no Azure organization configured ([provider] azure_org or AZURE_DEVOPS_ORG) — the new token was not checked against the service.");
} else {
  const verdict = await azureValidateToken(org, newToken);
  if (verdict === "rejected") {
    die(`Azure DevOps rejected the new token for organization '${org}' (a wrong token, or a wrong organization name) — nothing was changed; the stored token is kept.`);
  }
  if (verdict === "unreachable") {
    logWarn(`could not verify the new token against organization '${org}' (service unreachable) — storing it anyway.`);
  }
}
const configuredPatFile = process.env.AZURE_PAT_FILE || join(process.env.HOME || homedir(), ".keys", "azure-devops-pat");
// A PAT file that is a symlink (a dotfiles-managed setup) is rotated in place:
// the link stays, its target is replaced.
const patFile = existsSync(configuredPatFile) ? realpathSync(configuredPatFile) : configuredPatFile;
mkdirSync(dirname(patFile), { recursive: true, mode: 0o700 });
// Write beside the target and rename over it: a crash or a failed write can
// never leave the stored token truncated or empty.
const tmpFile = `${patFile}.tmp-${process.pid}`;
try {
  writeFileSync(tmpFile, `${newToken}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(tmpFile, 0o600);
  renameSync(tmpFile, patFile);
} catch (err) {
  rmSync(tmpFile, { force: true });
  die(`failed writing PAT file: ${patFile} (${err instanceof Error ? err.message : String(err)})`);
}
const modeProbe = spawnSync("stat", ["-c", "%a", patFile], { encoding: "utf8" });
if ((modeProbe.stdout ?? "").trim() !== "600") {
  die(`PAT file mode is ${(modeProbe.stdout ?? "").trim()}, expected 600 — refusing to keep it`);
}
console.log(`    Azure DevOps PAT stored (${patFile})`);
// The API client reads AZURE_PAT before the file, so a stale exported value
// would keep overriding the token just rotated.
const envPat = process.env.AZURE_PAT ?? "";
if (envPat !== "" && envPat !== newToken) {
  logWarn("AZURE_PAT is set in this environment and differs from the new token; it takes precedence over the PAT file. Unset it (or update it) or API calls keep using the old token.");
}

// Wiring failures report but do not undo the rotation (the credential store
// is already updated); they make the run exit non-zero.
let wiringFailed = false;

// Git credential helper wiring (the auth impl's second half).
try {
  azureSetupGit();
} catch (err) {
  console.error(
    `    ⚠ git credential helper wiring failed — git https to Azure DevOps may fail until re-run.${err instanceof Error ? ` (${err.message})` : ""}`,
  );
  wiringFailed = true;
}

// 3. Re-wire the package feeds: a rotated PAT invalidates ~/.npmrc and the
//    nuget source credentials.
console.log("    - Refreshing package feed credentials...");
// Step modules run exactly as the setup orchestrator runs them.
const toolsRoot = join(selfRoot(import.meta.url), "tools");
function runSetupStep(module: string): boolean {
  const r = spawnSync(process.execPath, [join(toolsRoot, "ts", "setup-steps", module)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, DEVENV_TOOLBOX_ROOT: process.env.DEVENV_TOOLBOX_ROOT || selfRoot(import.meta.url) },
  });
  return r.status === 0;
}
if (process.env.HOME !== undefined && process.env.HOME !== "") {
  if (!runSetupStep("npmrc.ts")) {
    console.error("    ⚠ npm feed re-wiring failed — run bootstrap or configure_user_npmrc to retry.");
    wiringFailed = true;
  }
}
if (!runSetupStep("nuget-sources.ts")) {
  console.error("    ⚠ NuGet feed re-wiring failed — run bootstrap or configure_nuget_sources to retry.");
  wiringFailed = true;
}

console.log("    ✅ Success! Credentials updated (0600 PAT file).");
console.log("    -------------------------------------------------------");
console.log("    The new token is now active for all Azure DevOps REST calls.");
console.log("    No token is stored in env files; the 0600 PAT file is the only");
console.log("    durable credential copy.");
if (wiringFailed) {
  console.log("    One or more re-wiring steps (git credential helper or package feeds) failed; see above.");
  process.exit(1);
}
console.log("");
