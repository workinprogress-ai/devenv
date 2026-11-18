// Azure PR create, list, view and diff edge cases: a failing follow-up comment
// must not hide the PR that was already created, unresolvable reviewers are
// skipped, policy rejections are distinguishable from "not computed yet",
// --search filters before --limit and ignores case, and a renamed file keeps
// its original path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { prsCreate, prsDiff, prsList, prsView } from "../../lib/providers/azure/prs.ts";

const REPO = "https://dev.azure.com/test-org/test-project/_apis/git/repositories/widgets";
const PRS_URL = `${REPO}/pullrequests?api-version=7.1`;

let restoreEnv: () => void = () => {};

beforeEach(() => {
  restoreEnv = useAzureEnv("test-org", "test-project");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

describe("prsCreate partial failure", () => {
  it("returns the PR number and warns when the long-body comment cannot be posted", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    stubAzureFetch([
      { method: "POST", url: PRS_URL, respond: azureJson({ pullRequestId: 77 }) },
      { method: "POST", url: `${REPO}/pullrequests/77/threads?api-version=7.1`, respond: azureJson({ message: "boom" }, 400) },
    ]);
    const n = await prsCreate("widgets", { title: "t", head: "h", base: "main", body: "x".repeat(4100) });
    expect(n).toBe(77);
    expect(warn.mock.calls.flat().join("\n")).toMatch(/PR 77.*comment|comment.*PR 77/s);
  });
});

describe("prsCreate reviewers", () => {
  const GUID = "11111111-2222-4333-8444-555555555555";

  it("skips a reviewer that does not resolve to one identity and still creates the PR", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = stubAzureFetch([
      { method: "GET", url: /vssps\.dev\.azure\.com.*identities/, respond: azureJson({ value: [] }) },
      { method: "POST", url: PRS_URL, respond: azureJson({ pullRequestId: 78 }) },
    ]);
    const n = await prsCreate("widgets", { title: "t", head: "h", base: "main", reviewers: ["nobody@example.com", GUID] });
    expect(n).toBe(78);
    const post = stub.requests.find((r) => r.method === "POST") as { body: { reviewers?: Array<{ id: string }> } };
    expect(post.body.reviewers).toEqual([{ id: GUID }]);
    expect(warn.mock.calls.flat().join("\n")).toContain("nobody@example.com");
  });
});

describe("prsCreate reviewer lookup failures", () => {
  it("does not hide an authentication failure behind a skipped reviewer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = stubAzureFetch([
      { method: "GET", url: /vssps\.dev\.azure\.com.*identities/, respond: azureJson({ message: "denied" }, 401) },
    ]);
    await expect(
      prsCreate("widgets", { title: "t", head: "h", base: "main", reviewers: ["someone@example.com"] }),
    ).rejects.toThrow();
    expect(stub.requests.some((r) => r.method === "POST")).toBe(false);
  });
});

describe("prsView merge state", () => {
  const view = async (mergeStatus: string): Promise<Record<string, unknown>> => {
    const pr = { ...azureFixture<Record<string, unknown>>("pullrequest.completed.json"), mergeStatus };
    stubAzureFetch([{ method: "GET", url: `${REPO}/pullrequests/11912?api-version=7.1`, respond: azureJson(pr) }]);
    return (await prsView("widgets", 11912)) as Record<string, unknown>;
  };

  it.each([
    ["rejectedByPolicy", "BLOCKED"],
    ["failure", "DIRTY"],
    ["conflicts", "DIRTY"],
    ["succeeded", "CLEAN"],
    ["queued", "UNKNOWN"],
  ])("maps mergeStatus %s to mergeStateStatus %s", async (status, expected) => {
    expect((await view(status))["mergeStateStatus"]).toBe(expected);
  });
});

describe("prsList --search", () => {
  const page = (titles: string[]): unknown => ({
    value: titles.map((title, i) => ({ pullRequestId: i + 1, title, status: "active", sourceRefName: "refs/heads/b", targetRefName: "refs/heads/main" })),
  });

  it("filters before --limit, so a match past the first N is still found", async () => {
    stubAzureFetch([{ method: "GET", url: /pullrequests\?status=active/, respond: azureJson(page(["a", "b", "c", "match one", "match two"])) }]);
    const out = (await prsList("widgets", { search: "match", limit: 1 })) as Array<{ title: string }>;
    expect(out.map((r) => r.title)).toEqual(["match one"]);
  });

  it("keeps asking for full pages while a search is active, whatever the limit", async () => {
    const tops: string[] = [];
    stubAzureFetch([
      {
        method: "GET",
        url: /pullrequests\?status=active/,
        respond: (req) => {
          tops.push(/\$top=(\d+)/.exec(req.url)?.[1] ?? "");
          return azureJson(page(["a"]));
        },
      },
    ]);
    await prsList("widgets", { search: "zzz", limit: 1 });
    expect(Number(tops[0])).toBeGreaterThan(1);
  });

  it("matches the title ignoring case", async () => {
    stubAzureFetch([{ method: "GET", url: /pullrequests\?status=active/, respond: azureJson(page(["Fix The Widget", "other"])) }]);
    const out = (await prsList("widgets", { search: "the widget" })) as Array<{ title: string }>;
    expect(out.map((r) => r.title)).toEqual(["Fix The Widget"]);
  });
});

describe("prsDiff", () => {
  const diffWith = async (changes: unknown[]): Promise<string> => {
    stubAzureFetch([
      { method: "GET", url: /pullrequests\/5\/iterations\?/, respond: azureJson({ value: [{ id: 1 }] }) },
      { method: "GET", url: /pullrequests\/5\/iterations\/1\/changes/, respond: azureJson({ changes }) },
    ]);
    return prsDiff("widgets", 5);
  };

  it("keeps the original path of a renamed file", async () => {
    const out = await diffWith([{ item: { path: "/new.ts" }, originalPath: "/old.ts", changeType: "rename" }]);
    expect(JSON.parse(out)).toEqual({ path: "/new.ts", originalPath: "/old.ts", changeType: "rename" });
  });

  it("omits originalPath when the change has none", async () => {
    const out = await diffWith([{ item: { path: "/a.ts" }, changeType: "edit" }]);
    expect(JSON.parse(out)).toEqual({ path: "/a.ts", changeType: "edit" });
  });

  it("rejects a non-numeric PR number before any request", async () => {
    const stub = stubAzureFetch([]);
    await expect(prsDiff("widgets", Number.NaN)).rejects.toThrow(/PR number/);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("PR branch refs", () => {
  it("does not prefix a head or base that is already a full ref", async () => {
    const stub = stubAzureFetch([
      { method: "GET", url: /pullrequests\?status=active/, respond: azureJson({ value: [] }) },
    ]);
    await prsList("widgets", { head: "refs/heads/topic", base: "refs/heads/main" });
    const url = stub.requests[0]?.url ?? "";
    expect(url).toContain("sourceRefName=refs%2Fheads%2Ftopic");
    expect(url).toContain("targetRefName=refs%2Fheads%2Fmain");
  });

  it("does the same on create", async () => {
    const stub = stubAzureFetch([{ method: "POST", url: PRS_URL, respond: azureJson({ pullRequestId: 5 }) }]);
    await prsCreate("widgets", { title: "t", head: "refs/heads/topic", base: "main" });
    expect(stub.requests[0]?.body).toMatchObject({ sourceRefName: "refs/heads/topic", targetRefName: "refs/heads/main" });
  });
});
