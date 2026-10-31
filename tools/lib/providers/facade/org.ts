// providers/facade/org.ts — the provider-neutral organization family.
//
// The only import surface tools use for org-level verbs (rulesets,
// releases). Normalizations owned here:
//   - Ruleset verbs: github's are sync (gh shells), azure's async (policies
//     REST, translating the ruleset payload per its mapping) — every facade
//     verb is async; github's sync bodies wrap in a resolved promise.
//   - RulesetMutationResult: github returns {ok, output}; azure's create/
//     update return records — the facade stringifies into the same shape.
//
// The module never exits; failures throw ProviderError and callers decide.

import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/org.ts";
import type * as azTypes from "../azure/org.ts";
import type * as azPolicyTypes from "../azure/policies.ts";

type GithubOrg = typeof ghTypes;
type AzureOrg = typeof azTypes;
type AzurePolicies = typeof azPolicyTypes;

export type RulesetMutationResult = ghTypes.RulesetMutationResult;

async function load(): Promise<{
  provider: string;
  gh: GithubOrg | undefined;
  az: AzureOrg | undefined;
  azPolicies: AzurePolicies | undefined;
}> {
  const loaded = await loadProviderModules("org");
  if (loaded.provider === "azure") {
    return {
      provider: "azure",
      gh: undefined,
      az: loaded.get<AzureOrg>("org.ts"),
      azPolicies: loaded.get<AzurePolicies>("policies.ts"),
    };
  }
  return { provider: "github", gh: loaded.get<GithubOrg>("org.ts"), az: undefined, azPolicies: undefined };
}

/** The org's rulesets for a repository (JSON text). */
export async function orgRulesetsList(repo: string): Promise<string> {
  const m = await load();
  return m.provider === "azure" ? m.azPolicies!.orgRulesetsList(repo) : m.gh!.orgRulesetsList(repo);
}

/** One ruleset by id (JSON text). */
export async function orgRulesetGet(repo: string, id: string): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    const out = await m.azPolicies!.orgRulesetGet(repo, id);
    return typeof out === "string" ? out : JSON.stringify(out);
  }
  return m.gh!.orgRulesetGet(repo, id);
}

/** Create a ruleset from a payload file. Azure's policies seam takes the
 * PARSED payload (it translates the github dialect per its mapping) and
 * returns void — the facade bridges both to github's {ok, stderr} shape. */
export async function orgRulesetCreate(repo: string, payloadFile: string): Promise<RulesetMutationResult> {
  const m = await load();
  if (m.provider === "azure") {
    const { readFileSync } = await import("node:fs");
    const payload = JSON.parse(readFileSync(payloadFile, "utf8"));
    await m.azPolicies!.orgRulesetCreate(repo, payload);
    return { ok: true, stderr: "" };
  }
  return m.gh!.orgRulesetCreate(repo, payloadFile);
}

/** Update a ruleset from a payload file (same payload bridge as create). */
export async function orgRulesetUpdate(repo: string, id: string, payloadFile: string): Promise<RulesetMutationResult> {
  const m = await load();
  if (m.provider === "azure") {
    const { readFileSync } = await import("node:fs");
    const payload = JSON.parse(readFileSync(payloadFile, "utf8"));
    await m.azPolicies!.orgRulesetUpdate(repo, id, payload);
    return { ok: true, stderr: "" };
  }
  return m.gh!.orgRulesetUpdate(repo, id, payloadFile);
}

/** List the org's releases (JSON text; flags are github's gh-release arg
 * list — azure's verb takes the limit/opts form). */
export async function orgReleasesList(repo: string, flags: string[] = []): Promise<string> {
  const m = await load();
  if (m.provider === "azure") {
    // The flags list carries gh-release syntax; azure's releases verb takes
    // no flags — a named error keeps the gap visible rather than a silently
    // different listing.
    if (flags.length > 0) {
      throw new Error("org_releases_list: release flags are a github-only surface (azure lists all releases)");
    }
    return m.az!.orgReleasesList(repo);
  }
  return m.gh!.orgReleasesList(repo, flags);
}
