// providers/facade/urls.ts — the provider-neutral URL/address family.
//
// The only import surface tools use for address verbs (auth status, remote
// URL parsing, display addresses). The providers' verbs are
// signature-identical by contract (extractUrl, remoteToSpec, remoteToWeb,
// prWebUrl, webHost) — this facade is pass-through dispatch; the
// provider-specific behavior lives where it belongs (azure's authStatusOk
// reads az credential state, github's shells `gh auth status`).
//
// The module never exits; failures throw ProviderError and callers decide.

import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/urls.ts";
import type * as azTypes from "../azure/urls.ts";
import type * as azAuthTypes from "../azure/auth.ts";

type GithubUrls = typeof ghTypes;
type AzureUrls = typeof azTypes;
type AzureAuth = typeof azAuthTypes;

async function load(): Promise<{ provider: string; gh: GithubUrls | undefined; az: AzureUrls | undefined; azAuth: AzureAuth | undefined }> {
  const loaded = await loadProviderModules("urls");
  if (loaded.provider === "azure") {
    return {
      provider: "azure",
      gh: undefined,
      az: loaded.get<AzureUrls>("urls.ts"),
      azAuth: loaded.get<AzureAuth>("auth.ts"),
    };
  }
  return { provider: "github", gh: loaded.get<GithubUrls>("urls.ts"), az: undefined, azAuth: undefined };
}

/** The provider can operate (credential present and sane). */
export async function authStatusOk(): Promise<boolean> {
  const m = await load();
  return m.provider === "azure"
    ? m.azAuth!.authStatusOk()
    : m.gh!.authStatusOk();
}

/** Extract the record URL from provider CLI output. */
export async function extractUrl(output: string, pathPrefix = ""): Promise<string | null> {
  const m = await load();
  return m.provider === "azure" ? m.az!.extractUrl(output, pathPrefix) : m.gh!.extractUrl(output, pathPrefix);
}

/** A git remote URL as this provider's repo spec (null when foreign). */
export async function remoteToSpec(remote: string): Promise<string | null> {
  const m = await load();
  return m.provider === "azure" ? m.az!.remoteToSpec(remote) : m.gh!.remoteToSpec(remote);
}

/** A git remote URL as a browser address (null when foreign). */
export async function remoteToWeb(remote: string): Promise<string | null> {
  const m = await load();
  return m.provider === "azure" ? m.az!.remoteToWeb(remote) : m.gh!.remoteToWeb(remote);
}

/** A PR's browser address. */
export async function prWebUrl(spec: string, number: number): Promise<string> {
  const m = await load();
  return m.provider === "azure" ? m.az!.prWebUrl(spec, number) : m.gh!.prWebUrl(spec, number);
}

/** The repository's https transport (clone/fetch) address. github takes
 * org+repo; azure's 3-arg form (org, project, repo) normalizes from the
 * same two strings (project==repo is its accepted shorthand). */
export async function gitTransportUrl(org: string, repo: string): Promise<string> {
  const m = await load();
  return m.provider === "azure" ? m.az!.gitTransportUrl(org, repo) : m.gh!.gitTransportUrl(org, repo);
}
