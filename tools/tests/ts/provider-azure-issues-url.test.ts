// Exact request URLs of the work-item verbs: the type probe (one `/_apis/wit`
// segment, not two) and the WIQL queries (bounded by $top; the label-harvest
// fallback ordered). A loose `includes()` match let a doubled path through, so
// every route here is an exact URL or an anchored pattern.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { issuesList, issuesLabelList, workItemTypeFor } from "../../lib/providers/azure/issues.ts";

const WIT = "https://dev.azure.com/test-org/test-project/_apis/wit";

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

function typesRoute() {
  const states = azureFixture<{ value: unknown[] }>("workitemtypes.user-story.states.json").value;
  return {
    method: "GET",
    url: `${WIT}/workitemtypes?api-version=7.1`,
    respond: azureJson({ value: [{ name: "User Story", states }] }),
  };
}

describe("workItemTypeFor", () => {
  it("probes the type at exactly one /_apis/wit segment", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: `${WIT}/workitemtypes/Bug?api-version=7.1`, respond: azureJson({ name: "Bug" }) },
    ]);
    await expect(workItemTypeFor("bug")).resolves.toBe("Bug");
    expect(stub.requests.map((r) => r.url)).toEqual([`${WIT}/workitemtypes/Bug?api-version=7.1`]);
  });

  it("encodes a type name containing a space", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: `${WIT}/workitemtypes/User%20Story?api-version=7.1`, respond: azureJson({}) },
    ]);
    await expect(workItemTypeFor("task")).resolves.toBe("User Story");
    expect(stub.unmatched()).toEqual([]);
  });

  it("names the mapped type and the config key when the project lacks it", async () => {
    stubAzureFetch([
      { method: "GET", url: `${WIT}/workitemtypes/Bug?api-version=7.1`, respond: azureJson({ message: "gone" }, 404) },
    ]);
    await expect(workItemTypeFor("bug")).rejects.toThrow(/'Bug'.*not available.*\[azure_issue_types\]/s);
  });
});

describe("issuesList WIQL bound", () => {
  const empty = azureJson({ workItems: [] });

  it("sends the requested limit as $top", async () => {
    const stub = stubAzureFetch([typesRoute(), { method: "POST", url: `${WIT}/wiql?$top=5&api-version=7.1`, respond: empty }]);
    await issuesList("", { limit: 5 });
    expect(stub.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual([`${WIT}/wiql?$top=5&api-version=7.1`]);
  });

  it("defaults the bound to the default limit of 200", async () => {
    const stub = stubAzureFetch([typesRoute(), { method: "POST", url: `${WIT}/wiql?$top=200&api-version=7.1`, respond: empty }]);
    await issuesList("");
    expect(stub.unmatched()).toEqual([]);
  });

  it("keeps the explicit ORDER BY", async () => {
    const stub = stubAzureFetch([typesRoute(), { method: "POST", url: /\/wiql\?/, respond: empty }]);
    await issuesList("", { limit: 3 });
    const post = stub.requests.find((r) => r.method === "POST");
    expect((post?.body as { query: string }).query).toMatch(/ORDER BY \[System\.Id\] DESC$/);
  });
});

describe("label harvest fallback", () => {
  it("bounds the WIQL harvest and orders it newest first", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: /\/_apis\/wit\/tags\?/, respond: azureJson({ message: "no tags api" }, 404) },
      { method: "POST", url: `${WIT}/wiql?$top=500&api-version=7.1`, respond: azureJson({ workItems: [] }) },
    ]);
    await issuesLabelList("");
    const post = stub.requests.find((r) => r.method === "POST");
    expect(post?.url).toBe(`${WIT}/wiql?$top=500&api-version=7.1`);
    expect((post?.body as { query: string }).query).toMatch(/ORDER BY \[System\.Id\] DESC$/);
  });
});
