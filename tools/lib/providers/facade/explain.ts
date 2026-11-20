// providers/facade/explain.ts — provider-owned calling requirements.

import type { ProviderExplain } from "../explain.ts";
import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/explain.ts";
import type * as azTypes from "../azure/explain.ts";

type GithubExplain = typeof ghTypes;
type AzureExplain = typeof azTypes;

/** Explain data for the active provider, loaded through the provider manifest. */
export async function providerExplain(): Promise<ProviderExplain> {
  const loaded = await loadProviderModules("explain");
  if (loaded.provider === "azure") {
    return loaded.get<AzureExplain>("explain.ts").azureExplain();
  }
  return loaded.get<GithubExplain>("explain.ts").githubExplain();
}
