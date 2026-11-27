// Azure PR create, list, view and diff edge cases: a failing follow-up comment
// must not hide the PR that was already created, unresolvable reviewers are
// skipped, policy rejections are distinguishable from "not computed yet",
// --search filters before --limit and ignores case, and a renamed file keeps
// its original path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { azureFixture, azureJson, stubAzureFetch, useAzureEnv } from "./harness/azure-stub.ts";
import { policyScopeCovers, prsApproveAsCreator, prsCreate, prsDiff, prsList, prsView } from "../../lib/providers/azure/prs.ts";

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

describe("pull request URLs", () => {
  const pr = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    pullRequestId: 13055, title: "t", status: "active", sourceRefName: "refs/heads/b", targetRefName: "refs/heads/main", ...extra,
  });
  const WEB = "https://dev.azure.com/test-org/test-project/_git/widgets/pullrequest/13055";

  it("list builds an absolute URL when the response carries no repository.webUrl", async () => {
    stubAzureFetch([{ method: "GET", url: /pullrequests\?status=active/, respond: azureJson({ value: [pr()] }) }]);
    const out = (await prsList("widgets", {})) as Array<{ url: string }>;
    expect(out[0]?.url).toBe(WEB);
  });

  it("a project-wide list takes the repository from each pull request", async () => {
    stubAzureFetch([{ method: "GET", url: /pullrequests\?status=active/, respond: azureJson({ value: [pr({ repository: { name: "widgets" } })] }) }]);
    const out = (await prsList("", {})) as Array<{ url: string }>;
    expect(out[0]?.url).toBe(WEB);
  });

  it("view keeps the repository.webUrl Azure sends", async () => {
    stubAzureFetch([{ method: "GET", url: /pullrequests\/13055/, respond: azureJson(pr({ repository: { webUrl: "https://example.visualstudio.com/p/_git/widgets" } })) }]);
    const out = (await prsView("widgets", 13055)) as { url: string };
    expect(out.url).toBe("https://example.visualstudio.com/p/_git/widgets/pullrequest/13055");
  });

  it("the facade's create prints the new pull request's URL, as on github", async () => {
    const root = mkdtempSync(join(tmpdir(), "azure-facade-"));
    writeFileSync(join(root, "devenv.config"), "[provider]\nname=azure\n");
    const savedRoot = process.env.DEVENV_ROOT;
    process.env.DEVENV_ROOT = root;
    try {
      vi.resetModules();
      const facade = await import("../../lib/providers/facade/prs.ts");
      stubAzureFetch([{ method: "POST", url: PRS_URL, respond: azureJson({ pullRequestId: 13055 }) }]);
      const r = await facade.prsCreate("test-project/widgets", { title: "t", head: "b", base: "main" });
      expect(r.stdout.trim()).toBe(WEB);
    } finally {
      if (savedRoot === undefined) delete process.env.DEVENV_ROOT;
      else process.env.DEVENV_ROOT = savedRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("prsApproveAsCreator", () => {
  const CREATOR = "aaaaaaaa-1111-4222-8333-444444444444";
  const REPO_ID = "ee82a99c-fa04-4bf3-83c8-0d076b5c218e";
  const PR = { pullRequestId: 13056, status: "active", targetRefName: "refs/heads/master", createdBy: { id: CREATOR }, repository: { id: REPO_ID } };
  const policy = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({
    id: 460,
    isEnabled: true,
    isBlocking: true,
    type: { id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" },
    settings: { minimumApproverCount: 1, scope: [{ refName: "refs/heads/master", matchKind: "Exact", repositoryId: REPO_ID }], ...settings },
    ...extra,
  });
  const routes = (policies: unknown[]): Parameters<typeof stubAzureFetch>[0] => [
    { method: "GET", url: `${REPO}/pullrequests/13056?api-version=7.1`, respond: azureJson(PR) },
    { method: "GET", url: /_apis\/policy\/configurations\?/, respond: azureJson({ value: policies, count: policies.length }) },
    { method: "PUT", url: `${REPO}/pullrequests/13056/reviewers/${CREATOR}?api-version=7.1`, respond: azureJson({ vote: 10 }) },
  ];

  it("votes approve as the creator when the branch policy counts the creator's vote", async () => {
    const stub = stubAzureFetch(routes([policy({ creatorVoteCounts: true })]));
    expect(await prsApproveAsCreator("widgets", 13056)).toBe("approved");
    const put = stub.requests.find((r) => r.method === "PUT") as { body: unknown } | undefined;
    expect(put?.body).toEqual({ vote: 10 });
  });

  it("refuses, without voting, when a policy does not count the creator's vote", async () => {
    const stub = stubAzureFetch(routes([policy({ creatorVoteCounts: true }, { id: 1 }), policy({ creatorVoteCounts: false }, { id: 2 })]), { allowUnmatched: true });
    await expect(prsApproveAsCreator("widgets", 13056)).rejects.toThrow(/policy 2 .*creator's vote/);
    expect(stub.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("does nothing when no enabled blocking policy covers the target branch", async () => {
    const stub = stubAzureFetch(routes([
      policy({ creatorVoteCounts: false }, { isEnabled: false }),
      policy({ creatorVoteCounts: false, scope: [{ refName: "refs/heads/release", matchKind: "Exact", repositoryId: REPO_ID }] }),
    ]), { allowUnmatched: true });
    expect(await prsApproveAsCreator("widgets", 13056)).toBe("no-policy");
    expect(stub.requests.some((r) => r.method === "PUT")).toBe(false);
  });
});

describe("policyScopeCovers", () => {
  it("project-wide, prefix and branch-less scopes cover the branch; another repository or branch does not", () => {
    expect(policyScopeCovers({ refName: "refs/heads/master", matchKind: "Exact" }, "r1", "refs/heads/master")).toBe(true);
    expect(policyScopeCovers({ repositoryId: null, refName: "refs/heads/", matchKind: "Prefix" }, "r1", "refs/heads/master")).toBe(true);
    expect(policyScopeCovers({ repositoryId: "r1" }, "r1", "refs/heads/master")).toBe(true);
    expect(policyScopeCovers({ repositoryId: "r2", refName: "refs/heads/master" }, "r1", "refs/heads/master")).toBe(false);
    expect(policyScopeCovers({ repositoryId: "r1", refName: "refs/heads/main", matchKind: "Exact" }, "r1", "refs/heads/master")).toBe(false);
  });
});
