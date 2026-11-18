// prsMerge completion polling: the attempt count and interval come from
// AZURE_PR_MERGE_POLL_ATTEMPTS / AZURE_PR_MERGE_POLL_INTERVAL; a value that is
// not a non-negative integer must fall back to the default instead of turning
// into NaN (which never terminates the loop).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { prsMerge } from "../../lib/providers/azure/prs.ts";

const PR_URL = "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets/pullrequests/11912?api-version=7.1";

let restoreEnv: () => void = () => {};
const saved: Record<string, string | undefined> = {};
const KEYS = ["AZURE_PR_MERGE_POLL_ATTEMPTS", "AZURE_PR_MERGE_POLL_INTERVAL"] as const;

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
  for (const k of KEYS) saved[k] = process.env[k];
  process.env["AZURE_PR_MERGE_POLL_INTERVAL"] = "0";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

/** A PR that never completes; returns the count of status polls (GETs after
 * the initial PR read). */
async function pollsFor(attempts: string): Promise<number> {
  process.env["AZURE_PR_MERGE_POLL_ATTEMPTS"] = attempts;
  const pr = { ...azureFixture<Record<string, unknown>>("pullrequest.completed.json"), status: "active" };
  const stub = stubAzureFetch([
    { method: "GET", url: PR_URL, respond: azureJson(pr) },
    { method: "PATCH", url: PR_URL, respond: azureJson(pr) },
  ]);
  await expect(prsMerge("widgets", 11912)).rejects.toThrow(/is not completed after \d+ checks/);
  return stub.requests.filter((r) => r.method === "GET").length - 1;
}

describe("prsMerge poll attempts", () => {
  it("honors a valid non-negative integer", async () => {
    expect(await pollsFor("2")).toBe(2);
    expect(await pollsFor("0")).toBe(0);
  });

  it.each(["abc", "", "-1", "1.5"])("falls back to the default 30 for '%s'", async (value) => {
    expect(await pollsFor(value)).toBe(30);
  });
});
