// providers/facade/provider-loader.ts — the facade layer's dispatch helper.
//
// Tools never import a provider module; they import a facade
// (tools/lib/providers/facade/<family>.ts). The facade resolves the active
// provider via providerDetect() and dynamic-imports that provider's family
// modules through this loader, which:
//   - resolves modules relative to THIS file's location (import.meta.url) —
//     never PATH, never a toolsDir guess (the sibling-dispatch rule, applied
//     to intra-provider imports);
//   - caches the loaded family per process (providerDetect is itself
//     cached, so a mid-run config change is not observed — same contract as
//     every direct-import tool today);
//   - encodes the FAMILY MANIFEST: which of a provider's modules implement a
//     family's verbs. The layout is per-provider (Azure hosts the issues
//     family's issueWebUrl in urls.ts, GitHub in issues.ts), so the manifest
//     is the same-family boundary the provider-boundary test enforces: a
//     facade file may import exactly its family's manifest modules.

import {
  ProviderError,
  providerDetect,
  type ProviderName,
} from "../provider-core.ts";

/**
 * Which modules implement a family's verbs, per provider. Adding a family
 * (or a third provider) means adding its manifest row here; the facade file
 * and the boundary test both key off this layout.
 */
export const FAMILY_MANIFEST: Record<
  string,
  Partial<Record<ProviderName, string[]>>
> = {
  issues: {
    github: ["issues.ts"],
    azure: ["issues.ts", "urls.ts"],
  },
  projects: {
    github: ["projects.ts"],
    azure: ["projects.ts"],
  },
  prs: {
    github: ["prs.ts", "urls.ts"],
    azure: ["prs.ts", "urls.ts", "auth.ts"],
  },
  urls: {
    github: ["urls.ts"],
    azure: ["urls.ts", "auth.ts"],
  },
  repos: {
    github: ["repos.ts"],
    azure: ["repos.ts"],
  },
  org: {
    github: ["org.ts"],
    azure: ["org.ts", "policies.ts"],
  },
  pipelines: {
    github: ["pipelines.ts"],
    azure: ["pipelines.ts"],
  },
};

/** A loaded family: the active provider plus typed access to its modules. */
export interface LoadedModules {
  /** The provider the family was loaded for (snapshot of providerDetect).
   */
  provider: ProviderName;
  /** The provider module implementing `file` for this family, typed by the
   * caller. A file outside the family's manifest is a programming bug —
   * throws instead of returning undefined. */
  get<T>(file: string): T;
}

const cache = new Map<string, LoadedModules>();

/** Load (or fetch from cache) the active provider's modules for a family.
 * The cache is keyed by the detected provider, but it does not observe a
 * forced re-detection (`providerDetect(true)`) — a long-lived in-process
 * caller that flips the provider must not reuse stale family modules. */
export async function loadProviderModules(family: string): Promise<LoadedModules> {
  const provider = providerDetect();
  const key = `${provider}/${family}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const files = FAMILY_MANIFEST[family]?.[provider];
  if (files === undefined) {
    throw new ProviderError(
      `provider-loader: no module manifest for family '${family}' on provider '${provider}' — ` +
        `add it to FAMILY_MANIFEST in providers/facade/provider-loader.ts`,
    );
  }

  const modules = new Map<string, unknown>();
  for (const file of files) {
    // Resolved from this file's own URL: facade/ sits beside the provider
    // directories, so ../<provider>/<file> is exact — no cwd, no PATH.
    modules.set(
      file,
      await import(new URL(`../${provider}/${file}`, import.meta.url).href),
    );
  }

  const loaded: LoadedModules = {
    provider,
    get<T>(file: string): T {
      const mod = modules.get(file);
      if (mod === undefined) {
        throw new ProviderError(
          `provider-loader: family '${family}' on '${provider}' has no module '${file}' ` +
            `(manifest: ${files.join(", ")})`,
        );
      }
      return mod as T;
    },
  };
  cache.set(key, loaded);
  return loaded;
}

/** Drop all cached family modules. Only a forced provider re-detection
 * (`providerDetect(true)`) can change the active provider mid-process, and
 * the loader cannot observe that — callers that force a re-detect call this
 * first. */
export function clearProviderModuleCache(): void {
  cache.clear();
}

/** Load the family and require the given capability of the active provider.
 *
 * Tools gate on capabilities at module load (the bash seam's contract), but
 * under lazy facade loading the provider module — which declares its
 * capabilities as a load side effect — is not yet imported when that gate
 * runs. This is the facade's answer: load the family FIRST (its side effects
 * declare the capabilities), then run the capability gate. A tool's
 * capability check becomes `await loadProviderModules("pipelines").then(() =>
 * providerRequireCapability("pipelines"))` — or, simpler, this wrapper. */
export async function requireFamilyCapability(family: string, cap: Parameters<typeof import("../provider-core.ts").providerRequireCapability>[0]): Promise<void> {
  await loadProviderModules(family);
  const { providerRequireCapability } = await import("../provider-core.ts");
  providerRequireCapability(cap);
}

/** The manifest modules a family's facade may import on a provider — the
 * same-family rule's source of truth (the boundary test reads this). */
export function familyManifestModules(family: string): string[] {
  const rows = FAMILY_MANIFEST[family];
  if (rows === undefined) return [];
  return [...new Set(Object.values(rows).flat())];
}
