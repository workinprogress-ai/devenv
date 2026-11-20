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
// token_env_allowlist in devenv.config holds env-var NAMES — "NAME" or
// "NAME:reason" entries, space-separated; matching is on the name before the
// first colon. A session token export is honored only when its variable is
// listed (the list is never compared with the token's value). Under the azure
// provider the GitHub token variable is not a token source at all, so a GitHub
// token can never be handed to Azure feeds.

import { existsSync } from "node:fs";
import { configGetRaw } from "../../lib/core/config.ts";
import { providerAuthToken, providerConfigPath, providerDetect } from "../../lib/providers/provider-core.ts";

export type PackageFeedKind = "npm" | "nuget";

export type PackageFeedConfig =
  | {
      configured: true;
      kind: PackageFeedKind;
      url: string;
      sourceName: string;
      displayName: string;
      username?: string;
      authHost: string;
    }
  | {
      configured: false;
      kind: PackageFeedKind;
      reason: string;
    };

function feedAuthHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Resolve provider-owned feed configuration without reading credentials. */
export function packageFeedConfig(kind: PackageFeedKind, configuredOverride = ""): PackageFeedConfig {
  const provider = providerDetect();
  const configuredUrl = configGetRaw(providerConfigPath(), kind, "feed_url")?.trim() ?? "";
  const requestedUrl = configuredOverride.trim() !== "" ? configuredOverride.trim() : configuredUrl;
  const url = kind === "npm" && provider === "github" && requestedUrl === ""
    ? "https://npm.pkg.github.com"
    : requestedUrl;
  if (url === "") {
    return {
      configured: false,
      kind,
      reason: `[${kind}] feed_url is not configured for provider '${provider}'`,
    };
  }
  if (kind === "npm" && provider === "github" && feedAuthHost(url) !== "npm.pkg.github.com") {
    return {
      configured: false,
      kind,
      reason: "[npm] feed_url is outside GitHub Packages",
    };
  }
  if (provider === "azure" && !isAzureArtifactsUrl(url)) {
    return {
      configured: false,
      kind,
      reason: `[${kind}] feed_url is not an Azure Artifacts URL`,
    };
  }
  const authHost = feedAuthHost(url);
  if (authHost === undefined) {
    return {
      configured: false,
      kind,
      reason: `[${kind}] feed_url is not a valid URL`,
    };
  }
  return {
    configured: true,
    kind,
    url,
    sourceName: provider,
    displayName: provider === "github" ? "GitHub" : "Azure",
    ...(provider === "azure" ? { username: "azure" } : {}),
    authHost,
  };
}

function tokenEnvAllowed(name: string): boolean {
  // The same config path provider detection reads.
  const config = providerConfigPath();
  let allow = process.env.PROVIDER_TOKEN_ENV_ALLOWLIST ?? "";
  if (existsSync(config)) {
    allow = configGetRaw(config, "provider", "token_env_allowlist") ?? "";
  }
  for (const entry of allow.split(/\s+/).filter(Boolean)) {
    if ((entry.split(":")[0] ?? "") === name) return true;
  }
  return false;
}

function tokenEnvDeniedWarning(): void {
  console.error(
    "GH_TOKEN is set but not on the env allowlist (config key [provider] token_env_allowlist, which lists env-var names such as GH_TOKEN) — ignored; resolving via the provider credential store. Add an allowlist entry only with a documented justification.",
  );
}

/** Resolve the provider token: env (when allowlisted) → provider impl → "".
 * The empty string means unavailable (the caller applies the skip/warn
 * contract of its step). The CLI transport lives in the provider layer
 * (providerAuthToken facade verb — no tool shells to gh/az directly). */
export function providerSecretToken(): string {
  // GH_TOKEN is a GitHub credential: it is no token source under azure.
  const ghToken = providerDetect() === "azure" ? "" : (process.env.GH_TOKEN ?? "");
  if (ghToken !== "") {
    if (tokenEnvAllowed("GH_TOKEN")) return ghToken;
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

