// providers/facade/org.ts — the provider-neutral organization family.
//
// The only import surface tools use for org-level verbs (rulesets,
// releases). Normalizations owned here:
//   - Ruleset verbs: github's are sync (gh shells), azure's async (policies
//     REST, translating the ruleset payload per its mapping) — every facade
//     verb is async; github's sync bodies wrap in a resolved promise.
//   - Ruleset mutation failures are classified here; provider-specific hints
//     and message parsing stay out of domain code.
//
// The module never exits; failures throw ProviderError and callers decide.

import { ProviderError, type ProviderName } from "../provider-core.ts";
import type { GhResult } from "../github/transport.ts";
import { loadProviderModules } from "./provider-loader.ts";
import type * as ghTypes from "../github/org.ts";
import type * as azTypes from "../azure/org.ts";
import type * as azPolicyTypes from "../azure/policies.ts";

type GithubOrg = typeof ghTypes;
type AzureOrg = typeof azTypes;
type AzurePolicies = typeof azPolicyTypes;

export type RulesetMutationFailureKind =
  | "permission"
  | "plan-limit"
  | "unsupported"
  | "other";

export type RulesetMutationResult =
  | { ok: true; stderr: "" }
  | {
      ok: false;
      kind: RulesetMutationFailureKind;
      message: string;
      hint?: string;
      /** Compatibility for callers migrated by the following task. */
      stderr: string;
    };

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

/** Classify a provider's rejected ruleset write without leaking host wording. */
export function classifyRulesetMutationFailure(
  provider: ProviderName,
  message: string,
): Extract<RulesetMutationResult, { ok: false }> {
  const normalized = message.toLowerCase();
  let kind: RulesetMutationFailureKind = "other";
  let hint: string | undefined;
  if (
    provider === "github"
    && (normalized.includes("upgrade to github pro") || normalized.includes("make this repository public"))
  ) {
    kind = "plan-limit";
    hint = "Rulesets require GitHub Pro or a public repository";
  } else if (
    normalized.includes("403")
    || normalized.includes("permission")
    || normalized.includes("denied")
  ) {
    kind = "permission";
    hint = provider === "azure"
      ? "Ensure the Azure credentials can manage repository policies"
      : "Ensure the GitHub credentials can administer repository rulesets";
  } else if (normalized.includes("not supported")) {
    kind = "unsupported";
  }
  return { ok: false, kind, message, stderr: message, ...(hint !== undefined ? { hint } : {}) };
}

/** Run an Azure policy write and classify provider-owned failures. */
async function azureMutation(write: () => Promise<unknown>): Promise<RulesetMutationResult> {
  try {
    await write();
    return { ok: true, stderr: "" };
  } catch (err) {
    if (err instanceof ProviderError) return classifyRulesetMutationFailure("azure", err.message);
    throw err;
  }
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
    return azureMutation(() => m.azPolicies!.orgRulesetCreate(repo, payload));
  }
  const result = m.gh!.orgRulesetCreate(repo, payloadFile);
  return result.ok
    ? { ok: true, stderr: "" }
    : classifyRulesetMutationFailure("github", result.stderr);
}

/** Update a ruleset from a payload file (same payload bridge as create). */
export async function orgRulesetUpdate(repo: string, id: string, payloadFile: string): Promise<RulesetMutationResult> {
  const m = await load();
  if (m.provider === "azure") {
    const { readFileSync } = await import("node:fs");
    const payload = JSON.parse(readFileSync(payloadFile, "utf8"));
    return azureMutation(() => m.azPolicies!.orgRulesetUpdate(repo, id, payload));
  }
  const result = m.gh!.orgRulesetUpdate(repo, id, payloadFile);
  return result.ok
    ? { ok: true, stderr: "" }
    : classifyRulesetMutationFailure("github", result.stderr);
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

/** Query packages for an owner (or one of its repositories). GitHub: gh's own
 * result for GitHub Packages, failure included. Azure: the packages of the
 * configured Artifacts feeds, as the same `{stdout, stderr, status}` envelope.
 * `name` is an optional hint some providers pass to the server as a name
 * query; the caller still filters, so a provider may ignore it. */
export async function orgPackagesQuery(
  owner: string,
  opts: { type?: string; repo?: string; paginate?: boolean; name?: string } = {},
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    return m.az!.orgPackagesQuery({
      ...(opts.type !== undefined ? { type: opts.type } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    });
  }
  return m.gh!.orgPackagesQuery(owner, opts);
}

/** Query the versions of one package (newest first). */
export async function orgPackageVersionsQuery(
  owner: string,
  type: string,
  name: string,
  opts: { repo?: string; paginate?: boolean } = {},
): Promise<GhResult> {
  const m = await load();
  if (m.provider === "azure") {
    return m.az!.orgPackageVersionsQuery(type, name);
  }
  return m.gh!.orgPackageVersionsQuery(owner, type, name, opts);
}

/** Resolve provider-owned package repository scoping for domain callers. */
export async function orgPackageScope(
  owner: string,
  repo?: string,
): Promise<{ owner: string; repo?: string }> {
  const m = await load();
  if (repo === undefined || repo === "") return { owner };
  if (m.provider === "azure") {
    throw new ProviderError("package repository scoping is not supported on provider 'azure'");
  }
  const slash = repo.indexOf("/");
  if (slash > 0 && slash < repo.length - 1) {
    return { owner: repo.slice(0, slash), repo: repo.slice(slash + 1) };
  }
  return { owner, repo };
}

/** The error for a verb azure has no equivalent of. */
function azureUnsupported(verb: string): never {
  throw new ProviderError(`${verb} is not supported on provider 'azure'`);
}
