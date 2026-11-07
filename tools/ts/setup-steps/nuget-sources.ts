#!/usr/bin/env node
// nuget-sources.ts — provision step: register the local dev NuGet source and
// the provider's package feed. Port of provision.bash configure_nuget_sources
// (+ add_nuget_source_if_not_exists) and providers/github/bootstrap.bash
// provider_bootstrap_configure_nuget.
//
// Contract: the local dev source always registers; the provider feed
// registers only when identity + credentials + feed_url are all present
// (partial config skips with the skip line, never fails). The stored
// password refreshes on an existing source (token rotation).
// Idempotent: list-check before add; update path for credential refresh.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { configGetRaw } from "../../lib/core/config.ts";
import { toolbox } from "./lib.ts";
import { providerSecretToken } from "./provider-seam.ts";
import { providerOrgGet, providerUserGet } from "../../lib/providers/provider-core.ts";

const root = toolbox();
// dotnet_cmd parity: resolve on PATH first, fall back to /usr/bin/dotnet —
// never hardcode, or PATH-stubbed environments (tests, custom installs)
// silently bypass the wrapper.
const dotnet = spawnSync("bash", ["-c", "command -v dotnet || echo /usr/bin/dotnet"], { encoding: "utf8" }).stdout?.trim() || "/usr/bin/dotnet";

function nuget(args: string[]): { status: number; out: string } {
  const r = spawnSync(dotnet, ["nuget", ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function addNugetSourceIfNotExists(name: string, url: string, username: string, password: string): void {
  const listed = nuget(["list", "source"]);
  if (!listed.out.includes(url)) {
    if (username !== "" && password !== "") {
      nuget(["add", "source", url, "-n", name, "-u", username, "-p", password, "--store-password-in-clear-text"]);
      console.log(`NuGet source ${name} with credentials added.`);
    } else {
      nuget(["add", "source", url, "-n", name]);
      console.log(`NuGet source ${name} added.`);
    }
  } else if (username !== "" && password !== "") {
    // The source exists, but its stored password may predate a token rotation.
    nuget(["update", "source", url, "-n", name, "-u", username, "-p", password, "--store-password-in-clear-text"]);
    console.log(`NuGet source ${name} credentials refreshed.`);
  } else {
    console.log(`NuGet source ${name} already exists.`);
  }
}

// Local dev source: always.
const localNugetDev = join(root, ".debug", "local-nuget-dev");
mkdirSync(localNugetDev, { recursive: true });
addNugetSourceIfNotExists("dev", localNugetDev, "", "");

// Provider feed (github scheme): [nuget] feed_url (NUGET_FEED_URL override
// wins), ${PROVIDER_ORG}/${PROVIDER_USER} templates expanded; the config read
// already returns expanded templates (the bash config reader expanded on
// read — here expansion is explicit for the override path).
const override = process.env.NUGET_FEED_URL ?? "";
let feedUrl = override !== "" ? override : (configGetRaw(join(root, "devenv.config"), "nuget", "feed_url") ?? "");
const feedOrg = providerOrgGet();
const feedUser = providerUserGet();
feedUrl = feedUrl.replace(/\$\{PROVIDER_ORG\}/g, feedOrg).replace(/\$\{PROVIDER_USER\}/g, feedUser);

const token = providerSecretToken();
if (token !== "" && feedUser !== "" && feedOrg !== "" && feedUrl !== "") {
  addNugetSourceIfNotExists("github", feedUrl, feedUser, token);
} else {
  console.log("Skipping GitHub NuGet feed: org/user identity, credentials, or feed_url not fully configured");
}
console.log("nuget-sources: ok");
