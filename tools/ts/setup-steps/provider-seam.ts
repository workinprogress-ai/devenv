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

/** The git auth header for HTTPS fetches (github scheme:
 * base64("x-access-token:TOKEN") as an AUTHORIZATION basic extraheader —
 * providers/github/bootstrap.bash provider_bootstrap_git_auth_header). */
export function gitAuthHeader(provider: string, token: string): string {
  if (provider === "github") {
    const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
    return `AUTHORIZATION: basic ${auth}`;
  }
  throw new Error(`git_auth_header: no scheme implemented for provider '${provider}'`);
}
