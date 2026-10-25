// azure/auth.ts — the Azure DevOps credential seam, TS side (port of the
// read paths of azure/auth.bash).
//
// The seam contract holds as in the github port: the credential STORE stays
// with the provider (the 0600 PAT file + AZURE_PAT env leg, written only by
// key-update-azure); this module reads it for API calls and reports status —
// it never writes, moves, or displays the token. The git credential-helper
// wiring and the npmrc wiring remain in setup.bash (bootstrap chain rule).
//
// The actual token read lives in http.ts (azurePatGet) so the transport owns
// its credential path; this module is the status/reporting surface.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ProviderError } from "../provider-core.ts";
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
 * means the provider can operate. Never reads the token's value. */
export function authStatusOk(): boolean {
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
