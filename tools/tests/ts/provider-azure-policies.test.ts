// Ruleset → Azure policy translation and the write path: every rule or
// parameter that has no Azure counterpart is named, the payload's enforcement
// is honored, configuration reads are filtered and paged, an existing policy
// is found through any of its scope entries, and a policy that names no branch
// is never retired.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import {
  AZURE_POLICY_MIN_REVIEWERS_TYPE,
  orgRulesetCreate,
  orgRulesetUpdate,
  orgRulesetsList,
  translateRuleset,
} from "../../lib/providers/azure/policies.ts";

const REPO_URL = "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets?api-version=7.1";
const CONFIGS = /\/_apis\/policy\/configurations/;
const GUID = "g1";

let restoreEnv: () => void = () => {};
let warnings = "";

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
  warnings = "";
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    warnings += a.join(" ") + "\n";
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

const settingsOf = (doc: Record<string, unknown> | undefined) => doc?.["settings"] as Record<string, unknown>;

describe("translateRuleset warnings", () => {
  it("warns once per untranslated rule type, even when another rule translates", () => {
    translateRuleset(
      {
        rules: [
          { type: "pull_request", parameters: { required_approving_review_count: 2 } },
          { type: "required_status_checks" },
          { type: "required_status_checks" },
          { type: "non_fast_forward" },
        ],
      },
      GUID,
      "main",
    );
    expect(warnings.match(/required_status_checks/g)).toHaveLength(1);
    expect(warnings).toContain("non_fast_forward");
  });

  it("names every pull_request parameter Azure has no setting for", () => {
    translateRuleset(
      {
        rules: [
          {
            type: "pull_request",
            parameters: { required_approving_review_count: 1, require_code_owner_review: true, allowed_merge_methods: ["rebase"] },
          },
        ],
      },
      GUID,
      "main",
    );
    expect(warnings).toContain("require_code_owner_review");
    expect(warnings).toContain("allowed_merge_methods");
    expect(warnings).not.toContain("required_approving_review_count");
  });

  it("is quiet for a payload that translates completely", () => {
    translateRuleset({ rules: [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }] }, GUID, "main");
    expect(warnings).toBe("");
  });
});

describe("translateRuleset settings", () => {
  const pr = (parameters: Record<string, unknown>, enforcement?: string) =>
    translateRuleset({ ...(enforcement !== undefined ? { enforcement } : {}), rules: [{ type: "pull_request", parameters }] }, GUID, "main")[0];

  it("maps dismiss_stale_reviews_on_push to resetOnSourcePush", () => {
    expect(settingsOf(pr({ dismiss_stale_reviews_on_push: true }))["resetOnSourcePush"]).toBe(true);
    expect(settingsOf(pr({}))["resetOnSourcePush"]).toBe(false);
  });

  it("warns about an unknown enforcement value and treats it as active", () => {
    const doc = pr({}, "Enforced");
    expect(warnings).toContain("Enforced");
    expect(doc?.["isEnabled"]).toBe(true);
    expect(doc?.["isBlocking"]).toBe(true);
  });

  it.each([
    ["active", true, true],
    [undefined, true, true],
    ["evaluate", true, false],
    ["disabled", false, false],
  ])("maps enforcement %s to enabled=%s blocking=%s", (enforcement, enabled, blocking) => {
    const doc = pr({}, enforcement);
    expect(doc?.["isEnabled"]).toBe(enabled);
    expect(doc?.["isBlocking"]).toBe(blocking);
  });
});

describe("policy configuration reads and matching", () => {
  const reviewers = (id: number, scope: unknown[]) => ({
    id,
    type: { id: AZURE_POLICY_MIN_REVIEWERS_TYPE, displayName: "Minimum number of reviewers" },
    isEnabled: true,
    settings: { scope },
  });
  const repoRoute = { method: "GET", url: REPO_URL, respond: azureJson({ id: GUID, defaultBranch: "refs/heads/main" }) };
  const payload = { rules: [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }] };

  it("filters the read by repository and policy type", async () => {
    const stub = stubAzureFetch([
      repoRoute,
      { method: "GET", url: CONFIGS, respond: azureJson({ value: [] }) },
      { method: "POST", url: CONFIGS, respond: azureJson({ id: 1 }) },
    ]);
    await orgRulesetCreate("widgets", payload);
    const read = stub.requests.find((r) => r.method === "GET" && CONFIGS.test(r.url))?.url ?? "";
    expect(read).toContain(`repositoryId=${GUID}`);
    expect(read).toContain(`policyType=${AZURE_POLICY_MIN_REVIEWERS_TYPE}`);
  });

  it("finds an existing policy on a later page instead of creating a duplicate", async () => {
    const mine = reviews(7);
    function reviews(id: number) {
      return reviewers(id, [{ repositoryId: GUID, matchKind: "exact", refName: "refs/heads/main" }]);
    }
    const stub = stubAzureFetch([
      repoRoute,
      {
        method: "GET",
        url: CONFIGS,
        respond: (req) =>
          req.url.includes("continuationToken=p2")
            ? azureJson({ value: [mine] })
            : azureJson({ value: [], continuationToken: "p2" }),
      },
      { method: "PUT", url: /configurations\/7\?/, respond: azureJson({ id: 7 }) },
    ]);
    await orgRulesetCreate("widgets", payload);
    expect(stub.requests.some((r) => r.method === "POST")).toBe(false);
    expect(stub.requests.some((r) => r.method === "PUT")).toBe(true);
  });

  it("refuses to overwrite a policy that covers several scopes", async () => {
    const shared = reviewers(11, [
      { repositoryId: GUID, matchKind: "exact", refName: "refs/heads/main" },
      { repositoryId: "other", matchKind: "exact", refName: "refs/heads/main" },
    ]);
    const stub = stubAzureFetch([repoRoute, { method: "GET", url: CONFIGS, respond: azureJson({ value: [shared] }) }]);
    await expect(orgRulesetCreate("widgets", payload)).rejects.toThrow(/several scopes/);
    expect(stub.requests.some((r) => r.method === "PUT" || r.method === "POST")).toBe(false);
  });

  it("does not retire a policy that covers several scopes", async () => {
    const shared = reviewers(12, [
      { repositoryId: GUID, matchKind: "exact", refName: "refs/heads/old" },
      { repositoryId: "other", matchKind: "exact", refName: "refs/heads/old" },
    ]);
    const stub = stubAzureFetch([
      repoRoute,
      { method: "GET", url: CONFIGS, respond: azureJson({ value: [shared] }) },
      { method: "POST", url: CONFIGS, respond: azureJson({ id: 13 }) },
      { method: "DELETE", url: /configurations\/12\?/, respond: azureJson({}) },
    ]);
    await orgRulesetUpdate("widgets", "12", payload);
    expect(stub.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("lists a repository's policies through any scope entry", async () => {
    stubAzureFetch([
      repoRoute,
      { method: "GET", url: CONFIGS, respond: azureJson({ value: [reviewers(3, [{ repositoryId: "other" }, { repositoryId: GUID }])] }) },
    ]);
    const rows = JSON.parse(await orgRulesetsList("widgets")) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["3"]);
  });

  it("does not retire a policy that names no branch", async () => {
    const portalMade = reviewers(5, [{ repositoryId: GUID }]);
    const stub = stubAzureFetch([
      repoRoute,
      { method: "GET", url: CONFIGS, respond: azureJson({ value: [portalMade] }) },
      { method: "POST", url: CONFIGS, respond: azureJson({ id: 6 }) },
      { method: "DELETE", url: /configurations\/5\?/, respond: azureJson({}) },
    ]);
    await orgRulesetUpdate("widgets", "5", payload);
    expect(stub.requests.some((r) => r.method === "DELETE")).toBe(false);
  });
});
