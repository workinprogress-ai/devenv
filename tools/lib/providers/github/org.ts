// github/org.ts - GitHub implementation of the org domain facade: rulesets.
//
// Ports the provider_org_rulesets_* verbs the repo-types domain consumes
// (configure_rulesets_for_type). The rest of the org domain (releases,
// packages, feeds, issue-types beyond the issues.ts mirror) ports with its
// consuming batch per the family-batch doctrine. All ruleset endpoints are
// repository-scoped REST (`repos/{repo}/rulesets`).

import { ghApi, ghApiSync, providerDeclareCapability, providerRequireCapability } from "../provider-core.ts";

// Capability declarations (bash org.bash's declarations, carried over).
providerDeclareCapability("rulesets");

/** List rulesets for a repo (paginated). Returns gh's raw JSON array. */
export function orgRulesetsList(repo: string): string {
  providerRequireCapability("rulesets");
  const r = ghApiSync(["api", `repos/${repo}/rulesets`, "--paginate"], { tolerateFailure: true });
  if (r.status !== 0) throw new Error(`orgRulesetsList failed for '${repo}': ${r.stderr.trim()}`);
  return r.stdout;
}

/** Get a single ruleset (host-shaped). */
export function orgRulesetGet(repo: string, id: string): string {
  providerRequireCapability("rulesets");
  const r = ghApiSync(["api", `repos/${repo}/rulesets/${id}`], { tolerateFailure: true });
  if (r.status !== 0) throw new Error(`orgRulesetGet failed for '${repo}' '${id}': ${r.stderr.trim()}`);
  return r.stdout;
}

export interface RulesetMutationResult {
  ok: boolean;
  /** gh's own error text (name conflict, 403 upgrade guidance, ...) — the
   * caller classifies it the way bash's configure_rulesets_for_type did. */
  stderr: string;
}

/** Create a ruleset from a JSON payload file. */
export function orgRulesetCreate(repo: string, payloadFile: string): RulesetMutationResult {
  providerRequireCapability("rulesets");
  const r = ghApiSync(["api", "--input", payloadFile, "-X", "POST", `repos/${repo}/rulesets`], {
    tolerateFailure: true,
  });
  return { ok: r.status === 0, stderr: r.stderr };
}

/** Update a ruleset from a JSON payload file. */
export function orgRulesetUpdate(repo: string, id: string, payloadFile: string): RulesetMutationResult {
  providerRequireCapability("rulesets");
  const r = ghApiSync(["api", "--input", payloadFile, "-X", "PUT", `repos/${repo}/rulesets/${id}`], {
    tolerateFailure: true,
  });
  return { ok: r.status === 0, stderr: r.stderr };
}

// ghApi is imported for interface parity with the other domain modules; the
// ruleset verbs above use the sync transport because the bash originals are
// synchronous command substitutions whose callers branch on their output.
export { ghApi };

/** List releases for a repo, newest first. Flags (--limit N, --json FIELDS)
 * forward to gh verbatim. */
export function orgReleasesList(repo: string, flags: string[]): string {
  if (repo === "" || !repo.includes("/")) {
    throw new Error("orgReleasesList: repo must be owner/repo form");
  }
  const r = ghApiSync(["release", "list", "-R", repo, ...flags], { tolerateFailure: true });
  if (r.status !== 0) throw new Error(`orgReleasesList failed for '${repo}': ${r.stderr.trim()}`);
  return r.stdout;
}
