// azure/policies.ts — Azure DevOps implementation of the ruleset surface
// (port of azure/policies.bash): the repo-scoped policy configuration set is
// azure's analog of the other provider's org rulesets. Contract: throw
// ProviderError on failure; never process.exit.

import { ProviderError } from "../provider-core.ts";
import { azureHttp } from "./http.ts";
import { azureRepoParts, azureUri } from "./urls.ts";
import { repoGuidShared, reposDefaultBranch } from "./repos.ts";

/** The Minimum number of reviewers policy type id. */
export const AZURE_POLICY_MIN_REVIEWERS_TYPE = "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd";

/** Project-scoped policy base for a repo spec's org and project. */
function policyBase(repo: string): string {
  const { org, project } = azureRepoParts(repo);
  return `https://dev.azure.com/${azureUri(org)}/${azureUri(project)}/_apis/policy`;
}

interface RulesetPayload {
  conditions?: { ref_name?: { include?: string[] } };
  rules?: Array<{ type?: string; parameters?: { required_approving_review_count?: number } }>;
}

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

/** Translate a ruleset payload into azure policy documents. Rules with no
 * azure analog are skipped with a warning; pull_request → minimum reviewers. */
export function translateRuleset(
  payload: RulesetPayload,
  repoGuid: string,
  branch: string,
): Array<Record<string, unknown>> {
  if (repoGuid === "") throw new ProviderError("translate_ruleset: repo guid required");
  if (branch === "") throw new ProviderError("translate_ruleset: target branch required");
  const docs: Array<Record<string, unknown>> = [];
  const prRule = (payload.rules ?? []).find((r) => r.type === "pull_request");
  if (prRule !== undefined) {
    const minReviewers = prRule.parameters?.required_approving_review_count ?? 1;
    docs.push({
      type: { id: AZURE_POLICY_MIN_REVIEWERS_TYPE },
      isEnabled: true,
      isBlocking: true,
      settings: {
        scope: [{ repositoryId: repoGuid, matchKind: "exact", refName: `refs/heads/${branch}` }],
        minimumApproverCount: minReviewers,
        creatorVoteCounts: false,
        allowDownvotes: false,
        resetOnSourcePush: false,
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

interface PolicyConfig {
  id: number;
  type?: { id?: string; displayName?: string };
  isEnabled?: boolean;
  settings?: { displayName?: string; scope?: Array<{ repositoryId?: string }> };
}

/** List a repo's policy configurations, seam-shaped [{id,name,enforcement}]. */
export async function orgRulesetsList(repo: string): Promise<string> {
  const guid = await repoGuidShared(repo);
  const r = await azureHttp<{ value?: PolicyConfig[] }>("GET", `${policyBase(repo)}/configurations`);
  const rows = (r.value ?? [])
    .filter((c) => c.settings?.scope?.[0]?.repositoryId === guid)
    .map((c) => ({
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

interface ExistingConfig extends PolicyConfig {
  settings: { scope?: Array<{ repositoryId?: string; refName?: string }> } & Record<string, unknown>;
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
  const existing = await azureHttp<{ value?: ExistingConfig[] }>(
    "GET",
    `${base}/configurations`,
  );
  let created = 0;
  for (const branch of branches) {
    for (const policy of translateRuleset(payload, guid, branch)) {
      const ref = (policy.settings as { scope: Array<{ refName: string }> }).scope[0]!.refName;
      const hit = (existing.value ?? []).find(
        (c) =>
          c.type?.id === AZURE_POLICY_MIN_REVIEWERS_TYPE &&
          c.settings?.scope?.[0]?.repositoryId === guid &&
          c.settings?.scope?.[0]?.refName === ref,
      );
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
  const existing = await azureHttp<{ value?: ExistingConfig[] }>(
    "GET",
    `${base}/configurations`,
  );
  const replaced = (existing.value ?? []).find((c) => String(c.id) === policyId);
  if (
    replaced !== undefined &&
    replaced.type?.id === AZURE_POLICY_MIN_REVIEWERS_TYPE &&
    replaced.settings?.scope?.[0]?.repositoryId === guid
  ) {
    const ref = replaced.settings.scope?.[0]?.refName ?? "";
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
