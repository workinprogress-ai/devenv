#!/usr/bin/env node
// npmrc.ts — provision step: keep ~/.npmrc owner-only and let the provider
// authenticate its registry. Port of provision.bash configure_user_npmrc
// (+ providers/github/bootstrap.bash provider_bootstrap_configure_npmrc).
//
// Contract: chmod 600 when the file exists; drop the stale status line the
// old tooling could write as if it were a setting; then the registry token
// is written via mktemp+rename so the npmrc ends up owner-only even if it
// was wider before. No token: skip line, never a failure.

import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { configGetRaw } from "../../lib/core/config.ts";
import { providerDetect } from "../../lib/providers/provider-core.ts";
import { home, toolbox } from "./lib.ts";
import { azureNpmrcLines, isAzureArtifactsUrl, npmrcFeedPrefixes, providerSecretToken } from "./provider-seam.ts";

const npmrc = join(home(), ".npmrc");

if (existsSync(npmrc)) {
  chmodSync(npmrc, 0o600);
  // Drop an exact status line that ended up in the file as if it were a setting.
  const content = readFileSync(npmrc, "utf8");
  const cleaned = content.split("\n").filter((l) => l !== "Skipping npmrc auth token (gh not authenticated)").join("\n");
  if (cleaned !== content) writeFileSync(npmrc, cleaned);
}

// mktemp-style write: the temp file is 0600 and the rename carries that mode
// over, so the npmrc ends up owner-only even if it was wider before.
function writeOwnerOnly(content: string): void {
  const tmp = `${npmrc}.setup-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, content);
  chmodSync(tmp, 0o600);
  try {
    unlinkSync(npmrc);
  } catch {
    // not present
  }
  renameSync(tmp, npmrc);
}

const provider = providerDetect();
const token = providerSecretToken();

if (provider === "azure") {
  // Azure Artifacts feed: [npm] feed_url (+ optional [npm] scope). The PAT is
  // only ever written for an Azure Artifacts host, base64-encoded.
  const feedUrl = configGetRaw(join(toolbox(), "devenv.config"), "npm", "feed_url") ?? "";
  if (feedUrl === "") {
    console.log("Skipping npm registry authentication (azure provider: [npm] feed_url not configured)");
    process.exit(0);
  }
  if (!isAzureArtifactsUrl(feedUrl)) {
    console.log("Skipping npm registry authentication (azure provider: [npm] feed_url is not an Azure Artifacts URL)");
    process.exit(0);
  }
  if (token === "") {
    console.log("Skipping npm registry authentication (azure provider: credentials unavailable)");
    process.exit(0);
  }
  const scope = configGetRaw(join(toolbox(), "devenv.config"), "npm", "scope") ?? "";
  const existing = existsSync(npmrc) ? readFileSync(npmrc, "utf8").split("\n") : [];
  const tokenB64 = Buffer.from(token).toString("base64");
  writeOwnerOnly(azureNpmrcLines(existing, npmrcFeedPrefixes(feedUrl), tokenB64, scope).join("\n"));
  console.log("npmrc: registry authentication configured");
  process.exit(0);
}

if (token === "") {
  console.log("Skipping GitHub npm registry authentication (credentials unavailable)");
  process.exit(0);
}

// mktemp creates the file 0600 and the rename carries that mode over: the
// npmrc ends up owner-only even if it was wider before (the bash comment's
// contract). The awk one-pass rewrite becomes a line filter: existing
// authToken lines are replaced in place; missing, appended at the end.
const AUTH_LINE = `//npm.pkg.github.com/:_authToken=${token}`;
let lines: string[];
if (existsSync(npmrc)) {
  lines = readFileSync(npmrc, "utf8").split("\n");
} else {
  lines = [];
}
let written = false;
lines = lines.map((l) => {
  if (/^[ \t]*\/\/npm[.]pkg[.]github[.]com\/:_authToken[ \t]*=/.test(l)) {
    if (!written) {
      written = true;
      return AUTH_LINE;
    }
    return null; // drop duplicates (the awk `next` behavior)
  }
  return l;
}).filter((l) => l !== null);
if (!written) lines.push(AUTH_LINE);

writeOwnerOnly(lines.join("\n"));
console.log("npmrc: registry authentication configured");
