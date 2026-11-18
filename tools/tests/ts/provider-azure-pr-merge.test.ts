// prsMerge completion strategy. Azure silently falls back to its default
// (noFastForward, a two-parent merge commit) when the completing PATCH carries
// no recognised strategy, so a completed PR whose recorded strategy differs
// from the requested one must be reported, not returned as a success.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { prsMerge } from "../../lib/providers/azure/prs.ts";

const PR_URL = "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets/pullrequests/11912?api-version=7.1";

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
  process.env["AZURE_PR_MERGE_POLL_INTERVAL"] = "0";
});

afterEach(() => {
  delete process.env["AZURE_PR_MERGE_POLL_INTERVAL"];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

function completed(strategy: string | undefined): Record<string, unknown> {
  const pr: Record<string, unknown> = { ...azureFixture<Record<string, unknown>>("pullrequest.completed.json"), status: "completed" };
  if (strategy === undefined) delete pr["completionOptions"];
  else pr["completionOptions"] = { mergeStrategy: strategy, deleteSourceBranch: false };
  return pr;
}

const REFS_URL =
  "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets/refs?filter=heads%2Ffixture&api-version=7.1";

/** An active PR whose merge simulation has settled on the branch tip. */
function active(): Record<string, unknown> {
  return {
    ...azureFixture<Record<string, unknown>>("pullrequest.completed.json"),
    status: "active",
    mergeStatus: "succeeded",
    sourceRefName: "refs/heads/fixture",
    lastMergeSourceCommit: { commitId: "abc123" },
  };
}

/** The source branch is at the evaluated commit. */
const atTip = { method: "GET", url: REFS_URL, respond: azureJson({ value: [{ name: "refs/heads/fixture", objectId: "abc123" }] }) };

describe("prsMerge completion strategy", () => {
  it("sends the strategy inside completionOptions on the completing PATCH, never at the top level", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(active()) },
      atTip,
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("rebase")) },
    ]);
    await prsMerge("widgets", 11912);
    const patch = stub.requests.find((r) => r.method === "PATCH");
    const body = patch?.body as Record<string, unknown>;
    expect(body["status"]).toBe("completed");
    expect(body["mergeStrategy"]).toBeUndefined();
    expect((body["completionOptions"] as Record<string, unknown>)["mergeStrategy"]).toBe("rebase");
  });

  it("returns a completed PR whose strategy is the requested one", async () => {
    stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(active()) },
      atTip,
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("rebase")) },
    ]);
    const out = await prsMerge("widgets", 11912);
    expect(out["status"]).toBe("completed");
  });

  it("accepts a non-default requested strategy that matches", async () => {
    stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(active()) },
      atTip,
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("squash")) },
    ]);
    const out = await prsMerge("widgets", 11912, { method: "squash" });
    expect(out["status"]).toBe("completed");
  });

  it("throws naming both strategies when the completed PR used a different one", async () => {
    stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(active()) },
      atTip,
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("noFastForward")) },
    ]);
    await expect(prsMerge("widgets", 11912)).rejects.toThrow(/requested.*rebase.*noFastForward|noFastForward.*rebase/s);
  });

  it("throws when the completed PR records no strategy at all", async () => {
    stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(active()) },
      atTip,
      { method: "PATCH", url: PR_URL, respond: azureJson(completed(undefined)) },
    ]);
    await expect(prsMerge("widgets", 11912)).rejects.toThrow(/rebase.*unset|unset.*rebase/s);
  });

  it("checks the strategy on a PR that only reaches completed while polling", async () => {
    let gets = 0;
    stubAzureFetch([
      // First GET is the pre-completion read; later GETs are status polls.
      { method: "GET", url: PR_URL, respond: () => azureJson(++gets === 1 ? active() : completed("noFastForward")) },
      atTip,
      { method: "PATCH", url: PR_URL, respond: azureJson(active()) },
    ]);
    await expect(prsMerge("widgets", 11912)).rejects.toThrow(/noFastForward/);
  });
});

describe("prsMerge settles the merge simulation first", () => {
  function prAt(mergeStatus: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...azureFixture<Record<string, unknown>>("pullrequest.completed.json"),
      status: "active",
      mergeStatus,
      sourceRefName: "refs/heads/fixture",
      lastMergeSourceCommit: { commitId: "abc123" },
      ...extra,
    };
  }
  const tip = (id: string): Response => azureJson({ value: [{ name: "refs/heads/fixture", objectId: id }] });

  it("waits out queued before sending the completing PATCH", async () => {
    let gets = 0;
    const stub = stubAzureFetch([
      { method: "GET", url: PR_URL, respond: () => azureJson(++gets < 3 ? prAt("queued") : prAt("succeeded")) },
      { method: "GET", url: REFS_URL, respond: tip("abc123") },
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("rebase")) },
    ]);
    await prsMerge("widgets", 11912);
    expect(gets).toBe(3);
    const order = stub.requests.map((r) => r.method);
    expect(order.lastIndexOf("GET")).toBeLessThan(order.indexOf("PATCH"));
  });

  it("fails without a PATCH when the simulation never settles", async () => {
    process.env["AZURE_PR_MERGE_POLL_ATTEMPTS"] = "2";
    try {
      const stub = stubAzureFetch([{ method: "GET", url: PR_URL, respond: () => azureJson(prAt("queued")) }]);
      await expect(prsMerge("widgets", 11912)).rejects.toThrow(/merge status.*queued|queued/i);
      expect(stub.requests.some((r) => r.method === "PATCH")).toBe(false);
    } finally {
      delete process.env["AZURE_PR_MERGE_POLL_ATTEMPTS"];
    }
  });

  it("refuses when the branch tip moved past the evaluated commit", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(prAt("succeeded")) },
      { method: "GET", url: REFS_URL, respond: tip("def456") },
    ]);
    await expect(prsMerge("widgets", 11912)).rejects.toThrow(/def456/);
    expect(stub.requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("compares matchHeadCommit with the real branch tip, not the stale evaluated commit", async () => {
    stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(prAt("succeeded")) },
      { method: "GET", url: REFS_URL, respond: tip("abc123") },
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("rebase")) },
    ]);
    await expect(prsMerge("widgets", 11912, { matchHeadCommit: "zzz999" })).rejects.toThrow(/zzz999/);
  });
});

describe("prsMerge --admin", () => {
  it("sends bypassReason together with bypassPolicy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson(active()) },
      atTip,
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("rebase")) },
    ]);
    await prsMerge("widgets", 11912, { admin: true });
    const patch = stub.requests.find((r) => r.method === "PATCH")?.body as { completionOptions: Record<string, unknown> };
    expect(patch.completionOptions["bypassPolicy"]).toBe(true);
    expect(String(patch.completionOptions["bypassReason"] ?? "")).not.toBe("");
  });
});

describe("prsMerge source branch edge cases", () => {
  it("does not look the source branch up in the target repo for a fork PR", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: PR_URL, respond: azureJson({ ...active(), forkSource: { repository: { id: "fork-id" } } }) },
      { method: "PATCH", url: PR_URL, respond: azureJson(completed("rebase")) },
    ]);
    await prsMerge("widgets", 11912);
    expect(stub.requests.some((r) => r.url.includes("/refs?"))).toBe(false);
  });

  it.each(["completed", "abandoned"])("names a %s PR instead of reporting a ref problem", async (status) => {
    stubAzureFetch([{ method: "GET", url: PR_URL, respond: azureJson({ ...active(), status }) }]);
    await expect(prsMerge("widgets", 11912)).rejects.toThrow(new RegExp(`is ${status}`));
  });
});
