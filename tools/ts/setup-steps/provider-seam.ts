#!/usr/bin/env node
// setup-steps/provider-seam.ts — the TS-side provider token resolution for
// the setup steps that need credentials (side-repo syncs, nuget/npmrc feeds).
//
// Port of provider-core.bash provider_secret_get (the "token" kind) for the
// setup context: env token only when allowlisted, then the provider's own
// token impl (`gh auth token` for github, run with GH_TOKEN/GITHUB_TOKEN
// scrubbed — same reason as the bash impl: gh would hand back the env token).
// Secrets are never logged.
//
// The allowlist carries the bash semantics exactly: [provider]
// token_env_allowlist in devenv.config; entries are "values" or
// "value:reason" pairs; matching is on the value before the first colon.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { configGetRaw } from "../../lib/core/config.ts";
import { providerAuthToken } from "../../lib/providers/provider-core.ts";
import { toolbox } from "./lib.ts";

function tokenEnvAllowed(value: string): boolean {
  const config = join(toolbox(), "devenv.config");
  let allow = process.env.PROVIDER_TOKEN_ENV_ALLOWLIST ?? "";
  if (existsSync(config)) {
    allow = configGetRaw(config, "provider", "token_env_allowlist") ?? "";
  }
  for (const entry of allow.split(/\s+/).filter(Boolean)) {
    const base = entry.split(":")[0] ?? "";
    if (value === base) return true;
  }
  return false;
}

function tokenEnvDeniedWarning(): void {
  console.error(
    "GH_TOKEN is set but not on the env allowlist (config key [provider] token_env_allowlist) — ignored; resolving via the provider credential store. Add an allowlist entry only with a documented justification.",
  );
}

/** Resolve the provider token: env (when allowlisted) → provider impl → "".
 * The empty string means unavailable (the caller applies the skip/warn
 * contract of its step). The CLI transport lives in the provider layer
 * (providerAuthToken facade verb — no tool shells to gh/az directly). */
export function providerSecretToken(): string {
  const ghToken = process.env.GH_TOKEN ?? "";
  if (ghToken !== "") {
    if (tokenEnvAllowed(ghToken)) return ghToken;
    tokenEnvDeniedWarning();
  }
  return providerAuthToken();
}

/** The git auth header for HTTPS fetches. github: base64("x-access-token:TOKEN")
 * as an AUTHORIZATION basic extraheader. azure: RFC 7617 basic auth with an
 * empty user and the PAT as the password (the form the REST transport sends). */
export function gitAuthHeader(provider: string, token: string): string {
  if (provider === "github") {
    const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
    return `AUTHORIZATION: basic ${auth}`;
  }
  if (provider === "azure") {
    const auth = Buffer.from(`:${token}`).toString("base64");
    return `AUTHORIZATION: Basic ${auth}`;
  }
  throw new Error(`git_auth_header: no scheme implemented for provider '${provider}'`);
}

/** True for an https Azure Artifacts feed URL. The Azure PAT must only ever
 * be sent to these hosts. */
export function isAzureArtifactsUrl(url: string): boolean {
  return /^https:\/\/(pkgs\.dev\.azure\.com|[A-Za-z0-9-]+\.pkgs\.visualstudio\.com)\//.test(url);
}

/** npmrc registry prefixes (host+path, no scheme, no trailing slash) for a
 * feed URL. A .../npm/registry/ feed is also served at .../npm/, and
 * credentials written for only one of the two are a known 401 source. */
export function npmrcFeedPrefixes(feedUrl: string): string[] {
  const prefix = feedUrl.replace(/^https:\/\//, "").replace(/\/$/, "");
  return prefix.endsWith("/npm/registry") ? [prefix, prefix.slice(0, -"/registry".length)] : [prefix];
}

/** The npmrc lines after registering an Azure Artifacts feed: existing
 * entries for these prefixes (and for the same scope mapping) are replaced,
 * everything else is kept, so reruns converge. The password is the
 * base64-encoded PAT, the documented user-level npmrc credential form. */
export function azureNpmrcLines(existing: string[], prefixes: string[], tokenB64: string, scope: string): string[] {
  const kept = existing.filter((line) => {
    if (prefixes.some((p) => line.startsWith(`//${p}/:`))) return false;
    if (scope !== "" && line.trimStart().startsWith(`${scope}:registry=`)) return false;
    return true;
  });
  // Drop trailing blank lines so appended entries stay contiguous across reruns.
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  for (const p of prefixes) {
    kept.push(`//${p}/:username=notempty`);
    kept.push(`//${p}/:_password=${tokenB64}`);
    kept.push(`//${p}/:email=npm-requires-email@example.invalid`);
  }
  if (scope !== "") kept.push(`${scope}:registry=https://${prefixes[0]}/`);
  kept.push("");
  return kept;
}

