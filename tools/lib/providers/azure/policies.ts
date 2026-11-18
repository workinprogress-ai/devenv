// azure/policies.ts — Azure DevOps implementation of the ruleset surface:
// the repo-scoped policy configuration set is
// azure's analog of the other provider's org rulesets. Contract: throw
// ProviderError on failure; never process.exit.

import { ProviderError } from "../provider-core.ts";
import { azureHttp } from "./http.ts";
import { azureRepoParts, azureUri } from "./urls.ts";
import {
  assertSingleScope,
  listPolicyConfigurations,
  policyOnRepo,
  repoGuidShared,
  reposDefaultBranch,
  type PolicyConfiguration,
} from "./repos.ts";

/** The Minimum number of reviewers policy type id. */
export const AZURE_POLICY_MIN_REVIEWERS_TYPE = "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd";

/** Project-scoped policy base for a repo spec's org and project. */
function policyBase(repo: string): string {
  const { org, project } = azureRepoParts(repo);
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/policy`;
}

interface RulesetPayload {
  /** active (default) | evaluate | disabled. */
  enforcement?: string;
  conditions?: { ref_name?: { include?: string[] } };
  rules?: Array<{ type?: string; parameters?: Record<string, unknown> }>;
}

/** pull_request parameters that become part of the minimum-reviewers policy. */
const TRANSLATED_PR_PARAMETERS = new Set(["required_approving_review_count", "dismiss_stale_reviews_on_push"]);

/** The error for a ruleset that leaves no branch to protect. */
function noBranchError(verb: string): never {
  throw new ProviderError(
    `${verb}: the ruleset names no branch an Azure policy can protect; use refs/heads/<name>, ~DEFAULT_BRANCH or ~ALL (a branch pattern with a wildcard, a tag ref or a bare name does not qualify)`,
  );
}

/** The branches a ruleset applies to. No ref condition → the default branch.
 * Otherwise every explicit refs/heads/<name> in include, plus the default
 * branch when the list carries ~DEFAULT_BRANCH or ~ALL. A wildcard pattern
 * has no single branch to name — skipped with a warning. */
export function rulesetBranches(payload: RulesetPayload, defaultBranch: string): string[] {
  const includes = payload.conditions?.ref_name?.include ?? [];
  if (includes.length === 0) return [defaultBranch];
  const wildcards = includes.filter((i) => i.startsWith("refs/heads/") && i.includes("*"));
  if (wildcards.length > 0) {
    console.error(`WARN: azure ruleset: skipping a branch pattern with no single branch to protect: ${wildcards.join(",")}`);
  }
  const out: string[] = [];
  for (const inc of includes) {
    if (inc.startsWith("refs/heads/") && !inc.includes("*")) {
      out.push(inc.replace(/^refs\/heads\//, ""));
    }
  }
  if (includes.includes("~ALL")) {
    console.error("WARN: azure ruleset: ~ALL protects the default branch only (an Azure policy names one branch)");
  }
  if (includes.includes("~DEFAULT_BRANCH") || includes.includes("~ALL")) {
    out.push(defaultBranch);
  }
  return [...new Set(out.filter((b) => b !== ""))];
}

/** Translate a ruleset payload into azure policy documents. Only
 * pull_request becomes a policy (minimum reviewers); each other rule type and
 * each pull_request parameter without an Azure setting is named in one
 * warning, once. The payload's enforcement sets the policy's enabled and
 * blocking flags (evaluate is enabled but not blocking). */
export function translateRuleset(
  payload: RulesetPayload,
  repoGuid: string,
  branch: string,
): Array<Record<string, unknown>> {
  if (repoGuid === "") throw new ProviderError("translate_ruleset: repo guid required");
  if (branch === "") throw new ProviderError("translate_ruleset: target branch required");
  const docs: Array<Record<string, unknown>> = [];
  const rules = payload.rules ?? [];
  const prRule = rules.find((r) => r.type === "pull_request");
  const untranslated = [...new Set(rules.map((r) => r.type ?? "").filter((t) => t !== "" && t !== "pull_request"))];
  for (const type of untranslated) {
    console.error(`WARN: translate_ruleset: rule '${type}' has no Azure policy equivalent — not translated`);
  }
  if (prRule !== undefined) {
    const params = prRule.parameters ?? {};
    for (const name of Object.keys(params)) {
      if (!TRANSLATED_PR_PARAMETERS.has(name)) {
        console.error(`WARN: translate_ruleset: pull_request parameter '${name}' has no Azure setting — ignored`);
      }
    }
    const count = params["required_approving_review_count"];
    let enforcement = payload.enforcement ?? "active";
    if (!["active", "evaluate", "disabled"].includes(enforcement)) {
      console.error(`WARN: translate_ruleset: unknown enforcement '${enforcement}' — treated as active`);
      enforcement = "active";
    }
    docs.push({
      type: { id: AZURE_POLICY_MIN_REVIEWERS_TYPE },
      isEnabled: enforcement !== "disabled",
      isBlocking: enforcement === "active",
      settings: {
        scope: [{ repositoryId: repoGuid, matchKind: "exact", refName: `refs/heads/${branch}` }],
        minimumApproverCount: typeof count === "number" ? count : 1,
        creatorVoteCounts: false,
        allowDownvotes: false,
        resetOnSourcePush: params["dismiss_stale_reviews_on_push"] === true,
      },
    });
  }
  if (docs.length === 0) {
    console.error(
      "WARN: translate_ruleset: no translatable rules in payload (only pull_request maps to an azure policy)",
    );
  }
  return docs;
}

/** List a repo's policy configurations, seam-shaped [{id,name,enforcement}]. */
export async function orgRulesetsList(repo: string): Promise<string> {
  const guid = await repoGuidShared(repo);
  const rows = (await listPolicyConfigurations(policyBase(repo), guid)).map((c) => ({
    id: String(c.id),
    name: c.type?.displayName ?? c.settings?.displayName ?? "policy",
    enforcement: c.isEnabled === true ? "active" : "disabled",
  }));
  return JSON.stringify(rows);
}

/** Get one policy configuration (raw JSON). */
export async function orgRulesetGet(repo: string, policyId: string): Promise<unknown> {
  return azureHttp("GET", `${policyBase(repo)}/configurations/${policyId}`);
}

/** Shared write path: for each branch × translated policy, update in place
 * when the repo+branch already carries one of the type (a retry after a
 * partial failure lands there), else POST. */
async function writeTranslated(
  repo: string,
  payload: RulesetPayload,
  verb: string,
): Promise<number> {
  const guid = await repoGuidShared(repo);
  const base = policyBase(repo);
  const defaultBranch = await reposDefaultBranch(repo);
  const branches = rulesetBranches(payload, defaultBranch);
  if (branches.length === 0) noBranchError(verb);
  const existing = await listPolicyConfigurations(base, guid, AZURE_POLICY_MIN_REVIEWERS_TYPE);
  let created = 0;
  for (const branch of branches) {
    for (const policy of translateRuleset(payload, guid, branch)) {
      const ref = (policy.settings as { scope: Array<{ refName: string }> }).scope[0]!.refName;
      const hit = existing.find((c) => (c.settings?.scope ?? []).some((e) => e.repositoryId === guid && e.refName === ref));
      if (hit !== undefined) assertSingleScope(hit);
      if (hit !== undefined) {
        await azureHttp("PUT", `${base}/configurations/${hit.id}`, {
          body: JSON.stringify(policy),
        });
      } else {
        await azureHttp("POST", `${base}/configurations`, {
          body: JSON.stringify(policy),
        });
      }
      created++;
    }
  }
  return created;
}

/** Create policies from a ruleset payload. Creating the same ruleset twice is
 * safe (in-place update). Fails when nothing was written. */
export async function orgRulesetCreate(
  repo: string,
  payload: RulesetPayload,
): Promise<void> {
  const created = await writeTranslated(repo, payload, "org_ruleset_create");
  if (created === 0) throw new ProviderError("org_ruleset_create: nothing written");
}

/** Update: write the payload's policies, then retire RULESET_ID when it is a
 * reviewers policy on this repo that no write reused (DELETE) — policies on
 * other branches, including portal-made ones, and other policy types are
 * never touched. A failed write leaves the previous protection in place
 * (throws before retirement). */
export async function orgRulesetUpdate(
  repo: string,
  policyId: string,
  payload: RulesetPayload,
): Promise<void> {
  const guid = await repoGuidShared(repo);
  const base = policyBase(repo);
  const created = await writeTranslated(repo, payload, "org_ruleset_update");
  if (created === 0) {
    throw new ProviderError("org_ruleset_update: nothing written");
  }
  // Retire the replaced policy when no write reused it (its branch moved):
  // a reviewers policy on this repo, DELETEd. Kept ids are the ones writes
  // landed on in this call — writeTranslated does not surface them, so the
  // check is the state after: a policy still matching the payload's branches
  // was reused, anything else matching the id is retired.
  if (policyId === "") return;
  const existing = await listPolicyConfigurations(base, guid, AZURE_POLICY_MIN_REVIEWERS_TYPE);
  const replaced: PolicyConfiguration | undefined = existing.find((c) => String(c.id) === policyId);
  // A policy that names no branch (portal-made, prefix match) has nothing the
  // payload could have moved away from: it is left alone.
  const ref = replaced?.settings?.scope?.find((e) => e.repositoryId === guid)?.refName ?? "";
  // A policy shared with other scopes would lose them on deletion: it is left
  // alone, like one that names no branch.
  if (replaced !== undefined && policyOnRepo(replaced, guid) && ref !== "" && (replaced.settings?.scope ?? []).length === 1) {
    const defaultBranch = await reposDefaultBranch(repo);
    const payloadBranches = rulesetBranches(payload, defaultBranch).map(
      (b) => `refs/heads/${b}`,
    );
    if (payloadBranches.includes(ref)) return; // reused by a write
    console.error(
      `WARN: org_ruleset_update: retiring policy ${policyId} on ${ref}: the payload no longer covers it`,
    );
    await azureHttp("DELETE", `${base}/configurations/${policyId}`);
  }
}
