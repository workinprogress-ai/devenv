// azure/auth.ts — the Azure DevOps credential seam, TS side (port of the
// read paths of azure/auth.bash).
//
// The seam contract holds as in the github port: the credential STORE stays
// with the provider (the 0600 PAT file + AZURE_PAT env leg, written only by
// key-update-azure); this module reads it for API calls and reports status —
// it never writes, moves, or displays the token. The git credential-helper
// wiring lives here (azureSetupGit); the container bootstrap's own import
// still wires it through auth.bash.
//
// The actual token read lives in http.ts (azurePatGet) so the transport owns
// its credential path; this module is the status/reporting surface.

import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configGetRaw } from "../../core/config.ts";
import { logWarn } from "../../core/logging.ts";
import { ProviderError, providerConfigPath } from "../provider-core.ts";
import { azurePatGet } from "./http.ts";

export { azurePatGet } from "./http.ts";

/** The PAT file path (auth.bash azure_pat_file parity): the AZURE_PAT_FILE
 * env leg, else ~/.keys/azure-devops-pat. */
export function azurePatFile(): string {
  const home = process.env.HOME ?? "";
  return process.env.AZURE_PAT_FILE || join(home, ".keys", "azure-devops-pat");
}

/** The provider's auth status, exit-code form (auth.bash
 * provider_auth_status_impl parity): a resolvable token with a sane file mode
 * means the provider can operate, as does a set AZURE_PAT. Never reads
 * the token's value. */
export function authStatusOk(): boolean {
  // The AZURE_PAT env leg is a credential in its own right (azurePatGet reads
  // it before the file), so it needs no PAT file.
  if ((process.env.AZURE_PAT ?? "") !== "") return true;
  const patFile = azurePatFile();
  if (!existsSync(patFile)) return false;
  try {
    const mode = (statSync(patFile).mode & 0o777).toString(8).padStart(3, "0");
    if (mode !== "600") return false;
  } catch {
    return false;
  }
  return azurePatGet() !== "";
}

/** Fail-loud pre-flight for azure-domain tools: exits with guidance when no
 * usable credential is stored (ensure_provider_auth parity — the tool dies
 * here rather than letting the first API call surface a raw error). */
export function ensureAzureAuth(): void {
  if (authStatusOk()) return;
  console.error(
    "Error: the Azure DevOps credential is missing or unusable. Run: key-update-azure",
  );
  process.exit(1);
}

/** Assert a credential exists for a call about to be made; throws a typed
 * ProviderError (the module-level contract — never exits). */
export function requireAzureCredential(): string {
  const pat = azurePatGet();
  if (pat === "") {
    throw new ProviderError(
      "no stored azure credential — run key-update-azure",
    );
  }
  return pat;
}

/** Register the PAT-backed git credential helper (credential-helper.sh) for
 * dev.azure.com and for the `<azure_org>.visualstudio.com` host of the
 * configured organization, in the user's global git config (auth.bash
 * provider_auth_setup_git_impl parity). Host-scoped, idempotent: re-running
 * rewrites the same config lines. A missing or malformed `[provider]
 * azure_org` skips only the visualstudio.com host, with a warning. Throws a
 * ProviderError when git refuses a registration. */
export function azureSetupGit(): void {
  const helper = join(dirname(fileURLToPath(import.meta.url)), "credential-helper.sh");
  try {
    accessSync(helper, constants.X_OK);
  } catch {
    try {
      chmodSync(helper, 0o755);
    } catch {
      // the helper is invoked as an argument of its own path; a read-only checkout still works
    }
  }
  const register = (host: string, what: string): void => {
    const r = spawnSync("git", ["config", "--global", `credential.https://${host}.helper`, `${helper} get`], {
      stdio: "ignore",
    });
    if (r.status !== 0) throw new ProviderError(`failed registering the ${what} in git config`);
  };
  register("dev.azure.com", "azure credential helper");

  // The Azure organization ([provider] azure_org) is the one the API and the git
  // remotes use, so the visualstudio.com host derives from it, not from the
  // generic [organization] org.
  const configPath = providerConfigPath();
  const configured = existsSync(configPath) ? (configGetRaw(configPath, "provider", "azure_org") ?? "") : "";
  if (configured === "") {
    logWarn("organization identity unavailable; skipping visualstudio.com host credential helper");
    return;
  }
  const org = configured.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(org)) {
    logWarn("invalid organization identity; skipping visualstudio.com host credential helper");
    return;
  }
  register(`${org}.visualstudio.com`, "visualstudio.com host credential helper");
}
